import { CftcCotFuturesOnlyCollectorService } from '../services/cot-sync-service/src/cftc-cot-futures-only-collector';

process.env.POSTGRES_HOST = process.env.POSTGRES_HOST ?? '127.0.0.1';
process.env.POSTGRES_PORT = process.env.POSTGRES_PORT ?? '5433';
process.env.POSTGRES_DB = process.env.POSTGRES_DB ?? 'db_cacsms-trader';
process.env.POSTGRES_USER = process.env.POSTGRES_USER ?? 'cacsms';
process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD ?? 'Adm1n.c0m';

async function main() {
  const mode = String(process.argv[2] ?? 'last-2-years').trim().toLowerCase();
  const collector = new CftcCotFuturesOnlyCollectorService();
  const result =
    mode === 'latest'
      ? await collector.syncLatest()
      : mode === 'current-year'
        ? await collector.syncCurrentYear()
        : mode === 'previous-year'
          ? await collector.syncPreviousYear()
          : await collector.syncLast2Years();

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
