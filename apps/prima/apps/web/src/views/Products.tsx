import { useState } from 'react';
import type { CertBody, ProofInput } from '@prima/core';
import { api, type ProductBoard, type ProductCertInput, type ProductInput, type ProposalCheck } from '../api';
import { Chip, ErrorNotice, Loading, dateLabel, useAction, useLoad, type Tone } from '../ui';
import { ProofPicker } from './Proof';
import { PlusIcon } from '@phosphor-icons/react';
import { ImportButton } from './ImportDrawer';

/**
 * Products sold or rented to clients (Fauzan, 26 Oct 2026). The PDPA officer keeps each product's personal data
 * details and its certificates (MySTI, SIRIM, MCMC or others) with how to renew or obtain them; the Operations
 * Director checks a proposal is ready before it is sent to the client.
 */

type Product = ProductBoard['products'][number];
type Cert = Product['certs'][number];

const CERT_TONE: Record<Cert['state'], [Tone, string]> = {
  valid: ['ok', 'Valid'],
  due: ['warn', 'Renew soon'],
  urgent: ['crit', 'Expiring'],
  expired: ['crit', 'Expired'],
  applying: ['warn', 'Applying'],
  not_started: ['crit', 'Not obtained'],
};
const MODE: Record<Product['mode'], string> = { SALE: 'Sold', RENTAL: 'Rented', BOTH: 'Sold or rented' };

export function ProductsPanel() {
  const { data, error } = useLoad(() => api.productBoard(), []);
  const [adding, setAdding] = useState(false);
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="products" />;
  // The PDPA officer keeps the list; the owner may too (P78).
  const officer = data.canKeep;
  return (
    <>
      {data.certsDue.length > 0 && (
        <div className="notice" data-tone="warn" role="status" style={{ marginBottom: 12 }}>
          Certificates to renew: {data.certsDue.map((d) => `${d.product} (${d.cert.body}, ${dateLabel(d.cert.expiresOn)})`).join('; ')}.
        </div>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>Products sold or rented to clients</h3>
          {officer && !adding && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
                <PlusIcon size={14} weight="bold" aria-hidden="true" />
                Add product
              </button>
              <ImportButton kind="pdpaProduct" />
            </div>
          )}
        </div>
        {adding && <ProductForm onDone={() => setAdding(false)} />}
        <div className="list">
          {data.products.length === 0 && (
            <div className="empty">No products yet.{officer ? ' Use Add product to record what is sold or rented to clients.' : ' The PDPA officer records them.'}</div>
          )}
          {data.products.map((p) => (
            <ProductLine key={p.id} p={p} officer={officer} />
          ))}
        </div>
      </section>
    </>
  );
}

function ProductLine({ p, officer }: { p: Product; officer: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cert, setCert] = useState<Cert | 'new' | null>(null);
  return (
    <div className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{p.name}</div>
          <div className="muted small">
            {p.category} · {MODE[p.mode]} · {p.personalData.length ? `collects ${p.personalData.join(', ')}` : 'no personal data'}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {p.readiness.ready ? <Chip tone="ok">Ready for proposals</Chip> : <Chip tone="crit">Not ready</Chip>}
          <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Details'}
          </button>
        </div>
      </div>
      {open && (
        <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            Supplier {p.supplier || 'not set'} · data kept {p.retentionDays ? `${p.retentionDays} days` : 'not set'} ·{' '}
            {p.clientConsent ? 'client consent needed before use' : 'no client consent needed'}
          </div>
          {p.notes && <div>{p.notes}</div>}
          {p.readiness.blockers.length > 0 && <div style={{ color: 'var(--crit)' }}>Blocks proposals: {p.readiness.blockers.join(' ')}</div>}
          <div style={{ fontWeight: 600 }}>Certificates</div>
          {p.certs.length === 0 && <div className="muted">None recorded.</div>}
          {p.certs.map((c) => (
            <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <Chip tone={CERT_TONE[c.state][0]}>{CERT_TONE[c.state][1]}</Chip>
                <span>
                  {c.body === 'OTHER' ? c.scheme : `${c.body}${c.scheme ? `, ${c.scheme}` : ''}`}
                  {c.ref ? ` · ${c.ref}` : ''}
                  {c.expiresOn ? ` · expires ${dateLabel(c.expiresOn)}` : ''}
                </span>
                {officer && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setCert(c)}>
                    Update
                  </button>
                )}
              </div>
              {c.procedure && <div className="muted">How to renew or obtain: {c.procedure}</div>}
            </div>
          ))}
          {officer && (
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={() => setCert('new')}>
                Add certificate
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(!editing)}>
                {editing ? 'Cancel edit' : 'Edit product'}
              </button>
            </div>
          )}
          {cert && <CertForm productId={p.id} cert={cert === 'new' ? null : cert} onDone={() => setCert(null)} />}
          {editing && <ProductForm product={p} onDone={() => setEditing(false)} />}
        </div>
      )}
    </div>
  );
}

function ProductForm({ product, onDone }: { product?: Product; onDone: () => void }) {
  const [f, setF] = useState<ProductInput>({
    id: product?.id ?? null,
    name: product?.name ?? '',
    category: product?.category ?? '',
    mode: product?.mode ?? 'RENTAL',
    supplier: product?.supplier ?? '',
    personalData: product?.personalData ?? [],
    retentionDays: product?.retentionDays ?? null,
    clientConsent: product?.clientConsent ?? false,
    notes: product?.notes ?? '',
  });
  const [data, setData] = useState((product?.personalData ?? []).join(', '));
  const act = useAction();
  const set = (p: Partial<ProductInput>) => setF({ ...f, ...p });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
      <input className="input" aria-label="Name" placeholder="Product name" value={f.name} onChange={(e) => set({ name: e.target.value })} />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input
          className="input"
          aria-label="Category"
          placeholder="Category, e.g. CCTV"
          value={f.category}
          onChange={(e) => set({ category: e.target.value })}
        />
        <select className="select" aria-label="Sold or rented" value={f.mode} onChange={(e) => set({ mode: e.target.value as ProductInput['mode'] })}>
          <option value="SALE">Sold</option>
          <option value="RENTAL">Rented</option>
          <option value="BOTH">Sold or rented</option>
        </select>
        <input className="input" aria-label="Supplier" placeholder="Supplier" value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} />
      </div>
      <input
        className="input"
        aria-label="Personal data collected"
        placeholder="Personal data collected, comma separated (empty if none)"
        value={data}
        onChange={(e) => setData(e.target.value)}
      />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input"
          type="number"
          min={0}
          aria-label="Days kept"
          placeholder="Days the data is kept"
          value={f.retentionDays ?? ''}
          onChange={(e) => set({ retentionDays: Number(e.target.value) || null })}
        />
        <label className="small">
          <input type="checkbox" checked={f.clientConsent} onChange={(e) => set({ clientConsent: e.target.checked })} /> Client must agree before use
        </label>
      </div>
      <textarea className="textarea" aria-label="Notes" placeholder="Notes" value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy || f.name.trim().length < 2}
          onClick={() =>
            act
              .run(
                () =>
                  api.saveProduct({
                    ...f,
                    personalData: data
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  }),
                'Saved.',
              )
              .then((r) => r && onDone())
          }
        >
          Save
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function CertForm({ productId, cert, onDone }: { productId: string; cert: Cert | null; onDone: () => void }) {
  const [f, setF] = useState<ProductCertInput>({
    certId: cert?.id ?? null,
    body: cert?.body ?? 'MCMC',
    scheme: cert?.scheme ?? '',
    ref: cert?.ref ?? '',
    status: cert?.status ?? 'not_started',
    expiresOn: cert?.expiresOn ?? null,
    procedure: cert?.procedure ?? '',
  });
  const [proof, setProof] = useState<ProofInput[]>([]);
  const act = useAction();
  const set = (p: Partial<ProductCertInput>) => setF({ ...f, ...p });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="select" aria-label="Body" value={f.body} onChange={(e) => set({ body: e.target.value as CertBody })}>
          <option value="MySTI">MySTI</option>
          <option value="SIRIM">SIRIM</option>
          <option value="MCMC">MCMC</option>
          <option value="OTHER">Other body</option>
        </select>
        <input
          className="input"
          aria-label="Scheme"
          placeholder={f.body === 'OTHER' ? 'Body and scheme' : 'Scheme (optional)'}
          value={f.scheme}
          onChange={(e) => set({ scheme: e.target.value })}
        />
        <input className="input" aria-label="Reference" placeholder="Certificate no." value={f.ref} onChange={(e) => set({ ref: e.target.value })} />
        <select className="select" aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value as ProductCertInput['status'] })}>
          <option value="valid">Valid</option>
          <option value="applying">Applying</option>
          <option value="not_started">Not obtained</option>
        </select>
        <label className="small">
          Expires <input className="input" type="date" value={f.expiresOn ?? ''} onChange={(e) => set({ expiresOn: e.target.value || null })} />
        </label>
      </div>
      <textarea
        className="textarea"
        aria-label="Procedure"
        placeholder="How to renew or obtain it: steps, documents, who to contact"
        value={f.procedure}
        onChange={(e) => set({ procedure: e.target.value })}
      />
      <ProofPicker site={null} refText="Certificate" items={proof} onChange={setProof} documentsOnly required={f.status === 'valid'} />
      <ErrorNotice error={act.error} />
      <div className="row" style={{ gap: 6 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={act.busy}
          onClick={() => act.run(() => api.saveProductCert(productId, f, proof), 'Certificate saved.').then((r) => r && onDone())}
        >
          Save certificate
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The Operations Director ticks the products in a proposal and sees whether it can go to the client. */
export function ProposalPanel() {
  const { data, error } = useLoad(() => api.productBoard(), []);
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<ProposalCheck | null>(null);
  const act = useAction();
  if (error) return <ErrorNotice error={error} />;
  if (!data) return <Loading what="products" />;
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Proposal check</h3>
          <div className="muted small">
            Tick the products in the proposal. It is ready when every product has its personal data details and valid certificates.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
        {data.products.map((p) => (
          <label key={p.id} className="small">
            <input
              type="checkbox"
              checked={picked.includes(p.id)}
              onChange={(e) => {
                setResult(null);
                setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id));
              }}
            />{' '}
            {p.name}
          </label>
        ))}
        <div>
          <button
            className="btn btn-primary btn-sm"
            disabled={act.busy || !picked.length}
            onClick={() => act.run(() => api.proposalReadiness(picked)).then((r) => r && setResult(r))}
          >
            Check proposal
          </button>
        </div>
        <ErrorNotice error={act.error} />
      </div>
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="notice" data-tone={result.ready ? 'ok' : 'crit'} role="status">
            {result.ready ? 'Ready to send, with the client actions below.' : 'Not ready: fix the items below before sending.'}
          </div>
          {result.products.map((p) => (
            <div key={p.id} className="small">
              <div style={{ fontWeight: 600 }}>
                {p.name}: {p.ready ? 'ready' : 'not ready'}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {p.blockers.map((b, i) => (
                  <li key={`b${i}`} style={{ color: 'var(--crit)' }}>
                    {b}
                  </li>
                ))}
                {p.actions.map((a, i) => (
                  <li key={`a${i}`}>{a}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
