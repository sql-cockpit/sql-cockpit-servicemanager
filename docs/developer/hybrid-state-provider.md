# Host boundary for hybrid state

The Windows Host does not open an app-state database or customer SQL connection. It passes the selected lane data directory to child processes using `SQL_COCKPIT_SQLITE_STATE_ROOT` and constrains `SQL_COCKPIT_AUTH_STORE_PATH` to `<dataRoot>/sql-cockpit/sql-cockpit-local.sqlite`. This replaces an inherited per-file local auth override so one lane cannot accidentally select another lane's file.

`SQL_COCKPIT_STATE_PROVIDER` and hosted provider credentials remain inherited. API stores remain responsible for SQLite/local versus SQL Server/hosted provider selection, async calls and tenant scope. Hosted operation must not fall back to local state because a Host data directory is configured. No provider logic or SQL dialect is added to the Host.

The canonical new local root is `%ProgramData%/SqlCockpit/Environments/<lane>/data`. Existing settings and data are not migrated automatically. Back up and reconcile existing state using the parent repository migration procedure before changing roots; an empty new root can present as a fresh installation. See [lane operations](../runtime-lane-review.md) for defaults, affected settings, safe changes and verification limits.
