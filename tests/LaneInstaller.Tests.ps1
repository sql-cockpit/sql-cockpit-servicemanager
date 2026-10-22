Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Describe 'Lane installer settings without publishing or SCM access' {
    BeforeAll {
        $installer = Join-Path $PSScriptRoot '../windows/Install-SqlCockpitWindowsService.ps1'
        $source = Get-Content $installer -Raw
        $prefix = $source.Substring(0, $source.IndexOf('$isAdmin ='))
        . ([scriptblock]::Create($prefix))
    }
    It 'replaces argument values without dropping neighboring flags' {
        $result = Set-ArgPair -Args @('server.js','--listenPrefix','old','--dev') -Name '--listenPrefix' -Value 'new'
        ($result -join '|') | Should -Be 'server.js|--listenPrefix|new|--dev'
    }
    It 'adds missing argument pairs' {
        ((Set-ArgPair -Args @('server.js') -Name '--environmentId' -Value 'test') -join '|') | Should -Be 'server.js|--environmentId|test'
    }
    It 'writes isolated lane paths ports and explicit service identity into a new settings copy' {
        $file = Join-Path $TestDrive 'settings.json'
        Copy-Item (Join-Path $PSScriptRoot '../windows/sql-cockpit-service.prod.settings.json') $file
        $defaults = Get-LaneDefaults test
        $defaults.ServiceName = 'Fixture.Custom.Test'
        Set-ServiceSettingsLane -SettingsPath $file -EnvironmentId test -Defaults $defaults -ReleaseVersion '1.2.3' -BuildSha 'fixture'
        $settings = Get-Content $file -Raw | ConvertFrom-Json
        $settings.environmentId | Should -Be 'test'
        $settings.serviceName | Should -Be 'Fixture.Custom.Test'
        $settings.dataRoot | Should -Be (Join-Path $env:ProgramData 'SqlCockpit/Environments/test/data')
        $settings.logsRoot | Should -Be (Join-Path $env:ProgramData 'SqlCockpit/Environments/test/Logs')
        $settings.listenPrefix | Should -Be 'http://127.0.0.1:8620/'
        $settings.releaseVersion | Should -Be '1.2.3'
        $web = $settings.components | Where-Object id -eq 'web-api'
        $web.healthUrl | Should -Be 'http://127.0.0.1:8200/health'
        ($web.args -join '|') | Should -Match 'environmentId\|test'
    }
}
