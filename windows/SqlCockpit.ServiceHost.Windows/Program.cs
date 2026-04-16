using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.ServiceProcess;
using System.Text;
using System.Text.Json;

namespace SqlCockpit.ServiceHost.Windows;

public static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    public static async Task Main(string[] args)
    {
        var parsed = ParseArgs(args);
        var settingsPath = ResolveSettingsPath(parsed);
        var settings = LoadSettings(settingsPath);
        var host = new ServiceHost(settings);

        var runAsConsole = parsed.ContainsKey("console") || Environment.UserInteractive;
        if (runAsConsole)
        {
            Console.WriteLine("[ServiceHost] Starting in console mode.");
            using var cts = new CancellationTokenSource();
            Console.CancelKeyPress += (_, eventArgs) =>
            {
                eventArgs.Cancel = true;
                cts.Cancel();
            };

            await host.StartAsync(cts.Token);
            try
            {
                await Task.Delay(Timeout.Infinite, cts.Token);
            }
            catch (OperationCanceledException)
            {
            }
            finally
            {
                await host.StopAsync();
            }

            return;
        }

        ServiceBase.Run(new WindowsServiceBridge(host));
    }

    private static Dictionary<string, string> ParseArgs(string[] args)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index += 1)
        {
            var token = args[index];
            if (!token.StartsWith("--", StringComparison.Ordinal))
            {
                continue;
            }

            var key = token[2..];
            if (index + 1 >= args.Length || args[index + 1].StartsWith("--", StringComparison.Ordinal))
            {
                result[key] = "true";
                continue;
            }

            result[key] = args[index + 1];
            index += 1;
        }

        return result;
    }

    private static string ResolveSettingsPath(Dictionary<string, string> parsed)
    {
        if (parsed.TryGetValue("settings", out var provided) && !string.IsNullOrWhiteSpace(provided))
        {
            return Path.GetFullPath(provided);
        }

        return Path.Combine(AppContext.BaseDirectory, "sql-cockpit-service.settings.json");
    }

    private static ServiceSettings LoadSettings(string settingsPath)
    {
        if (!File.Exists(settingsPath))
        {
            throw new InvalidOperationException($"Settings file not found at [{settingsPath}].");
        }

        var text = File.ReadAllText(settingsPath);
        var parsed = JsonSerializer.Deserialize<ServiceSettings>(text, JsonOptions);
        if (parsed is null)
        {
            throw new InvalidOperationException($"Could not parse settings file [{settingsPath}].");
        }

        parsed.SettingsPath = settingsPath;
        parsed.ResolveDefaults();
        return parsed;
    }

    private sealed class WindowsServiceBridge(ServiceHost host) : ServiceBase
    {
        private readonly ServiceHost _host = host;

        protected override void OnStart(string[] args)
        {
            _ = Task.Run(async () => await _host.StartAsync(CancellationToken.None));
        }

        protected override void OnStop()
        {
            Task.Run(async () => await _host.StopAsync()).GetAwaiter().GetResult();
        }
    }
}

internal sealed class ServiceHost(ServiceSettings settings)
{
    private readonly ProcessSupervisor _supervisor = new(settings);
    private readonly ControlApiServer _apiServer = new(settings);
    private bool _started;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        await _supervisor.StartAsync(cancellationToken);
        _apiServer.Attach(_supervisor);
        await _apiServer.StartAsync(cancellationToken);
    }

    public async Task StopAsync()
    {
        if (!_started)
        {
            return;
        }

        _started = false;
        await _apiServer.StopAsync();
        await _supervisor.StopAsync();
    }
}

internal sealed class ControlApiServer(ServiceSettings settings)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private readonly HttpListener _listener = new();
    private readonly ServiceSettings _settings = settings;
    private CancellationTokenSource? _cts;
    private Task? _loopTask;
    private ProcessSupervisor? _supervisor;

    public void Attach(ProcessSupervisor supervisor)
    {
        _supervisor = supervisor;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (_supervisor is null)
        {
            throw new InvalidOperationException("Supervisor has not been attached.");
        }

        if (_listener.IsListening)
        {
            return Task.CompletedTask;
        }

        _listener.Prefixes.Add(_settings.ListenPrefix);
        _listener.Start();
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _loopTask = Task.Run(() => AcceptLoopAsync(_cts.Token), _cts.Token);
        return Task.CompletedTask;
    }

    public async Task StopAsync()
    {
        try
        {
            _cts?.Cancel();
        }
        catch
        {
        }

        if (_listener.IsListening)
        {
            _listener.Stop();
            _listener.Close();
        }

        if (_loopTask is not null)
        {
            try
            {
                await _loopTask;
            }
            catch
            {
            }
        }
    }

    private async Task AcceptLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            HttpListenerContext context;
            try
            {
                context = await _listener.GetContextAsync();
            }
            catch when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    return;
                }
                continue;
            }

            _ = Task.Run(() => HandleRequestAsync(context, cancellationToken), cancellationToken);
        }
    }

    private async Task HandleRequestAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        try
        {
            if (!Authorize(context.Request))
            {
                await WriteJsonAsync(context.Response, 401, new { error = "Unauthorized." });
                return;
            }

            var path = context.Request.Url?.AbsolutePath ?? "/";
            var method = context.Request.HttpMethod.ToUpperInvariant();
            var supervisor = _supervisor ?? throw new InvalidOperationException("Supervisor is unavailable.");

            if (method == "GET" && path.Equals("/health", StringComparison.OrdinalIgnoreCase))
            {
                await WriteJsonAsync(context.Response, 200, new
                {
                    status = "ok",
                    service = "sql-cockpit-service-host",
                    utcNow = DateTimeOffset.UtcNow
                });
                return;
            }

            if (method == "GET" && path.Equals("/api/runtime/components", StringComparison.OrdinalIgnoreCase))
            {
                await supervisor.RefreshSnapshotAsync(cancellationToken);
                await WriteJsonAsync(context.Response, 200, supervisor.GetSnapshot());
                return;
            }

            if (method == "POST" && path.Equals("/api/runtime/components/start-all", StringComparison.OrdinalIgnoreCase))
            {
                await supervisor.StartAllAsync("manual-start-all", cancellationToken);
                await WriteJsonAsync(context.Response, 200, supervisor.GetSnapshot());
                return;
            }

            if (method == "POST" && path.Equals("/api/runtime/components/stop-all", StringComparison.OrdinalIgnoreCase))
            {
                await supervisor.StopAllAsync("manual-stop-all", cancellationToken);
                await WriteJsonAsync(context.Response, 200, supervisor.GetSnapshot());
                return;
            }

            if (method == "POST" && path.Equals("/api/runtime/components/restart-all", StringComparison.OrdinalIgnoreCase))
            {
                await supervisor.RestartAllAsync("manual-restart-all", cancellationToken);
                await WriteJsonAsync(context.Response, 200, supervisor.GetSnapshot());
                return;
            }

            var componentMatch = System.Text.RegularExpressions.Regex.Match(
                path,
                "^/api/runtime/components/(?<id>[a-z0-9\\-]+)/(?<action>start|stop|restart)$",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (method == "POST" && componentMatch.Success)
            {
                var componentId = componentMatch.Groups["id"].Value.ToLowerInvariant();
                var action = componentMatch.Groups["action"].Value.ToLowerInvariant();
                if (action == "start")
                {
                    await supervisor.StartComponentAsync(componentId, "manual-start", cancellationToken);
                }
                else if (action == "stop")
                {
                    await supervisor.StopComponentAsync(componentId, "manual-stop", cancellationToken);
                }
                else
                {
                    await supervisor.RestartComponentAsync(componentId, "manual-restart", cancellationToken);
                }

                await WriteJsonAsync(context.Response, 200, supervisor.GetSnapshot());
                return;
            }

            await WriteJsonAsync(context.Response, 404, new { error = "Not found." });
        }
        catch (Exception error)
        {
            await WriteJsonAsync(context.Response, 500, new { error = error.Message });
        }
    }

    private bool Authorize(HttpListenerRequest request)
    {
        if (!_settings.RequireLocalRequests)
        {
            return true;
        }

        var remoteAddress = request.RemoteEndPoint?.Address;
        if (remoteAddress is null || !IPAddress.IsLoopback(remoteAddress))
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(_settings.ApiKey))
        {
            return true;
        }

        var provided = request.Headers["X-SqlCockpit-Service-Key"] ?? string.Empty;
        return string.Equals(provided, _settings.ApiKey, StringComparison.Ordinal);
    }

    private static async Task WriteJsonAsync(HttpListenerResponse response, int statusCode, object payload)
    {
        var text = JsonSerializer.Serialize(payload, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(text);
        response.StatusCode = statusCode;
        response.ContentType = "application/json; charset=utf-8";
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes);
        response.OutputStream.Close();
    }
}

internal sealed class ProcessSupervisor
{
    private readonly ServiceSettings _settings;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConcurrentDictionary<string, ManagedComponentState> _states = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, ComponentSettings> _specs = new(StringComparer.OrdinalIgnoreCase);
    private CancellationTokenSource? _healthLoopCts;
    private Task? _healthLoopTask;

    public ProcessSupervisor(ServiceSettings settings)
    {
        _settings = settings;
        foreach (var component in settings.Components)
        {
            _specs[component.Id] = component;
            _states[component.Id] = new ManagedComponentState(component.Id, component.DisplayName);
        }
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _healthLoopCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _healthLoopTask = Task.Run(() => HealthLoopAsync(_healthLoopCts.Token), _healthLoopCts.Token);

        if (!_settings.AutoStart)
        {
            return;
        }

        await StartAllAsync("startup", cancellationToken);
    }

    public async Task StopAsync()
    {
        if (_healthLoopCts is not null)
        {
            _healthLoopCts.Cancel();
        }

        if (_healthLoopTask is not null)
        {
            try
            {
                await _healthLoopTask;
            }
            catch
            {
            }
        }

        await StopAllAsync("shutdown", CancellationToken.None);
    }
    public ServiceSnapshot GetSnapshot()
    {
        var components = _states.Values
            .OrderBy(state => state.Id, StringComparer.OrdinalIgnoreCase)
            .Select(state => state.ToSnapshot(_specs[state.Id]))
            .ToList();

        return new ServiceSnapshot(
            enabled: true,
            autoStart: _settings.AutoStart,
            autoRestart: _settings.AutoRestart,
            pollIntervalSeconds: _settings.HealthPollSeconds,
            unhealthyFailureThreshold: _settings.HealthFailureThreshold,
            restartDelaySeconds: _settings.RestartDelaySeconds,
            provider: "windows-service",
            serviceName: _settings.ServiceName,
            serviceControlUrl: _settings.ListenPrefix,
            components: components);
    }

    public async Task RefreshSnapshotAsync(CancellationToken cancellationToken)
    {
        foreach (var componentId in _specs.Keys)
        {
            await CheckHealthAsync(componentId, cancellationToken);
        }
    }

    public async Task StartAllAsync(string reason, CancellationToken cancellationToken)
    {
        foreach (var component in _specs.Values.Where(component => !component.Disabled && component.AutoStart))
        {
            await StartComponentAsync(component.Id, reason, cancellationToken);
        }
    }

    public async Task StopAllAsync(string reason, CancellationToken cancellationToken)
    {
        foreach (var component in _specs.Values.Reverse())
        {
            await StopComponentAsync(component.Id, reason, cancellationToken);
        }
    }

    public async Task RestartAllAsync(string reason, CancellationToken cancellationToken)
    {
        foreach (var component in _specs.Values.Where(component => !component.Disabled))
        {
            await RestartComponentAsync(component.Id, reason, cancellationToken);
        }
    }

    public async Task StartComponentAsync(string componentId, string reason, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!_specs.TryGetValue(componentId, out var spec))
        {
            throw new InvalidOperationException($"Unknown component [{componentId}].");
        }

        if (spec.Disabled)
        {
            throw new InvalidOperationException($"Component [{componentId}] is disabled in settings.");
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var state = _states[componentId];
            if (state.Process is { HasExited: false })
            {
                return;
            }

            state.Starting = true;
            state.ManualStopRequested = false;
            state.LastError = string.Empty;
            state.Health.Status = "unknown";
            state.Health.ConsecutiveFailures = 0;
            state.Health.LastError = string.Empty;
            state.Health.LastStatusCode = null;
            state.Health.LastCheckedUtc = DateTimeOffset.UtcNow;
            state.OutputTail.Clear();

            var logsDirectory = Path.Combine(_settings.ServiceRepoRoot, "Logs", "ServiceHost", componentId);
            Directory.CreateDirectory(logsDirectory);
            var timestamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmss");
            var logPath = Path.Combine(logsDirectory, $"{timestamp}.log");
            var logWriter = new StreamWriter(File.Open(logPath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite));
            state.LogPath = logPath;
            state.LogWriter = logWriter;
            state.LogWriter.WriteLine($"[{DateTimeOffset.UtcNow:u}] [manager] Starting component ({reason}).");
            state.LogWriter.Flush();

            var startInfo = new ProcessStartInfo
            {
                FileName = ExpandValue(spec.Command),
                WorkingDirectory = ResolveWorkingDirectory(spec.WorkingDirectory),
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            foreach (var arg in spec.Args)
            {
                startInfo.ArgumentList.Add(ExpandValue(arg));
            }

            var process = new Process
            {
                StartInfo = startInfo,
                EnableRaisingEvents = true
            };

            process.OutputDataReceived += (_, eventArgs) =>
            {
                if (!string.IsNullOrWhiteSpace(eventArgs.Data))
                {
                    AppendOutput(state, "stdout", eventArgs.Data);
                }
            };
            process.ErrorDataReceived += (_, eventArgs) =>
            {
                if (!string.IsNullOrWhiteSpace(eventArgs.Data))
                {
                    AppendOutput(state, "stderr", eventArgs.Data);
                }
            };
            process.Exited += (_, _) =>
            {
                HandleProcessExit(componentId, process).GetAwaiter().GetResult();
            };

            if (!process.Start())
            {
                throw new InvalidOperationException($"Failed to start process for component [{componentId}].");
            }

            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            state.Process = process;
            state.LastStartUtc = DateTimeOffset.UtcNow;
            state.Starting = false;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task StopComponentAsync(string componentId, string reason, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!_specs.TryGetValue(componentId, out _))
        {
            throw new InvalidOperationException($"Unknown component [{componentId}].");
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            var state = _states[componentId];
            state.ManualStopRequested = true;
            if (state.Process is not { HasExited: false } process)
            {
                return;
            }

            state.Stopping = true;
            try
            {
                process.Kill(entireProcessTree: true);
            }
            catch
            {
            }

            state.Stopping = false;
            AppendOutput(state, "manager", $"Stopped component ({reason}).");
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RestartComponentAsync(string componentId, string reason, CancellationToken cancellationToken)
    {
        await StopComponentAsync(componentId, reason, cancellationToken);
        await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, _settings.RestartDelaySeconds)), cancellationToken);
        await StartComponentAsync(componentId, reason, cancellationToken);
    }

    private async Task HealthLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, _settings.HealthPollSeconds)), cancellationToken);
                await RefreshSnapshotAsync(cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch
            {
            }
        }
    }

    private async Task CheckHealthAsync(string componentId, CancellationToken cancellationToken)
    {
        if (!_specs.TryGetValue(componentId, out var spec))
        {
            return;
        }

        if (string.IsNullOrWhiteSpace(spec.HealthUrl))
        {
            return;
        }

        if (!_states.TryGetValue(componentId, out var state))
        {
            return;
        }

        var process = state.Process;
        if (process is null || process.HasExited)
        {
            state.Health.Status = "stopped";
            state.Health.LastError = string.Empty;
            state.Health.LastStatusCode = null;
            state.Health.ConsecutiveFailures = 0;
            state.Health.LastCheckedUtc = DateTimeOffset.UtcNow;
            return;
        }

        using var client = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(4)
        };

        try
        {
            using var response = await client.GetAsync(spec.HealthUrl, cancellationToken);
            state.Health.LastCheckedUtc = DateTimeOffset.UtcNow;
            state.Health.LastStatusCode = (int)response.StatusCode;
            if ((int)response.StatusCode >= 200 && (int)response.StatusCode < 500)
            {
                state.Health.Status = "healthy";
                state.Health.LastError = string.Empty;
                state.Health.ConsecutiveFailures = 0;
                return;
            }

            state.Health.Status = "unhealthy";
            state.Health.LastError = $"Health endpoint returned {(int)response.StatusCode}.";
            state.Health.ConsecutiveFailures += 1;
        }
        catch (Exception error)
        {
            state.Health.Status = "unhealthy";
            state.Health.LastError = error.Message;
            state.Health.LastStatusCode = null;
            state.Health.LastCheckedUtc = DateTimeOffset.UtcNow;
            state.Health.ConsecutiveFailures += 1;
        }

        if (_settings.AutoRestart && spec.AutoRestart && state.Health.ConsecutiveFailures >= Math.Max(1, _settings.HealthFailureThreshold))
        {
            await RestartComponentAsync(componentId, "health-restart", cancellationToken);
        }
    }

    private async Task HandleProcessExit(string componentId, Process process)
    {
        await _gate.WaitAsync();
        try
        {
            if (!_states.TryGetValue(componentId, out var state))
            {
                return;
            }

            state.LastExitUtc = DateTimeOffset.UtcNow;
            state.LastExitCode = process.ExitCode;
            state.LastExitSignal = string.Empty;
            state.Process = null;
            state.Starting = false;
            state.Stopping = false;
            state.Health.Status = "stopped";
            state.Health.LastError = string.Empty;
            state.Health.LastStatusCode = null;
            state.Health.ConsecutiveFailures = 0;
            state.Health.LastCheckedUtc = DateTimeOffset.UtcNow;

            AppendOutput(state, "manager", $"Process exited with code {process.ExitCode}.");
            state.LogWriter?.Flush();
            state.LogWriter?.Dispose();
            state.LogWriter = null;

            if (_settings.AutoRestart && !state.ManualStopRequested && _specs.TryGetValue(componentId, out var spec) && !spec.Disabled && spec.AutoRestart)
            {
                state.RestartCount += 1;
                _ = Task.Run(async () =>
                {
                    await Task.Delay(TimeSpan.FromSeconds(Math.Max(1, _settings.RestartDelaySeconds)));
                    await StartComponentAsync(componentId, "auto-restart", CancellationToken.None);
                });
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private string ResolveWorkingDirectory(string? workingDirectory)
    {
        if (string.IsNullOrWhiteSpace(workingDirectory))
        {
            return _settings.ServiceRepoRoot;
        }

        var expanded = ExpandValue(workingDirectory);
        if (Path.IsPathRooted(expanded))
        {
            return expanded;
        }

        return Path.GetFullPath(Path.Combine(_settings.RepoRoot, expanded));
    }

    private string ExpandValue(string? value)
    {
        var text = value ?? string.Empty;
        return text
            .Replace("{RepoRoot}", _settings.RepoRoot, StringComparison.OrdinalIgnoreCase)
            .Replace("{ApiRepoRoot}", _settings.ApiRepoRoot, StringComparison.OrdinalIgnoreCase)
            .Replace("{DesktopRepoRoot}", _settings.DesktopRepoRoot, StringComparison.OrdinalIgnoreCase)
            .Replace("{ServiceRepoRoot}", _settings.ServiceRepoRoot, StringComparison.OrdinalIgnoreCase)
            .Replace("{ObjectSearchRepoRoot}", _settings.ObjectSearchRepoRoot, StringComparison.OrdinalIgnoreCase)
            .Replace("{SettingsDirectory}", Path.GetDirectoryName(_settings.SettingsPath) ?? _settings.ServiceRepoRoot, StringComparison.OrdinalIgnoreCase);
    }

    private static void AppendOutput(ManagedComponentState state, string source, string line)
    {
        var text = $"[{DateTimeOffset.UtcNow:u}] [{source}] {line}";
        lock (state.OutputTail)
        {
            state.OutputTail.Add(text);
            if (state.OutputTail.Count > 40)
            {
                state.OutputTail.RemoveRange(0, state.OutputTail.Count - 40);
            }
        }

        if (state.LogWriter is not null)
        {
            state.LogWriter.WriteLine(text);
            state.LogWriter.Flush();
        }
    }
}

internal sealed class ManagedComponentState(string id, string displayName)
{
    public string Id { get; } = id;
    public string DisplayName { get; } = displayName;
    public Process? Process { get; set; }
    public bool Starting { get; set; }
    public bool Stopping { get; set; }
    public bool ManualStopRequested { get; set; }
    public int RestartCount { get; set; }
    public DateTimeOffset? LastStartUtc { get; set; }
    public DateTimeOffset? LastExitUtc { get; set; }
    public int? LastExitCode { get; set; }
    public string LastExitSignal { get; set; } = string.Empty;
    public string LastError { get; set; } = string.Empty;
    public string LogPath { get; set; } = string.Empty;
    public StreamWriter? LogWriter { get; set; }
    public List<string> OutputTail { get; } = [];
    public ComponentHealthState Health { get; } = new();

    public ComponentSnapshot ToSnapshot(ComponentSettings spec)
    {
        var running = Process is { HasExited: false };
        List<string> tail;
        lock (OutputTail)
        {
            tail = [.. OutputTail.TakeLast(10)];
        }

        return new ComponentSnapshot(
            id: Id,
            displayName: DisplayName,
            running: running,
            pid: running ? Process?.Id : null,
            starting: Starting,
            stopping: Stopping,
            restartCount: RestartCount,
            lastStartUtc: LastStartUtc,
            lastExitUtc: LastExitUtc,
            lastExitCode: LastExitCode,
            lastExitSignal: string.IsNullOrWhiteSpace(LastExitSignal) ? null : LastExitSignal,
            lastError: string.IsNullOrWhiteSpace(LastError) ? null : LastError,
            health: new ComponentHealthSnapshot(
                status: Health.Status,
                lastCheckedUtc: Health.LastCheckedUtc,
                lastStatusCode: Health.LastStatusCode,
                lastError: string.IsNullOrWhiteSpace(Health.LastError) ? null : Health.LastError,
                consecutiveFailures: Health.ConsecutiveFailures),
            healthUrl: string.IsNullOrWhiteSpace(spec.HealthUrl) ? null : spec.HealthUrl,
            logPath: string.IsNullOrWhiteSpace(LogPath) ? null : LogPath,
            outputTail: tail);
    }
}

internal sealed class ComponentHealthState
{
    public string Status { get; set; } = "unknown";
    public DateTimeOffset? LastCheckedUtc { get; set; }
    public int? LastStatusCode { get; set; }
    public string LastError { get; set; } = string.Empty;
    public int ConsecutiveFailures { get; set; }
}

internal sealed class ServiceSettings
{
    public string ServiceName { get; set; } = "SQLCockpitServiceHost";
    public string SettingsPath { get; set; } = string.Empty;
    public string RepoRoot { get; set; } = string.Empty;
    public string DesktopRepoRoot { get; set; } = string.Empty;
    public string ApiRepoRoot { get; set; } = string.Empty;
    public string ServiceRepoRoot { get; set; } = string.Empty;
    public string ObjectSearchRepoRoot { get; set; } = string.Empty;
    public string ListenPrefix { get; set; } = "http://127.0.0.1:8610/";
    public bool RequireLocalRequests { get; set; } = true;
    public string ApiKey { get; set; } = string.Empty;
    public bool AutoStart { get; set; } = true;
    public bool AutoRestart { get; set; } = true;
    public int HealthPollSeconds { get; set; } = 5;
    public int HealthFailureThreshold { get; set; } = 3;
    public int RestartDelaySeconds { get; set; } = 3;
    public List<ComponentSettings> Components { get; set; } = [];

    public void ResolveDefaults()
    {
        if (string.IsNullOrWhiteSpace(RepoRoot))
        {
            RepoRoot = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(SettingsPath) ?? AppContext.BaseDirectory, "..", "..", ".."));
        }
        if (string.IsNullOrWhiteSpace(ApiRepoRoot))
        {
            ApiRepoRoot = Path.GetFullPath(Path.Combine(RepoRoot, "sql-cockpit-api"));
        }
        if (string.IsNullOrWhiteSpace(ServiceRepoRoot))
        {
            ServiceRepoRoot = Path.GetFullPath(Path.Combine(RepoRoot, "service"));
        }
        if (string.IsNullOrWhiteSpace(DesktopRepoRoot))
        {
            DesktopRepoRoot = Path.GetFullPath(Path.Combine(RepoRoot, "webapp"));
        }
        if (string.IsNullOrWhiteSpace(ObjectSearchRepoRoot))
        {
            ObjectSearchRepoRoot = Path.GetFullPath(Path.Combine(RepoRoot, "object-search"));
        }

        if (!ListenPrefix.EndsWith('/'))
        {
            ListenPrefix = $"{ListenPrefix}/";
        }

        Components ??= [];
        foreach (var component in Components)
        {
            component.ResolveDefaults();
        }
    }
}

internal sealed class ComponentSettings
{
    public string Id { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public bool Disabled { get; set; }
    public bool AutoStart { get; set; } = true;
    public bool AutoRestart { get; set; } = true;
    public string Command { get; set; } = string.Empty;
    public List<string> Args { get; set; } = [];
    public string WorkingDirectory { get; set; } = string.Empty;
    public string HealthUrl { get; set; } = string.Empty;

    public void ResolveDefaults()
    {
        if (string.IsNullOrWhiteSpace(DisplayName))
        {
            DisplayName = Id;
        }

        Args ??= [];
    }
}

internal sealed record ServiceSnapshot(
    bool enabled,
    bool autoStart,
    bool autoRestart,
    int pollIntervalSeconds,
    int unhealthyFailureThreshold,
    int restartDelaySeconds,
    string provider,
    string serviceName,
    string serviceControlUrl,
    IReadOnlyList<ComponentSnapshot> components);

internal sealed record ComponentSnapshot(
    string id,
    string displayName,
    bool running,
    int? pid,
    bool starting,
    bool stopping,
    int restartCount,
    DateTimeOffset? lastStartUtc,
    DateTimeOffset? lastExitUtc,
    int? lastExitCode,
    string? lastExitSignal,
    string? lastError,
    ComponentHealthSnapshot health,
    string? healthUrl,
    string? logPath,
    IReadOnlyList<string> outputTail);

internal sealed record ComponentHealthSnapshot(
    string status,
    DateTimeOffset? lastCheckedUtc,
    int? lastStatusCode,
    string? lastError,
    int consecutiveFailures);
