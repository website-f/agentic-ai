// P91 (Fitri, 9 Nov 2026: "we only see tables but don't see where to add them"): one Add and one Import at the top of
// a screen that keeps several kinds of record (the HR monitor). Each entry is only listed for the people who may add
// that record by hand; the server checks every saved or imported row again.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CaretDownIcon, PlusIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import type { ImportKind } from '@prima/core';
import { ImportDrawer } from './ImportDrawer';
import '../styles/p91-add.css';

export interface AddEntry {
  key: string;
  label: string;
  /** What Add does: open the screen's own form, or go to the screen that holds it. */
  onAdd?: () => void;
  /** The import kind, when this record loads from a file. */
  importKind?: ImportKind;
}

function Menu({ label, icon, primary, children }: { label: string; icon: ReactNode; primary?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="p91-menu" ref={box}>
      <button type="button" className={primary ? 'btn btn-primary' : 'btn'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon}
        {label}
        <CaretDownIcon size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="p91-menu-list" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** "Add …" and "Import from file …" for the kinds this person may add. Nothing shows when there are none. */
export function AddImportMenu({ entries, addLabel = 'Add', importLabel = 'Import from file' }: { entries: AddEntry[]; addLabel?: string; importLabel?: string }) {
  const [importing, setImporting] = useState<ImportKind | null>(null);
  const adds = entries.filter((e) => e.onAdd);
  const imports = entries.filter((e) => e.importKind);
  if (!adds.length && !imports.length) return null;
  return (
    <>
      {adds.length > 0 && (
        <Menu label={addLabel} icon={<PlusIcon size={16} weight="bold" aria-hidden="true" />} primary>
          {(close) =>
            adds.map((e) => (
              <button key={e.key} type="button" role="menuitem" className="p91-menu-item" onClick={() => (close(), e.onAdd!())}>
                {e.label}
              </button>
            ))
          }
        </Menu>
      )}
      {imports.length > 0 && (
        <Menu label={importLabel} icon={<UploadSimpleIcon size={16} weight="bold" aria-hidden="true" />}>
          {(close) =>
            imports.map((e) => (
              <button key={e.key} type="button" role="menuitem" className="p91-menu-item" onClick={() => (close(), setImporting(e.importKind!))}>
                {e.label}
              </button>
            ))
          }
        </Menu>
      )}
      {importing && <ImportDrawer kind={importing} companyId={null} onClose={() => setImporting(null)} />}
    </>
  );
}

/** Scrolls to a part of the page and puts the cursor in its first field (the app keeps its own address, so no # links). */
export function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const field = el.querySelector<HTMLElement>('input, select, textarea, button');
  window.setTimeout(() => field?.focus({ preventScroll: true }), 350);
}
