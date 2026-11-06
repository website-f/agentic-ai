/**
 * P78: Connections inside the Agentic Office. Prima and the office are one system, so a person's Microsoft 365 is the
 * one they connected in the office (their sign-in, Outlook, calendar and Teams). This screen shows that connection and
 * sends them to the office to connect or reconnect it; it never asks for a second Microsoft sign-in.
 */
import { CalendarBlankIcon, ChatsCircleIcon, CheckCircleIcon, EnvelopeSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { Card, Facts, PageHead } from '../kit';
import { Chip, ErrorNotice, Loading, useLoad } from '../ui';

interface OfficeAccount {
  connected: boolean;
  email: string | null;
  display_name: string | null;
  status: string;
  mail_ok: boolean;
  calendar_ok: boolean;
  teams_ok: boolean;
  last_sync_at: string | null;
  last_error: string | null;
}

async function officeAccount(): Promise<OfficeAccount> {
  const res = await fetch('/api/integrations/microsoft/account', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('The office could not read your Microsoft 365 connection. Refresh, or open Mail in the office.');
  return (await res.json()) as OfficeAccount;
}

function Row({ ok, icon, label, okText, offText }: { ok: boolean; icon: React.ReactNode; label: string; okText: string; offText: string }) {
  return (
    <li className="ss-row">
      <span className="ix-conn-icon" aria-hidden="true">{icon}</span>
      <span className="ss-row-main">
        <b>{label}</b>
        <small>{ok ? okText : offText}</small>
      </span>
      {ok ? <Chip tone="ok">Ready</Chip> : <Chip tone="warn">Reconnect</Chip>}
    </li>
  );
}

function when(iso: string | null): string {
  if (!iso) return 'Not yet';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });
}

export function OfficeConnections() {
  const { data, error, reload } = useLoad(officeAccount, []);
  const open = (path: string) => window.top?.location.assign(path);
  const healthy = !!data?.connected && data.status !== 'error' && data.status !== 'expired';
  return (
    <div className="page">
      <PageHead
        title="Connections"
        sub="Your Microsoft 365 is connected once, in the Agentic Office. Prima uses that same connection."
        actions={
          <>
            <button className="btn" onClick={reload}>Refresh</button>
            <button className="btn btn-primary" onClick={() => open('/mail')}>
              {data?.connected ? 'Manage in the office' : 'Connect Microsoft 365'}
            </button>
          </>
        }
      />
      {error && <ErrorNotice error={error} />}
      {!data && !error && <Loading what="your Microsoft 365 connection" />}
      {data && (
        <>
          <div className="ss-hero" data-on={healthy ? '' : undefined}>
            <span className="ss-hero-icon" aria-hidden="true">
              {healthy ? <CheckCircleIcon size={26} /> : <WarningCircleIcon size={26} />}
            </span>
            <div className="ss-hero-main">
              <span className="ss-hero-kicker">Microsoft 365</span>
              <span className="ss-hero-title">
                {data.connected ? `Connected as ${data.display_name || data.email}` : 'Not connected yet'}
              </span>
              <span className="ss-hero-sub">
                {data.connected
                  ? `${data.email ?? ''}${data.last_sync_at ? ` · last synced ${when(data.last_sync_at)}` : ''}`
                  : 'Connect it once in the office: your Outlook, calendar and Teams then work here and in the office.'}
              </span>
            </div>
            <div className="ss-hero-side">
              {healthy ? <Chip tone="ok">Connected</Chip> : data.connected ? <Chip tone="warn">Needs attention</Chip> : <Chip tone="warn">Not connected</Chip>}
            </div>
          </div>
          {data.last_error && (
            <p className="notice" data-tone="warn" role="status">
              {data.last_error}
            </p>
          )}
          {data.connected && (
            <Card title="What it covers" flush>
              <ul className="ss-rows">
                <Row ok={data.mail_ok} icon={<EnvelopeSimpleIcon size={18} />} label="Outlook mail" okText="Read and file mail, attach emails to work" offText="Reconnect once in the office to allow mail" />
                <Row ok={data.calendar_ok} icon={<CalendarBlankIcon size={18} />} label="Calendar" okText="Meetings and reminders" offText="Reconnect once in the office to allow the calendar" />
                <Row ok={data.teams_ok} icon={<ChatsCircleIcon size={18} />} label="Teams" okText="Your chats and channels" offText="Reconnect once in the office to allow Teams" />
              </ul>
            </Card>
          )}
          <Card title="Good to know">
            <Facts
              items={[
                ['Sign-in', 'You are signed in to Prima through the office with Microsoft. There is no second sign-in.'],
                ['Your AI workers', 'They act in Prima for you through the same connection, and ask you before recording anything.'],
                ['Disconnect', 'Disconnect or switch account in the office, under Mail.'],
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
