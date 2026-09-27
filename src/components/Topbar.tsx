import { useEffect, useState } from 'react';
import { Bell, Clock3, Search, Wifi } from 'lucide-react';
import { bridgeHealth } from '../features/mt5-connection/services/mt5BridgeClient';
import { getMarketSessionInfo } from '../utils/marketSession';
import '../styles/topbar-session.css';

export default function Topbar() {
  const [clock, setClock] = useState(() => getMarketSessionInfo());
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [feedOk, setFeedOk] = useState(false);

  useEffect(() => {
    const tick = () => setClock(getMarketSessionInfo());
    tick();
    const clockTimer = window.setInterval(tick, 1000);

    const pollHealth = async () => {
      const h = await bridgeHealth();
      setFeedOk(Boolean(h.ok && h.terminalConnected));
      setLatencyMs(typeof h.pingLastMs === 'number' ? h.pingLastMs : null);
    };
    void pollHealth();
    const healthTimer = window.setInterval(() => void pollHealth(), 3000);

    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(healthTimer);
    };
  }, []);

  const latencyLabel =
    latencyMs == null ? '—' : latencyMs >= 1000 ? `${(latencyMs / 1000).toFixed(1)}s` : `${latencyMs}ms`;

  return (
    <header className="topbar">
      <div className="search">
        <Search size={16} />
        <input placeholder="Search instrument, trade, signal..." />
      </div>
      <div className="top-actions">
        <span className={'top-latency' + (feedOk ? ' ok' : '')} title={feedOk ? 'MT5 terminal feed' : 'MT5 bridge offline'}>
          <Wifi size={15} /> {latencyLabel}
        </span>
        <div className="top-session" title="FX market session · Nigeria local time (WAT)">
          <Clock3 size={15} />
          <div className="top-session-copy">
            <b>
              {clock.session}
              <em className={clock.status === 'Open' ? 'open' : 'closed'}> · {clock.status}</em>
            </b>
            <small>{clock.nigeriaLabel}</small>
          </div>
        </div>
        <button type="button" aria-label="Notifications">
          <Bell size={17} />
          <i />
        </button>
        <div className="avatar">AT</div>
      </div>
    </header>
  );
}
