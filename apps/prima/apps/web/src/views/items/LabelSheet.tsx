// Printing labels (P85; paper section 2): A4 label sheets or a label printer roll, the QR code and, where the label is
// wide enough, the Code 128 barcode of the same payload, the typed ID, the item type and the size. Nothing else: no
// names, prices, owner or site. Printed through a print-only layer so the rest of the screen is not printed.
import { Select } from '../../SearchSelect';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LABEL_TEMPLATES, type LabelTemplateId } from '@prima/core';
import { PrinterIcon } from '@phosphor-icons/react';
import { TEMPLATES, barcodeSvg, layout, pageCss, perPage, qrSvg } from './labels';
import '../../styles/items.css';
import { inAppShell, printPage } from '../../native';

export interface PrintLabel {
  printId: string;
  payload: string;
  display: string;
  sku: string;
  size: string | null;
  gen: number;
}

function Cell({ l, barcode }: { l: PrintLabel; barcode: boolean }) {
  const qr = useMemo(() => qrSvg(l.payload), [l.payload]);
  const bar = useMemo(() => (barcode ? barcodeSvg(l.payload) : ''), [l.payload, barcode]);
  return (
    <div className="lbl-cell">
      <div className="lbl-qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label={`QR code ${l.display}`} />
      <div className="lbl-text">
        {barcode && <div className="lbl-bar" dangerouslySetInnerHTML={{ __html: bar }} aria-label={`Barcode ${l.display}`} />}
        <div className="lbl-id">{l.display}</div>
        <div className="lbl-sku">
          {l.sku}
          {l.size ? ` · ${l.size}` : ''}
          {l.gen > 1 ? ` · print ${l.gen}` : ''}
        </div>
      </div>
    </div>
  );
}

function Pages({ labels, template, startAt, symbols }: { labels: PrintLabel[]; template: LabelTemplateId; startAt: number; symbols: ('qr' | 'code128')[] }) {
  const t = TEMPLATES[template];
  const pages = layout(t, labels, startAt);
  const barcode = t.barcode && symbols.includes('code128');
  return (
    <>
      {pages.map((cells, p) => (
        <div
          key={p}
          className="lbl-page"
          style={{
            width: `${t.page.w}mm`,
            height: `${t.page.h}mm`,
            paddingTop: `${t.margin.top}mm`,
            paddingLeft: `${t.margin.left}mm`,
            gridTemplateColumns: `repeat(${t.cols}, ${t.cell.w}mm)`,
            gridAutoRows: `${t.cell.h}mm`,
            columnGap: `${t.gap.x}mm`,
            rowGap: `${t.gap.y}mm`,
          }}
        >
          {cells.map((l, k) => (l ? <Cell key={l.printId} l={l} barcode={barcode} /> : <div key={`e${k}`} className="lbl-cell lbl-empty" />))}
        </div>
      ))}
    </>
  );
}

/** Preview and print one run of labels. */
export function LabelSheet({ labels, template: initial, symbols, onPrinted, scanBack = true }: { labels: PrintLabel[]; template: LabelTemplateId; symbols: ('qr' | 'code128')[]; onPrinted?: () => void; scanBack?: boolean }) {
  const [template, setTemplate] = useState<LabelTemplateId>(initial);
  const [startAt, setStartAt] = useState(1);
  const [printing, setPrinting] = useState(false);
  const t = TEMPLATES[template];
  const print = () => {
    setPrinting(true);
    // Let the print layer render, print, then remove it.
    setTimeout(() => {
      // P96: inside the app (no printing there) the sheet is saved as a file to print from a computer.
      if (inAppShell()) void printPage('Labels');
      else window.print();
      setPrinting(false);
      onPrinted?.();
    }, 60);
  };
  return (
    <div className="lbl-sheet">
      <div className="lbl-controls">
        <label className="isc-field">
          Label sheet
          <Select className="input" value={template} onChange={(e) => setTemplate(e.target.value as LabelTemplateId)}>
            {LABEL_TEMPLATES.map((id) => (
              <option key={id} value={id}>
                {TEMPLATES[id].name}
              </option>
            ))}
          </Select>
        </label>
        {perPage(t) > 1 && (
          <label className="isc-field">
            Start at label
            <input className="input" type="number" min={1} max={perPage(t)} value={startAt} onChange={(e) => setStartAt(Math.max(1, Math.min(perPage(t), Number(e.target.value) || 1)))} />
          </label>
        )}
        <button className="btn btn-primary lbl-print" type="button" onClick={print}>
          <PrinterIcon size={20} aria-hidden="true" /> Print {labels.length} label{labels.length === 1 ? '' : 's'}
        </button>
      </div>
      <p className="muted small">
        {t.barcode && symbols.includes('code128') ? 'QR code and Code 128 barcode carry the same ID.' : 'QR code only on this size; the ID is printed under it.'} Print at 100% (no
        scaling).{scanBack ? ' After printing, scan each label back.' : ' Stick each on the shelf, bin or box of that item.'}
      </p>
      <div className="lbl-preview" aria-label="Preview">
        <Pages labels={labels.slice(0, perPage(t))} template={template} startAt={startAt} symbols={symbols} />
      </div>
      {printing &&
        createPortal(
          <>
            <style>{pageCss(t)}</style>
            <Pages labels={labels} template={template} startAt={startAt} symbols={symbols} />
          </>,
          document.getElementById('print-root') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'print-root' })),
        )}
    </div>
  );
}
