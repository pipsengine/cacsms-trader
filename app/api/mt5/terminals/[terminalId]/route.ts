export const runtime = 'nodejs';

function bridgeUrl(): string {
  return process.env.NEXT_PUBLIC_MT5_BRIDGE_URL ?? 'http://localhost:8787';
}

export async function GET(_request: Request, context: { params: Promise<{ terminalId: string }> }): Promise<Response> {
  const { terminalId } = await context.params;
  const response = await fetch(`${bridgeUrl()}/terminals/${encodeURIComponent(terminalId)}`, { cache: 'no-store' });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

