import http from 'node:http';

const DEFAULT_PORT = Number(process.env.CACSMS_BRIDGE_CONTROL_PORT || 8766);

/**
 * Local-only HTTP control plane for restarting the MT5 bridge process.
 * Binds to 127.0.0.1 — not exposed to the network.
 */
export function startBridgeControlServer({ onRestart, port = DEFAULT_PORT } = {}) {
  if (typeof onRestart !== 'function') {
    throw new Error('startBridgeControlServer requires onRestart');
  }

  let busy = false;

  const server = http.createServer(async (req, res) => {
    const cors = () => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    };

    cors();

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const path = (req.url || '/').split('?')[0];

    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'bridge-control', port }));
      return;
    }

    if (req.method === 'POST' && path === '/restart') {
      if (busy) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Bridge restart already in progress' }));
        return;
      }
      busy = true;
      try {
        const result = await onRestart();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: error?.message || 'Restart failed' }));
      } finally {
        busy = false;
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'Not found' }));
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[bridge-control] listening on http://127.0.0.1:${port} (POST /restart)`);
  });

  return server;
}
