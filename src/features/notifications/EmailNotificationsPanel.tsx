import { useEffect, useState } from 'react';
import { Badge, Card } from '../../components/UI';
import './notifications.css';
import {
  EVENT_LABEL,
  fetchNotificationHistory,
  fetchNotificationStatus,
  formatNotificationTime,
  saveNotificationSettings,
  sendTestEmail,
  type NotificationPolicies,
  type NotificationRow,
  type NotificationStatus,
} from './notificationClient';

const MARKET = [
  'CHANNEL_BREAK_APPROACH',
  'CHANNEL_BREAK_DETECTED',
  'CHANNEL_BREAK_CONFIRMED',
  'CHANNEL_BREAK_FAILED',
  'CHANNEL_RETEST_STARTED',
  'CHANNEL_RETEST_HELD',
  'CHANNEL_RETEST_FAILED',
];
const OPPORTUNITY = ['P1_ZONE_REACHED', 'P1_REACTION_DETECTED', 'P1_READY_FOR_RISK', 'P2_READY_FOR_RISK'];
const AUTHORIZATION = ['P1_AUTHORIZED', 'P2_AUTHORIZED'];
const EXECUTION = ['ORDER_SUBMITTED', 'ORDER_FILLED', 'ORDER_REJECTED', 'POSITION_CLOSED'];
const SYSTEM = ['MT5_DISCONNECTED', 'MARKET_DATA_STALE', 'CALENDAR_FEED_STALE'];
const FILTERS = ['ALL', 'SENT', 'FAILED', 'PENDING'] as const;

function tone(health?: string): string {
  if (health === 'READY') return 'green';
  if (health === 'CHECKING' || health === 'DEGRADED') return 'blue';
  if (health === 'AUTH_FAILED' || health === 'CONNECTION_FAILED' || health === 'FAILED') return 'red';
  return 'gray';
}

export function EmailNotificationsPanel() {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');
  const [recipient, setRecipient] = useState('pipsengine@gmail.com');
  const [smtpForm, setSmtpForm] = useState({
    host: 'smtp.gmail.com',
    port: '587',
    secure: false,
    user: 'pipsengine@gmail.com',
    fromEmail: 'pipsengine@gmail.com',
    fromName: 'PipsEngine Trading System',
    appPassword: '',
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (next = filter) => {
    void fetchNotificationStatus()
      .then((body) => {
        setStatus(body);
        if (body.recipient) setRecipient(body.recipient);
        if (body.smtp) {
          setSmtpForm((prev) => ({
            ...prev,
            host: body.smtp?.host || prev.host,
            port: String(body.smtp?.port || prev.port),
            secure: !!body.smtp?.secure,
            user: body.smtp?.user || prev.user,
            fromEmail: body.smtp?.fromEmail || prev.fromEmail,
            fromName: body.smtp?.fromName || prev.fromName,
            appPassword: '',
          }));
        }
      })
      .catch(() => setStatus((prev) => prev));
    void fetchNotificationHistory(next)
      .then((body) => setRows(body.notifications || []))
      .catch(() => setRows([]));
  };

  useEffect(() => {
    load(filter);
  }, [filter]);

  const policies = status?.policies || {};

  const save = (patch: Partial<NotificationStatus> & { policies?: NotificationPolicies }) => {
    setBusy(true);
    void saveNotificationSettings({
      masterEnabled: status?.masterEnabled,
      fxEnabled: status?.fxEnabled,
      xauEnabled: status?.xauEnabled,
      recipient,
      policies,
      ...patch,
    })
      .then((body) => {
        setStatus(body);
        setMessage(body.ok === false ? body.message || 'Settings were not saved' : 'Notification settings saved');
        load(filter);
      })
      .catch(() => setMessage('Settings were not saved'))
      .finally(() => setBusy(false));
  };

  const togglePolicy = (key: string) => save({ policies: { ...policies, [key]: !policies[key] } });

  return (
    <Card>
      <h3>Email Notifications</h3>
      <div className="kv">
        <span>Status</span>
        <b><Badge tone={tone(status?.health)}>{status?.health || 'CHECKING'}</Badge></b>
        <span>Sender</span>
        <b>{status?.sender || 'PipsEngine Trading System <pipsengine@gmail.com>'}</b>
        <span>Recipient</span>
        <b>{status?.recipient || '—'}</b>
        <span>Queue</span>
        <b>{status?.pending ?? '—'} pending · {status?.failedToday ?? '—'} failed today · {status?.deadLetter ?? '—'} dead letter</b>
      </div>
      <div className="note-actions">
        <label className="note-row">
          <span>Master email alerts</span>
          <input
            type="checkbox"
            checked={status?.masterEnabled !== false}
            disabled={!status || busy}
            onChange={() => save({ masterEnabled: !(status?.masterEnabled !== false) })}
          />
        </label>
        <label className="note-row">
          <span>FX</span>
          <input type="checkbox" checked={status?.fxEnabled !== false} disabled={!status || busy} onChange={() => save({ fxEnabled: !(status?.fxEnabled !== false) })} />
        </label>
        <label className="note-row">
          <span>XAUUSD</span>
          <input type="checkbox" checked={status?.xauEnabled !== false} disabled={!status || busy} onChange={() => save({ xauEnabled: !(status?.xauEnabled !== false) })} />
        </label>
      </div>
      <div className="note-groups">
        <PolicyGroup title="Market structure" keys={MARKET} policies={policies} disabled={!status || busy} onToggle={togglePolicy} />
        <PolicyGroup title="Opportunities" keys={OPPORTUNITY} policies={policies} disabled={!status || busy} onToggle={togglePolicy} />
        <PolicyGroup title="Authorization" keys={AUTHORIZATION} policies={policies} disabled={!status || busy} onToggle={togglePolicy} />
        <PolicyGroup title="Execution" keys={EXECUTION} policies={policies} disabled={!status || busy} onToggle={togglePolicy} />
        <PolicyGroup title="System alerts" keys={SYSTEM} policies={policies} disabled={!status || busy} onToggle={togglePolicy} />
      </div>
      <p className="muted">Execution emails are sent only after Stage 9 receives a real broker result. A channel-break email is not an order.</p>
      <h4>SMTP account</h4>
      <p className="muted">
        {status?.smtp?.configured ? 'An app password is saved on the server.' : 'No app password is saved yet.'} A blank password leaves the saved one in place. The password is not shown again.
      </p>
      <div className="note-form">
        <label>
          SMTP host
          <input aria-label="SMTP host" value={smtpForm.host} onChange={(e) => setSmtpForm((s) => ({ ...s, host: e.target.value }))} />
        </label>
        <label>
          Port
          <input aria-label="SMTP port" value={smtpForm.port} onChange={(e) => setSmtpForm((s) => ({ ...s, port: e.target.value }))} />
        </label>
        <label>
          SMTP user
          <input aria-label="SMTP user" type="email" value={smtpForm.user} onChange={(e) => setSmtpForm((s) => ({ ...s, user: e.target.value }))} />
        </label>
        <label>
          From email
          <input aria-label="From email" type="email" value={smtpForm.fromEmail} onChange={(e) => setSmtpForm((s) => ({ ...s, fromEmail: e.target.value }))} />
        </label>
        <label>
          From name
          <input aria-label="From name" value={smtpForm.fromName} onChange={(e) => setSmtpForm((s) => ({ ...s, fromName: e.target.value }))} />
        </label>
        <label>
          App password
          <input
            aria-label="App password"
            type="password"
            autoComplete="new-password"
            value={smtpForm.appPassword}
            placeholder={status?.smtp?.configured ? 'Saved — enter a new app password to replace it' : 'Google App Password'}
            onChange={(e) => setSmtpForm((s) => ({ ...s, appPassword: e.target.value }))}
          />
        </label>
        <label className="note-row">
          <span>Implicit SSL</span>
          <input aria-label="Implicit SSL" type="checkbox" checked={smtpForm.secure} onChange={() => setSmtpForm((s) => ({ ...s, secure: !s.secure }))} />
        </label>
      </div>
      <p className="muted">Leave Implicit SSL off for smtp.gmail.com on port 587. That connection uses STARTTLS.</p>
      <div className="note-actions">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void saveNotificationSettings({
              masterEnabled: status?.masterEnabled,
              fxEnabled: status?.fxEnabled,
              xauEnabled: status?.xauEnabled,
              recipient,
              policies,
              smtpHost: smtpForm.host,
              smtpPort: Number(smtpForm.port),
              smtpSecure: smtpForm.secure,
              smtpUser: smtpForm.user,
              smtpFromEmail: smtpForm.fromEmail,
              smtpFromName: smtpForm.fromName,
              smtpAppPassword: smtpForm.appPassword,
            })
              .then((body) => {
                setStatus(body);
                setSmtpForm((s) => ({ ...s, appPassword: '' }));
                setMessage(body.ok === false ? body.message || 'SMTP account was not saved' : 'SMTP account saved');
                load(filter);
              })
              .catch(() => setMessage('SMTP account was not saved'))
              .finally(() => setBusy(false));
          }}
        >
          Save SMTP account
        </button>
      </div>
      <div className="note-actions">
        <input
          type="email"
          aria-label="Alert recipient"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />
        <button type="button" className="primary" disabled={busy} onClick={() => save({ recipient })}>
          Save recipient
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void sendTestEmail()
              .then((body) => {
                setStatus(body);
                setMessage(body.message || (body.ok ? 'Test email accepted' : 'Test email was not sent'));
                load(filter);
              })
              .catch(() => setMessage('Test email was not sent'))
              .finally(() => setBusy(false));
          }}
        >
          Send test email
        </button>
      </div>
      {message ? <p className="muted">{message}</p> : null}
      <h4>Notification history</h4>
      <div className="note-filters">
        {FILTERS.map((id) => (
          <button key={id} type="button" className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{id}</button>
        ))}
      </div>
      <table className="note-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Instrument</th>
            <th>Event</th>
            <th>TiT</th>
            <th>Recipient</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.notificationId || row.subject}>
              <td>{formatNotificationTime(row.sentAt || row.createdAt)}</td>
              <td>{row.symbol || '—'}</td>
              <td>{EVENT_LABEL[row.eventType || ''] || row.eventType}</td>
              <td>{row.titLevel || '—'}</td>
              <td>{row.recipient}</td>
              <td>{row.status}</td>
            </tr>
          )) : (
            <tr><td colSpan={6}>No notifications in this filter.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function PolicyGroup({ title, keys, policies, disabled, onToggle }: {
  title: string;
  keys: string[];
  policies: NotificationPolicies;
  disabled: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <div>
      <h4>{title}</h4>
      {keys.map((key) => (
        <label className="note-row" key={key}>
          <span>{EVENT_LABEL[key] || key}</span>
          <input type="checkbox" checked={!!policies[key]} disabled={disabled} onChange={() => onToggle(key)} />
        </label>
      ))}
    </div>
  );
}

export function CandidateEmailStatus({ candidateId }: { candidateId: string }) {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  useEffect(() => {
    let stop = false;
    const load = () => {
      void fetchNotificationHistory('ALL', candidateId)
        .then((body) => {
          if (!stop) setRows(body.notifications || []);
        })
        .catch(() => {
          if (!stop) setRows([]);
        });
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [candidateId]);
  const latest = rows[0];
  return (
    <article className="ca-panel cb-mail">
      <h3>Email notification</h3>
      {!latest ? (
        <p>Email: Waiting for enabled event.</p>
      ) : (
        <>
          <p>{EVENT_LABEL[latest.eventType || ''] || latest.eventType}</p>
          <p>{latest.status} · {formatNotificationTime(latest.sentAt || latest.createdAt)}</p>
          <p>Recipient: {latest.recipient}</p>
        </>
      )}
      {rows.length > 0 && (
        <ul>
          {rows.slice(0, 6).map((row) => (
            <li key={row.notificationId}>
              {EVENT_LABEL[row.eventType || ''] || row.eventType} · {row.status}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
