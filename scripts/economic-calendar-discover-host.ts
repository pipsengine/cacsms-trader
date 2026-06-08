import { EconomicCalendarIntelligenceService } from '../services/economic-data-service/src/economic-calendar-intelligence';

process.env.POSTGRES_HOST = process.env.POSTGRES_HOST ?? '127.0.0.1';
process.env.POSTGRES_PORT = process.env.POSTGRES_PORT ?? '5433';
process.env.POSTGRES_DB = process.env.POSTGRES_DB ?? 'db_cacsms-trader';
process.env.POSTGRES_USER = process.env.POSTGRES_USER ?? 'cacsms';
process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD ?? 'Adm1n.c0m';

async function main() {
  const action = String(process.argv[2] ?? 'discover').trim().toLowerCase();
  const service = new EconomicCalendarIntelligenceService();
  if (action === 'xml') {
    const result = await service.forexFactoryXmlSync('host_xml_sync');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = action === 'refresh'
    ? await service.recordAction('refresh')
    : await service.recordAction('discover');

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
