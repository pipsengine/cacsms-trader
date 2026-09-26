# Cacsms Trader — SQLite Database Foundation

## Layout
```
database/
  cacsms-trader.db      # runtime DB (gitignored)
  migrations/           # versioned schema changes
  seeds/                # reference data (29 instruments, currencies, defaults)
  backups/              # local backups only (gitignored contents)
  schema/               # generated schema snapshot after migrate
  scripts/              # Node migrate/seed/backup/health utilities
```

## Runtime modes
| Environment | SQLite role |
|---|---|
| **Local / central server** | `READ + WRITE` (`LOCAL_WRITABLE`) |
| **Vercel serverless** | Repository DB file is **NOT** trusted as persistent writable storage (`VERCEL_READONLY`) |

Do not implement workarounds that assume Vercel can permanently mutate `database/cacsms-trader.db`.
The TypeScript data-access ports in `src/db` stay portable so a future managed database can replace SQLite without redesigning Workflow Engine, MT5, Risk, or UI modules.

## Configure
```env
DATABASE_URL=file:./database/cacsms-trader.db
```

## Commands
```bash
npm run db:init      # migrate + seed + health + CRUD smoke test
npm run db:migrate
npm run db:seed
npm run db:health
npm run db:backup
npm run db:restore -- ./database/backups/<file>.db
npm run db:test
```

## Security
- Never store MT5 passwords, API secrets, or credentials as plaintext DB values.
- Use `credential_secret_ref` / `password_hash_ref` / `path_ref` pointing at a secret store.

## Application integration
UI modules must use `getDataAccess()` from `src/db` (or future server repositories), not ad-hoc SQL.
Browser builds use a read-only fixture fallback so Vite remains free of native SQLite bindings.
