using SqlCockpit.ServiceHost.Windows;
using System.Net.Sockets;
public static class HostLaneChecks
{
    static void Check(bool condition, string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS: " + name); }
    public static async Task Run()
    {
        var settings = new ServiceSettings { EnvironmentId = "test", SettingsPath = Path.Combine(Path.GetTempPath(), "fixture-settings.json"), RepoRoot = Path.GetTempPath(), AutoStart = false, ApiKey = "fixture-private-key" };
        settings.ResolveDefaults();
        Check(settings.ChannelName == "test" && settings.DataRoot.Contains(Path.Combine("Environments", "test", "data")), "canonical paths and channel");
        var bridgeType = typeof(Program).GetNestedType("WindowsServiceBridge", System.Reflection.BindingFlags.NonPublic)!;
        using (var bridge = (System.ServiceProcess.ServiceBase)Activator.CreateInstance(bridgeType, new object[] { new ServiceHost(settings), "Fixture.Host.Test" })!)
            Check(bridge.ServiceName == "Fixture.Host.Test", "SCM adapter uses configured service identity");
        var child = new System.Diagnostics.ProcessStartInfo();
        child.Environment["SQL_COCKPIT_AUTH_STORE_PATH"] = "different-lane.sqlite";
        child.Environment["SQL_COCKPIT_STATE_PROVIDER"] = "azure-sql";
        settings.ApplyChildEnvironment(child);
        Check(child.Environment["SQL_COCKPIT_ENVIRONMENT_ID"] == "test", "child lane identity");
        Check(child.Environment["SQL_COCKPIT_AUTH_STORE_PATH"]!.StartsWith(settings.DataRoot), "cross-lane auth override replaced");
        Check(child.Environment["SQL_COCKPIT_SQLITE_STATE_ROOT"] == settings.DataRoot && child.Environment["SQL_COCKPIT_STATE_PROVIDER"] == "azure-sql", "isolated local state without overriding hosted provider");
        try { new ServiceSettings { EnvironmentId = "typo" }.ResolveDefaults(); throw new Exception("invalid lane accepted"); }
        catch (InvalidOperationException) { Console.WriteLine("PASS: invalid lane fails closed"); }
        var listener = new TcpListener(System.Net.IPAddress.Loopback, 0); listener.Start();
        var port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
        settings.ListenPrefix = $"http://127.0.0.1:{port}/";
        var server = new ControlApiServer(settings); server.Attach(new ProcessSupervisor(settings));
        await server.StartAsync(CancellationToken.None);
        try {
            using var client = new HttpClient { BaseAddress = new Uri(settings.ListenPrefix), Timeout = TimeSpan.FromSeconds(5) };
            foreach (var endpoint in new [] { "health", "api/runtime/environment", "api/runtime/doctor", "openapi.json", "api-docs" }) {
                var denied = await client.GetAsync(endpoint); Check((int)denied.StatusCode == 401, endpoint + " requires service key");
            }
            client.DefaultRequestHeaders.Add("X-SqlCockpit-Service-Key", "wrong-fixture-key");
            Check((int)(await client.GetAsync("api/runtime/environment")).StatusCode == 401, "wrong service key denied");
            client.DefaultRequestHeaders.Remove("X-SqlCockpit-Service-Key");
            client.DefaultRequestHeaders.Add("X-SqlCockpit-Service-Key", settings.ApiKey);
            foreach (var endpoint in new [] { "health", "api/runtime/environment", "api/runtime/doctor", "openapi.json", "api-docs" }) {
                var response = await client.GetAsync(endpoint); var body = await response.Content.ReadAsStringAsync();
                Check(response.IsSuccessStatusCode && (endpoint is "openapi.json" or "api-docs" || body.Contains("test")) && !body.Contains(settings.ApiKey), endpoint + " metadata excludes service key");
            }
        } finally { await server.StopAsync(); }
    }
}
