// P91 (Fitri, 9 Nov 2026: "I can see the camera to scan the items, but where do I add the items? Add manually, or by
// Excel/PDF?"): the Items screen's Add and Import, at the top of the screen and of the Item types and Stock tabs. Add
// opens the screen's own forms (New item type; Register items, with their labels printed and scanned back); Import loads
// the old system's lists from Excel, CSV, Word or PDF through the same server actions. Both show only to the people the
// server lets add; it checks every row again. On a phone a menu opens as a sheet from the bottom.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CaretDownIcon, PlusIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import type { ImportKind } from '@prima/core';
import type { ItemBoard } from '../../api';
import { ImportDrawer } from '../ImportDrawer';
import { any, rolesOf } from './shared';

export type ItemAddIntent = 'type' | 'register';

/** May add item types: store staff or managers anywhere, or IT for IT devices (the server's sku.add check). */
export const mayAddTypes = (data: ItemBoard) => any(data, 'store', 'manager') || (rolesOf(data).get('merdeka') ?? []).some((r) => r === 'it' || r === 'manager');
/** May register units or add stock: store staff, managers or IT of some company (item.register, lot.add). */
export const mayRegister = (data: ItemBoard) => any(data, 'store', 'manager', 'it');

/** The companies this person may add items for, as [id, name], for the import's company choice. */
export function addParties(data: ItemBoard): [string, string][] {
  const roles = rolesOf(data);
  return data.parties.filter((p) => (roles.get(p.id) ?? []).some((r) => r === 'store' || r === 'manager' || r === 'it')).map((p): [string, string] => [p.id, p.name]);
}

interface Choice {
  key: string;
  title: string;
  sub: string;
  run: () => void;
}

/** A button that opens a short list of choices: under the button on a wide screen, a sheet from the bottom on a phone. */
export function ItemMenu({ label, icon, primary, choices }: { label: string; icon: ReactNode; primary?: boolean; choices: Choice[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  if (!choices.length) return null;
  return (
    <div className="it-menu" ref={box}>
      <button className={primary ? 'btn btn-primary' : 'btn'} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {icon} {label} <CaretDownIcon size={14} weight="bold" aria-hidden="true" />
      </button>
      {open && (
        <>
          <div className="it-menu-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
          <div className="it-menu-list" role="menu" id={id} aria-label={label}>
            <div className="it-menu-title">{label}</div>
            {choices.map((c) => (
              <button
                key={c.key}
                type="button"
                role="menuitem"
                className="it-menu-item"
                onClick={() => {
                  setOpen(false);
                  c.run();
                }}
              >
                <strong>{c.title}</strong>
                <span className="muted small">{c.sub}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const IMPORT_CHOICE: Record<'itemType' | 'itemUnit' | 'itemStock', [string, string]> = {
  itemType: ['Item types', 'The old list of item kinds: name, category, size, unit, each unit or by quantity.'],
  itemUnit: ['Units with labels', 'The old asset list: item type, serial number, old tag, where it is. Each gets a new Prima label to print.'],
  itemStock: ['Stock by quantity', 'Opening balances of cleaning stock and small parts, per item type and company.'],
};

/** Import from file: one kind, a plain button; several, a menu. Opens the import drawer for the chosen kind. */
export function ItemImport({ data, kinds, label = 'Import from file' }: { data: ItemBoard; kinds: ('itemType' | 'itemUnit' | 'itemStock')[]; label?: string }) {
  const [kind, setKind] = useState<ImportKind | null>(null);
  const shown = kinds.filter((k) => (k === 'itemType' ? mayAddTypes(data) : mayRegister(data)));
  if (!shown.length) return null;
  const icon = <UploadSimpleIcon size={16} weight="bold" aria-hidden="true" />;
  return (
    <>
      {shown.length === 1 ? (
        <button className="btn" type="button" onClick={() => setKind(shown[0])} title="Load existing records from Excel, CSV, Word or PDF">
          {icon} {label}
        </button>
      ) : (
        <ItemMenu label={label} icon={icon} choices={shown.map((k) => ({ key: k, title: IMPORT_CHOICE[k][0], sub: IMPORT_CHOICE[k][1], run: () => setKind(k) }))} />
      )}
      {kind && <ImportDrawer kind={kind} companyId={null} choices={kind === 'itemType' ? undefined : addParties(data)} onClose={() => setKind(null)} />}
    </>
  );
}

/** The top of the Items screen: Add (new item type, register items) and Import from file. */
export function ItemsAddBar({ data, onAdd }: { data: ItemBoard; onAdd: (what: ItemAddIntent) => void }) {
  const choices: Choice[] = [];
  if (mayRegister(data)) choices.push({ key: 'register', title: 'Register items', sub: 'Units that each get their own label (radios, torchlights, uniforms), or stock by quantity. Labels are printed and scanned back.', run: () => onAdd('register') });
  if (mayAddTypes(data)) choices.push({ key: 'type', title: 'New item type', sub: 'A kind of item in the catalogue: name, category, size, unit, and whether each unit has its own label.', run: () => onAdd('type') });
  if (!choices.length) return null;
  return (
    <div className="it-addbar">
      <ItemMenu primary label="Add" icon={<PlusIcon size={16} weight="bold" aria-hidden="true" />} choices={choices} />
      <ItemImport data={data} kinds={['itemType', 'itemUnit', 'itemStock']} />
    </div>
  );
}
