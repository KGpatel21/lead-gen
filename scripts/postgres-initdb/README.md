# Postgres init.d

Any `*.sql` / `*.sh` files dropped here run once, at Postgres container
first boot, before any application connects. Use it for one-time
role/DB provisioning that must happen before the backend's own
migrations. **Do not** put schema DDL here — the application owns its
own migrations at `server/db/migrations.ts`.

Empty by default; kept as a mount point so `docker compose config`
resolves the bind mount cleanly.
