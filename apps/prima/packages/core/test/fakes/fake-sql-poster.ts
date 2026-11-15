import { SqlPostError } from '../../src';
import type { SqlAccountPoster, SqlDocType, SqlPayload, SqlPostedDoc } from '../../src';

/**
 * A FAKE SQL Account for tests only (Build 1, L2): keeps documents in memory and can be told to refuse, fail before
 * answering, time out after saving, or say "already there". Never calls SQL Account.
 */
export class FakeSqlPoster implements SqlAccountPoster {
  docs: SqlPostedDoc[] = [];
  calls = 0;
  /** What the next post does (then back to normal). */
  next: ('ok' | 'reject' | 'closed' | 'network' | 'timeout_saved' | 'timeout_lost')[] = [];
  private n = 0;
  constructor(private opts: { canFind?: boolean; canList?: boolean } = { canFind: true }) {
    if (!opts.canFind) this.findByRef = undefined;
    if (!opts.canList) this.list = undefined;
  }

  private save(book: string, docType: SqlDocType, p: SqlPayload, ourRef: string) {
    this.n += 1;
    const docNo = `${docType === 'GL_PV' ? 'PV' : 'OR'}-${String(this.n).padStart(6, '0')}`;
    const codes = [p.bankCode, p.docType === 'GL_PV' ? p.payeeCode : p.customerCode].filter((x): x is string => !!x);
    const doc: SqlPostedDoc = { docNo, docKey: `k${this.n}`, book, docType, date: p.date, amount: p.amount, codes, ourRef };
    this.docs.push(doc);
    return doc;
  }

  async post(book: string, docType: SqlDocType, payload: SqlPayload, ourRef: string) {
    this.calls += 1;
    if (this.docs.some((d) => d.book === book && d.ourRef === ourRef)) throw new SqlPostError('duplicate', 'Reference already used');
    const what = this.next.shift() ?? 'ok';
    if (what === 'reject') throw new SqlPostError('rejected', 'Account code 9999-000 does not exist');
    if (what === 'closed') throw new SqlPostError('closed_period', 'Transaction date is outside Maintain Acceptable Trans Date');
    if (what === 'network') throw new SqlPostError('network', 'Connection refused');
    if (what === 'timeout_saved') {
      this.save(book, docType, payload, ourRef);
      throw new Error('socket hang up');
    }
    if (what === 'timeout_lost') throw new Error('socket hang up');
    const d = this.save(book, docType, payload, ourRef);
    return { docNo: d.docNo, docKey: d.docKey };
  }

  async fetch(book: string, _docType: SqlDocType, docNo: string) {
    return this.docs.find((d) => d.book === book && d.docNo === docNo) ?? null;
  }

  findByRef?: (book: string, docType: SqlDocType, ourRef: string) => Promise<SqlPostedDoc | null> = async (book, _t, ourRef) =>
    this.docs.find((d) => d.book === book && d.ourRef === ourRef) ?? null;

  list?: (book: string, docType: SqlDocType, from: string, to: string) => Promise<SqlPostedDoc[]> = async (book, docType, from, to) =>
    this.docs.filter((d) => d.book === book && d.docType === docType && d.date >= from && d.date <= to);
}
