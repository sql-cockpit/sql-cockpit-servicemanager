# SDK-free semantic/runtime check. No publishing, SCM access or managed components.
$ErrorActionPreference = 'Stop'
Add-Type -Path "$PSHOME/Microsoft.CodeAnalysis.dll"
Add-Type -Path "$PSHOME/Microsoft.CodeAnalysis.CSharp.dll"
$paths = @{}
Get-ChildItem "$PSHOME/ref" -Filter '*.dll' | ForEach-Object { $paths[$_.Name] = $_.FullName }
$controller = Get-ChildItem (Join-Path $env:USERPROFILE '.nuget/packages/system.serviceprocess.servicecontroller') -Recurse -Filter System.ServiceProcess.ServiceController.dll |
    Where-Object FullName -like '*runtimes*win*lib*net8.0*' | Select-Object -First 1
if (-not $controller) { throw 'A cached Windows net8.0 ServiceController assembly is required.' }
$paths[$controller.Name] = $controller.FullName
$refs = [Microsoft.CodeAnalysis.MetadataReference[]]@($paths.Values | ForEach-Object { [Microsoft.CodeAnalysis.MetadataReference]::CreateFromFile($_) })
$trees = [Collections.Generic.List[Microsoft.CodeAnalysis.SyntaxTree]]::new()
$trees.Add([Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText('global using System; global using System.Collections.Generic; global using System.IO; global using System.Linq; global using System.Net.Http; global using System.Threading; global using System.Threading.Tasks;'))
foreach ($file in @('../windows/SqlCockpit.ServiceHost.Windows/Program.cs', '../windows/SqlCockpit.ServiceHost.Windows/ServiceHostOpenApi.cs', 'HostLaneChecks.cs')) {
    $trees.Add([Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText([IO.File]::ReadAllText((Join-Path $PSScriptRoot $file))))
}
$options = [Microsoft.CodeAnalysis.CSharp.CSharpCompilationOptions]::new([Microsoft.CodeAnalysis.OutputKind]::DynamicallyLinkedLibrary)
$compilation = [Microsoft.CodeAnalysis.CSharp.CSharpCompilation]::Create('HostLaneCheck', $trees, $refs, $options)
$stream = [IO.MemoryStream]::new()
$result = $compilation.Emit($stream)
if (-not $result.Success) { $result.Diagnostics | ForEach-Object ToString; throw 'Host semantic compile failed' }
[Runtime.Loader.AssemblyLoadContext]::Default.LoadFromAssemblyPath($controller.FullName) | Out-Null
$assembly = [Reflection.Assembly]::Load($stream.ToArray())
$task = $assembly.GetType('HostLaneChecks').GetMethod('Run').Invoke($null, @())
$null = $task.GetAwaiter().GetResult()
