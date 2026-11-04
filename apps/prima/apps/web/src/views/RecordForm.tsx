import { useEffect, useState } from 'react';
import type { RecordKind, RecordValues } from '@prima/core';
import { api, type RecordFormData } from '../api';
import { useApp } from '../App';
import { Drawer, ErrorNotice, Loading, useAction } from '../ui';

/**
 * Add and Edit buttons for plain records (Fauzan, 27 Oct 2026). One form, built from the record's field list in core;
 * the button shows only for the people who keep that kind of record. The server checks again on save.
 */

const kindsCache = new Map<string, Promise<RecordKind[]>>();

export function useRecordKinds(): Set<RecordKind> {
  const { me } = useApp();
  const [kinds, setKinds] = useState<Set<RecordKind>>(new Set());
  useEffect(() => {
    let live = true;
    const key = me.user.id;
    if (!kindsCache.has(key))
      kindsCache.set(
        key,
        api.recordKinds().catch(() => []),
      );
    kindsCache.get(key)!.then((k) => live && setKinds(new Set(k)));
    return () => {
      live = false;
    };
  }, [me.user.id]);
  return kinds;
}

export function RecordButton({
  kind,
  id = null,
  companyId = null,
  label,
  primary = false,
}: {
  kind: RecordKind;
  id?: string | null;
  companyId?: string | null;
  label?: string;
  primary?: boolean;
}) {
  const kinds = useRecordKinds();
  const [open, setOpen] = useState(false);
  if (!kinds.has(kind)) return null;
  return (
    <>
      <button
        className={`btn btn-sm${primary ? ' btn-primary' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {label ?? (id ? 'Edit' : 'Add')}
      </button>
      {open && <RecordDrawer kind={kind} id={id} companyId={companyId} onClose={() => setOpen(false)} />}
    </>
  );
}

function RecordDrawer({ kind, id, companyId: given, onClose }: { kind: RecordKind; id: string | null; companyId: string | null; onClose: () => void }) {
  const [companyId, setCompanyId] = useState(given);
  const [form, setForm] = useState<RecordFormData | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  useEffect(() => {
    setForm(null);
    api.recordForm(kind, id, companyId).then(setForm, setLoadError);
  }, [kind, id, companyId]);
  const adding = kind !== 'company' && (!id || (kind === 'amTenancy' && !!form && !form.values.tenant));
  const title = form ? `${adding ? 'Add' : 'Edit'} ${form.spec.label.toLowerCase()}` : adding ? 'Add' : 'Edit';
  return (
    <Drawer title={title} sub={form ? `Kept by: ${form.spec.keptBy}` : undefined} onClose={onClose}>
      {loadError && <ErrorNotice error={loadError.message} />}
      {!form && !loadError && <Loading what="the form" />}
      {form?.chooseCompany && (
        <label className="field">
          <span className="label">Which company is this for?</span>
          <select className="select" aria-label="Company" value="" onChange={(e) => e.target.value && setCompanyId(e.target.value)}>
            <option value="">Choose…</option>
            {form.chooseCompany.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      {form && !form.chooseCompany && <RecordFields form={form} kind={kind} id={id} onDone={onClose} />}
    </Drawer>
  );
}

function RecordFields({ form, kind, id, onDone }: { form: RecordFormData; kind: RecordKind; id: string | null; onDone: () => void }) {
  const act = useAction();
  const [values, setValues] = useState<RecordValues>(form.values);
  const creating = kind !== 'company' && (!id || (kind === 'amTenancy' && !form.values.tenant));
  const set = (k: string, v: RecordValues[string]) => setValues({ ...values, [k]: v });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {form.spec.note && <p className="muted small">{form.spec.note}</p>}
      {form.spec.fields
        .filter((f) => creating || !f.createOnly)
        .filter((f) => kind !== 'amTenancy' || f.key !== 'ended' || !creating)
        .map((f) => {
          const v = values[f.key];
          const label = (
            <span className="label">
              {f.label}
              {f.required ? '' : ' (optional)'}
            </span>
          );
          if (f.type === 'bool')
            return (
              <label key={f.key} className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={v === true} onChange={(e) => set(f.key, e.target.checked)} />
                <span>
                  {f.label}
                  {f.help && <span className="muted"> · {f.help}</span>}
                </span>
              </label>
            );
          const opts = f.type === 'ref' ? (form.options[f.key] ?? []) : (f.options ?? []);
          return (
            <label key={f.key} className="field">
              {label}
              {f.type === 'select' || f.type === 'ref' ? (
                <select className="select" aria-label={f.label} value={v == null ? '' : String(v)} onChange={(e) => set(f.key, e.target.value || null)}>
                  {(!f.required || v == null) && <option value="">{f.required ? 'Choose…' : 'None'}</option>}
                  {opts.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea className="input" rows={3} aria-label={f.label} value={v == null ? '' : String(v)} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <input
                  className="input"
                  aria-label={f.label}
                  type={f.type === 'date' ? 'date' : 'text'}
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  value={v == null ? '' : String(v)}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              {f.help && <span className="muted small">{f.help}</span>}
            </label>
          );
        })}
      <ErrorNotice error={act.error} />
      <div>
        <button
          className="btn btn-primary"
          disabled={act.busy}
          onClick={() =>
            act
              .run(() => api.saveRecord(kind, id, form.companyId, values), (id || kind === 'company') && !creating ? 'Saved.' : `${form.spec.label} added.`)
              .then((x) => {
                if (x) onDone();
              })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}
