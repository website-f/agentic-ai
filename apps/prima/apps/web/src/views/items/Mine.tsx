// My items (paper section 10): what the company handed to me, what waits for my confirmation, and loans or rentals
// overdue. Confirm by scanning the label, or say you did not get it. Nothing is ever charged to you automatically.
import { labelDisplay } from '@prima/core';
import type { ItemBoard } from '../../api';
import { Card, Empty, Stat, Stats } from '../../kit';
import { Chip, dateLabel } from '../../ui';
import { ConfirmMine } from './Passport';

export function Mine({ data }: { data: ItemBoard }) {
  const waiting = new Set(data.mineWaiting);
  const overdue = new Set(data.mineOverdue);
  return (
    <div className="it-stack">
      <Stats>
        <Stat label="With me" value={data.mine.length} tone="info" />
        <Stat label="Waiting for me" value={waiting.size} tone={waiting.size ? 'warn' : 'ok'} />
        <Stat label="Overdue back" value={overdue.size} tone={overdue.size ? 'crit' : 'ok'} />
      </Stats>
      {data.myUniform && (
        <p className="notice" data-tone="info">
          Uniform this year: {data.myUniform.free} free piece(s) in the last 12 months (at least {data.myUniform.rule.minPerYear}, at most {data.myUniform.rule.maxPerYear})
          {data.myUniform.paid ? `, plus ${data.myUniform.paid} you paid for` : ''}. A 4th or 5th piece is paid by you with your own receipt; never taken from your pay.
          {data.myUniform.nextDue ? ` Next piece usually from ${dateLabel(data.myUniform.nextDue)}.` : ' You can ask your store for one.'}
        </p>
      )}
      {!data.mine.length && (
        <Card title="Items with me">
          <Empty title="Nothing is recorded with you." />
        </Card>
      )}
      {data.mine.map(({ item, sku }) => (
        <div key={item.id} className="it-stack">
          <Card title={sku ? sku.name : 'Item'} sub={<span className="mono">{labelDisplay(item.token)}</span>} actions={waiting.has(item.id) ? <Chip tone="warn">Please confirm</Chip> : overdue.has(item.id) ? <Chip tone="crit">Overdue back</Chip> : <Chip tone="ok">Confirmed</Chip>}>
            {item.dueBack && <p className="muted">Due back to its owner on {dateLabel(item.dueBack.on)}.</p>}
          </Card>
          {waiting.has(item.id) && <ConfirmMine token={item.token} onDone={() => undefined} />}
        </div>
      ))}
    </div>
  );
}
