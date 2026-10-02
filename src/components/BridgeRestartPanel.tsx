import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { bridgeControlHealth, restartMt5Bridge, waitForBridgeHealth } from '../services/bridgeControl';
import { Badge } from './UI';

type Phase = 'idle' | 'restarting' | 'waiting' | 'done' | 'error';

export function BridgeRestartPanel({ compact = false }: { compact?: boolean }) {
  const [controlOk, setControlOk] = useState<boolean | null>(null);
  const [controlMsg, setControlMsg] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [detail, setDetail] = useState<string | null>(null);

  const refreshControl = useCallback(async () => {
    const h = await bridgeControlHealth();
    setControlOk(h.ok);
    setControlMsg(h.ok ? 'Local restart control online' : h.message || 'Control offline');
  }, []);

  useEffect(() => {
    void refreshControl();
  }, [refreshControl]);

  const onRestart = async () => {
    if (!controlOk || phase === 'restarting' || phase === 'waiting') return;
    if (!window.confirm('Restart the MT5 bridge? Live analysis will pause for a few seconds. No trades are sent by this action.')) {
      return;
    }
    setPhase('restarting');
    setDetail(null);
    try {
      const result = await restartMt5Bridge();
      setPhase('waiting');
      setDetail(result.message || 'Restart signalled');
      const up = await waitForBridgeHealth();
      setPhase(up ? 'done' : 'error');
      setDetail(up ? 'Bridge is responding again.' : 'Bridge did not respond in time — check the terminal running npm run dev or mt5:bridge.');
      void refreshControl();
    } catch (e) {
      setPhase('error');
      setDetail(e instanceof Error ? e.message : 'Restart failed');
    }
  };

  const busy = phase === 'restarting' || phase === 'waiting';

  return (
    <div className={'bridge-restart' + (compact ? ' compact' : '')}>
      {!compact && <h3>MT5 bridge</h3>}
      <p className="muted bridge-restart-hint">
        Restarts the local Python bridge (schema reload, new routes, engine recovery). Works when the app is started with{' '}
        <code>npm run dev</code> or <code>npm run mt5:bridge</code>.
      </p>
      <div className="bridge-restart-row">
        <Badge tone={controlOk ? 'green' : 'red'}>{controlOk ? 'RESTART READY' : 'RESTART UNAVAILABLE'}</Badge>
        <button type="button" className="primary" disabled={!controlOk || busy} onClick={() => void onRestart()}>
          <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? 'Restarting…' : 'Restart bridge'}
        </button>
      </div>
      {controlMsg && <small className="muted">{controlMsg}</small>}
      {detail && <p className={phase === 'error' ? 'alert' : 'bridge-restart-detail'}>{detail}</p>}
    </div>
  );
}
