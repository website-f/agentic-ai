// One print run (P85; paper 3.1 "cetak serta imbas semula label"): print the labels, stick each on its item, then scan
// each label back in slot order. A label that scans as another slot's item stops the run: it is on the wrong item.
// Only a camera or scanner read counts as the check; a typed ID does not.
import { useState } from 'react';
import { CheckCircleIcon, WarningIcon } from '@phosphor-icons/react';
import type { LabelTemplateId } from '@prima/core';
import { Card } from '../../kit';
import { Chip, ErrorNotice, useAction } from '../../ui';
import { LabelSheet, type PrintLabel } from './LabelSheet';
import { Scanner } from './Scanner';
import { act } from './shared';

export interface PrintResult {
  batchId: string;
  template: LabelTemplateId;
  symbols: ('qr' | 'code128')[];
  labels: (PrintLabel & { itemId: string })[];
}

export function PrintRun({ run, onDone }: { run: PrintResult; onDone?: () => void }) {
  const a = useAction();
  const [verified, setVerified] = useState<Set<string>>(new Set());
  const [wrong, setWrong] = useState<string | null>(null);
  const next = run.labels.find((l) => !verified.has(l.printId)) ?? null;
  const done = !next;
  return (
    <div className="it-stack">
      <Card title="1. Print the labels" sub="Stick each label on its item in the order shown.">
        <LabelSheet labels={run.labels} template={run.template} symbols={run.symbols} />
      </Card>
      <Card title="2. Scan each label back" sub={done ? 'Every label was scanned back and matched. The items can now be checked into stock.' : `Next: slot ${run.labels.indexOf(next!) + 1} of ${run.labels.length}, ${next!.display}`}>
        {!done && (
          <Scanner
            purpose="verify_print"
            contextId={next!.printId}
            title={`Scan label ${run.labels.indexOf(next!) + 1}`}
            continuous
            allowManual={false}
            busy={a.busy}
            onResult={async ({ verdict, entry }) => {
              if (verdict.outcome !== 'ok') {
                if (verdict.outcome === 'not_on_list') setWrong(`${verdict.label ?? 'This label'} is not the label of slot ${run.labels.indexOf(next!) + 1}. Stop and check which item each label is on.`);
                return;
              }
              setWrong(null);
              const r = await a.run(() => act({ kind: 'label.verify', printId: next!.printId, scan: entry }));
              if (r) setVerified((s) => new Set(s).add(next!.printId));
            }}
          />
        )}
        {wrong && (
          <p className="notice" data-tone="crit">
            <WarningIcon size={16} aria-hidden="true" /> {wrong}
          </p>
        )}
        <ErrorNotice error={a.error} />
        <ol className="it-slots">
          {run.labels.map((l, k) => (
            <li key={l.printId} data-state={verified.has(l.printId) ? 'done' : l === next ? 'now' : 'todo'}>
              <span className="it-slot-n">{k + 1}</span>
              <span className="mono">{l.display}</span>
              <span className="muted">
                {l.sku}
                {l.size ? ` ${l.size}` : ''}
              </span>
              {verified.has(l.printId) ? (
                <Chip tone="ok">
                  <CheckCircleIcon size={14} aria-hidden="true" /> Matched
                </Chip>
              ) : (
                <Chip tone="neutral">Not yet</Chip>
              )}
            </li>
          ))}
        </ol>
        {done && onDone && (
          <button className="btn btn-primary it-big" type="button" onClick={onDone}>
            Finished
          </button>
        )}
      </Card>
    </div>
  );
}
