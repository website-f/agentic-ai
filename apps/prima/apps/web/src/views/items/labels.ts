// Printed labels (P85; paper section 2). The QR code and the Code 128 barcode carry the same payload: P1 + the 16-character
// ID (and, from the second print, a generation character). No names, prices, owner or site. The typed ID, the item
// type and the size are printed under the codes.
import qrcode from 'qrcode-generator';
import type { LabelTemplateId } from '@prima/core';
import { code128Svg } from '../code128';

/**
 * QR in alphanumeric mode (the payload is upper case letters and digits) with error correction Q, so a label that is
 * a quarter damaged still reads, and a quiet zone of 4 modules all round, as the QR standard asks.
 */
export function qrSvg(payload: string): string {
  if (!/^[0-9A-Z $%*+\-./:]+$/.test(payload)) throw new Error('A label payload is upper-case letters and digits only.');
  const q = qrcode(0, 'Q');
  q.addData(payload, 'Alphanumeric');
  q.make();
  const cell = 4;
  return q.createSvgTag({ cellSize: cell, margin: 4 * cell, scalable: true });
}

/** The number of modules across the QR code, without the quiet zone (version 2 = 25). */
export function qrModules(payload: string): number {
  const q = qrcode(0, 'Q');
  q.addData(payload, 'Alphanumeric');
  q.make();
  return q.getModuleCount();
}

export const barcodeSvg = (payload: string) => code128Svg(payload, 40, 2);

/** A label sheet or roll: millimetres, as printed. A4 sheets follow the common Avery layouts. */
export interface LabelTemplate {
  id: LabelTemplateId;
  name: string;
  page: { w: number; h: number };
  cols: number;
  rows: number;
  cell: { w: number; h: number };
  margin: { top: number; left: number };
  gap: { x: number; y: number };
  /** Wide enough for the Code 128 barcode beside the QR code. */
  barcode: boolean;
}

export const TEMPLATES: Record<LabelTemplateId, LabelTemplate> = {
  a4_l7160_21: { id: 'a4_l7160_21', name: 'A4 sheet, 21 labels (63.5 x 38.1 mm, L7160)', page: { w: 210, h: 297 }, cols: 3, rows: 7, cell: { w: 63.5, h: 38.1 }, margin: { top: 15.15, left: 7.2 }, gap: { x: 2.5, y: 0 }, barcode: true },
  a4_l7651_65: { id: 'a4_l7651_65', name: 'A4 sheet, 65 small labels (38.1 x 21.2 mm, L7651)', page: { w: 210, h: 297 }, cols: 5, rows: 13, cell: { w: 38.1, h: 21.2 }, margin: { top: 10.7, left: 4.65 }, gap: { x: 2.5, y: 0 }, barcode: false },
  a4_l7163_14: { id: 'a4_l7163_14', name: 'A4 sheet, 14 labels (99.1 x 38.1 mm, L7163)', page: { w: 210, h: 297 }, cols: 2, rows: 7, cell: { w: 99.1, h: 38.1 }, margin: { top: 15.15, left: 4.65 }, gap: { x: 2.5, y: 0 }, barcode: true },
  thermal_50x25: { id: 'thermal_50x25', name: 'Label printer roll, 50 x 25 mm', page: { w: 50, h: 25 }, cols: 1, rows: 1, cell: { w: 50, h: 25 }, margin: { top: 0, left: 0 }, gap: { x: 0, y: 0 }, barcode: false },
  thermal_60x30: { id: 'thermal_60x30', name: 'Label printer roll, 60 x 30 mm', page: { w: 60, h: 30 }, cols: 1, rows: 1, cell: { w: 60, h: 30 }, margin: { top: 0, left: 0 }, gap: { x: 0, y: 0 }, barcode: true },
};

/** Cells per page. */
export const perPage = (t: LabelTemplate) => t.cols * t.rows;

/** Pages of cells, leaving the first `startAt - 1` cells of the first sheet empty (a part-used sheet). */
export function layout<T>(t: LabelTemplate, labels: T[], startAt = 1): (T | null)[][] {
  const per = perPage(t);
  const skip = Math.max(0, Math.min(per - 1, Math.floor(startAt) - 1));
  const cells: (T | null)[] = [...Array<null>(skip).fill(null), ...labels];
  const pages: (T | null)[][] = [];
  for (let k = 0; k < cells.length; k += per) pages.push(cells.slice(k, k + per));
  return pages;
}

/** The @page rule for printing one template. */
export const pageCss = (t: LabelTemplate) => `@page { size: ${t.page.w}mm ${t.page.h}mm; margin: 0; }`;
