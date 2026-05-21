import { checkPostgresConnection } from '@/lib/postgres';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  try {
    const database = await checkPostgresConnection();

    return Response.json(
      {
        ok: true,
        database,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to connect to PostgreSQL.',
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }
}
