# Windows Host lane configuration and review

This component is the Windows process supervisor. The standalone
`sql-cockpit-service-control` repository supplies the current desktop control app;
the companion Electron sources retained here are a separate legacy entry point.
Do not replace the standalone app with this copy as part of branch consolidation.

## Configuration contract

These settings are local operational JSON, not database configuration rows. They
do not select Standard/Enterprise editions or disable Demo Mode. Existing settings
files are retained by the installer; no state files are moved automatically.

| Setting | Location and values | Default and runtime effect |
| --- | --- | --- |
| `EnvironmentId` | Installer parameter: empty, `dev`, `test`, `prod` | Empty retains legacy service name/settings selection; explicit lanes use suffixed names and isolated settings/publish directories. |
| `environmentId` | Host settings JSON; `dev`, `test`, `prod`; development/testing/beta/production aliases accepted by Host | Missing/empty maps to `prod`; unknown values fail startup instead of selecting another lane. |
| `channelName` | Host settings JSON, display string | Missing/empty follows normalized environment identity. |
| `serviceName` | Host settings JSON and installer `ServiceName` parameter | Legacy name is `SQLCockpitServiceHost`; explicit lanes use `.Dev`, `.Test`, `.Prod`. Explicit custom names must match both SCM registration and JSON. |
| `dataRoot` | Host settings JSON, absolute local directory | `%ProgramData%/SqlCockpit/Environments/<lane>/data`; passed to child processes as `SQL_COCKPIT_SQLITE_STATE_ROOT`. |
| `logsRoot` | Host settings JSON, absolute local directory | `%ProgramData%/SqlCockpit/Environments/<lane>/Logs`; supervisor writes beneath `ServiceHost/<lane>/<component>`. |
| `releaseVersion`, `buildSha` | Host JSON or installer `ReleaseVersion`, `BuildSha` parameters | Empty until supplied; diagnostic metadata and child environment only. They do not verify or promote artifacts. |
| `listenPrefix` | Host settings JSON, listener URI | Legacy `http://127.0.0.1:8610/`; explicit dev/test/prod installation uses 8610/8620/8630. Keep loopback binding. |
| `requireLocalRequests` | Host settings JSON, boolean | `true`; requires a loopback client. The legacy `false` mode bypasses Host authorization and is unsuitable for remote/public exposure. |
| `apiKey` | Protected Host settings JSON, secret string | Empty supports legacy local access; when configured with local enforcement, callers must send `X-SqlCockpit-Service-Key`. Never commit a real key. |

The Host passes lane, channel, release and commit metadata into each managed child.
It replaces an inherited `SQL_COCKPIT_AUTH_STORE_PATH` with
`<dataRoot>/sql-cockpit/sql-cockpit-local.sqlite` so an unrelated parent process
cannot silently select another lane's local account store. It preserves
`SQL_COCKPIT_STATE_PROVIDER` and hosted provider credentials; this is a local SQLite
path boundary, not a replacement for tenant-scoped hosted storage. Provider/store
modules remain responsible for persistence. No customer SQL connection is opened
by these changes.

Explicit lane installations select these defaults:

| Lane | Host | API | Docs | Notifications | Object Search |
| --- | --- | --- | --- | --- | --- |
| dev | 8610 | 8080 | 8001 | 8090 | 8094 |
| test | 8620 | 8200 | 8201 | 8290 | 8294 |
| prod | 8630 | 8300 | 8301 | 8390 | 8394 |

New installer paths and the companion Electron lane lookup use
`SqlCockpit/Environments/<lane>`. The previous proposal's `SqlCockpit/<lane>` paths
are not silently migrated. Without an explicit lane/path, the legacy production
JSON under `SqlCockpit/sql-cockpit-service.settings.json` is still supported.
Explicit missing paths, unknown lane names and cross-lane files fail closed.
Opening an explicitly scoped lane UI does not rewrite ports, runtime profile,
disabled components or auto-start choices. Numeric SCM statuses are displayed as
readable names, and diagnostic row values are rendered as text rather than HTML.

## Local diagnostic API

These routes belong to the Windows Host listener, not the public Next.js API.
They use local Host authorization, not web-user RBAC. Requests have no body.

| Method and path | Response |
| --- | --- |
| `GET /health` | Status, service, lane/channel, service name, release, commit and UTC time. |
| `GET /api/runtime/environment` | Lane/channel, service/control URL, configured source/settings/data/log paths and release metadata. |
| `GET /api/runtime/doctor` | `environment`, configuration `checks` and supervisor `runtime` snapshot. Reads component health; does not start/restart services. |
| `GET /openapi.json` | OpenAPI contract for lane diagnostics. |
| `GET /api-docs` | Swagger UI for this local contract; UI assets require network access. |

All routes are behind the same Host authorization check. Missing/wrong configured
keys return 401; operational failures return 500 with an error object. Metadata
does not include `apiKey`, connection passwords or invitation tokens. Paths and
component diagnostics are still operational information: do not expose this
listener through the public OVH reverse proxy or use it as a public demo API.
The checked-in contract is [service-host-openapi.json](service-host-openapi.json).
For a configured service key, fetch the contract with a header-bearing client;
never put keys in URLs. Local keyless mode allows opening `/api-docs` directly.

## Safe change procedure

1. Back up the existing settings and lane data; identify the actual running
   service's settings path before changing anything.
2. Prepare a separate JSON copy. Reconcile legacy data using the parent
   `scripts/runtime/migrate-sqlite-lane-state.js` procedure; changing a path alone
   does not move accounts, profiles or other state. Existing-state migration has
   not been validated by this branch review.
3. Verify service name, lane identity, writable data/log directories, unique ports
   and Object Search paths. Explicit installer identity mismatches are rejected
   before stopping an existing service. Existing JSON is not overwritten.
4. Test changes in dev. Keep test/prod on promoted main artifacts; this source
   installer publishes from its checkout and is not the promotion mechanism.
5. Inspect local diagnostics with the service key supplied through a protected
   client environment/header. Confirm the expected lane and component endpoints
   before starting workloads.

## Verification without packaging or service changes

```powershell
node --test tests/lane-selection.test.js
Import-Module Pester -MinimumVersion 5.0
Invoke-Pester tests/LaneInstaller.Tests.ps1
pwsh -NoProfile -File tests/Invoke-HostLaneChecks.ps1
```

The last check uses PowerShell 7's Roslyn compiler and a cached Windows net8.0
ServiceController assembly. It semantically compiles the source in memory and
checks diagnostics on a temporary loopback port. It is not a .NET 8 production
build, SCM installation or installed-service start/stop test. No managed component
is launched. Source Electron smoke checks must use isolated ProgramData/settings,
`--autoStartApi false` and a separate user-data directory. Leave installed lanes
running. Installer packaging remains outside this review.

Confirmed: regression tests cover settings paths, missing/cross-lane rejection,
preserved lane configuration, child state paths, provider selection preservation,
Host authorization and credential redaction. Real SCM installation, existing-data
migration and customer SQL execution remain unverified.
