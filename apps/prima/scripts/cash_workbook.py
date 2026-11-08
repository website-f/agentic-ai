#!/usr/bin/env python3
"""Local-only controlled Excel preparation. No network, credentials or automatic submission.
Protection/hashes prevent mistakes, not malicious alteration or authorization bypass.
"""
import argparse
import base64
import hashlib
import json
import os
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill, Protection
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.defined_name import DefinedName

VERSION = 1
MAX_ROWS = 200
HEADERS = ['Guard ID', 'Site ID', 'Occasion (YYYY-MM-DD)', 'Approved amount (RM)',
           'Individual reason', 'Requesting OM account ID', 'Requested at (timezone)',
           'Manual request file', 'Approval line ID', 'CEO account ID',
           'Approved at (timezone)', 'Manual approval file', 'Supersedes row ID',
           'Staff number (lookup)', 'Guard name (lookup)', 'Site name (lookup)']
MASTER_HEADERS = ['Guard ID', 'Staff number', 'Guard name', 'Company ID', 'Site ID', 'Site name', 'Roster date']
FORMATS = {'.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}


def fail(message):
    raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def text(value, label, optional=False):
    if optional and value in (None, ''):
        return ''
    if not isinstance(value, str) or not value.strip() or len(value) > 300:
        fail(label + ': required text, maximum 300 characters')
    return value.strip()


def day(value):
    s = text(value, 'Occasion / roster date')
    if date.fromisoformat(s).isoformat() != s:
        fail('Use a real YYYY-MM-DD date')
    return s


def stamp(value):
    s = text(value, 'Timestamp')
    dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
    if dt.tzinfo is None or dt > datetime.now(timezone.utc):
        fail('Timestamp must include timezone and cannot be future')
    return dt


def money(value):
    if isinstance(value, bool):
        fail('Amount must be positive exact cents')
    try:
        n = Decimal(str(value))
        if not n.is_finite() or n <= 0 or n * 100 != (n * 100).to_integral_value() or n * 100 > 9007199254740991:
            fail('Amount must be positive exact cents')
        return float(n)
    except InvalidOperation:
        fail('Amount must be positive exact cents')


def read_json(path):
    p = Path(path)
    if p.stat().st_size > 25_000_000:
        fail('JSON file too large')
    return json.loads(p.read_text())


def snapshot(path):
    raw = read_json(path)
    if raw.get('version') != VERSION or raw.get('kind') != 'exceptional-cash-workbook-master':
        fail('Use the scoped workbook JSON export from Director Office')
    company = text(raw.get('companyId'), 'Company')
    stamp(raw.get('refreshedAt'))
    master, ids = [], set()
    for person in raw.get('master', []):
        pid = text(person.get('personId'), 'Guard ID')
        if pid in ids or person.get('companyId') != company:
            fail('Duplicate guard or cross-company master')
        ids.add(pid)
        assignments = []
        for a in person.get('assignments', []):
            assignments.append({'siteId': text(a.get('siteId'), 'Site ID'), 'siteName': text(a.get('siteName'), 'Site name'), 'date': day(a.get('date'))})
        master.append({'personId': pid, 'staffNo': text(person.get('staffNo'), 'Staff number'), 'name': text(person.get('name'), 'Guard name'), 'companyId': company, 'assignments': assignments})
    submitted = []
    for r in raw.get('submitted', []):
        submitted.append({k: text(r.get(k), k) for k in ('id', 'personId', 'occasion', 'approvalId', 'batchId', 'status')})
    # Drop unexpected personal/financial fields rather than propagating them into Excel.
    return {'version': VERSION, 'kind': raw['kind'], 'companyId': company, 'refreshedAt': raw['refreshedAt'], 'master': master, 'submitted': submitted}


def safe_cell(cell, value):
    cell.value = value
    if isinstance(value, str):
        cell.data_type = 's'  # Never treat source names/IDs/reasons as Excel formulas.


def style_sheet(ws, headers):
    ws.append(headers)
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f'A1:{ws.cell(1, len(headers)).column_letter}201'
    ws.sheet_view.showGridLines = False
    ws.row_dimensions[1].height = 42
    for c in ws[1]:
        c.fill = PatternFill('solid', fgColor='17365D')
        c.font = Font(color='FFFFFF', bold=True)
        c.alignment = Alignment(wrap_text=True, vertical='center')
        ws.column_dimensions[c.column_letter].width = 25
    ws.protection.sheet = True
    ws.protection.set_password('accidental-edits-only')
    ws.protection.autoFilter = False
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_title_rows = '1:1'


def build(source, entries=None, batch='', reference=''):
    wb = Workbook()
    info = wb.active
    info.title = 'Read me'
    style_sheet(info, ['Controlled exceptional payroll support', 'Instructions'])
    instructions = [
        ('1. Access', 'DOA only: export the selected company workbook JSON using your own authorized Prima session. Keep all files in an access-controlled local folder.'),
        ('2. Refresh', 'Run refresh with a new authorized export; no unattended connection or credentials are stored. Refresh creates a NEW workbook and preserves approved-list entries for revalidation.'),
        ('3. Entry', 'Enter ONLY manually requested and CEO-approved names/amounts. Guard/site IDs come from the master. Blue cells are input; date/timestamps are text. No formula cells in input.'),
        ('4. Evidence', 'Store request/approval PDF/PNG/JPEG files below one local evidence directory. Enter relative filenames. Never use stored guard signatures as payment acknowledgements.'),
        ('5. Scope check', 'DOA checks the source documents against company, guard, site, amount and occasion. Run seal with --evidence-checked to create the separately retained approval-scope manifest.'),
        ('6. Convert', 'Run convert with the workbook, latest scoped snapshot and ORIGINAL approval-scope file. Changed/missing scope, evidence bytes or duplicates are rejected. Retain originals; do not overwrite manifests.'),
        ('7. Handover', 'Review generated Finance handover.xlsx and upload handover.json in Prima as DOA; confirm the evidence check again. This is submission only, never proof of payment.'),
        ('8. Finance', 'Finance records custody/payment; DOA collects a fresh transaction-specific signed receipt; independent Finance reconciles and records external supplemental payroll/statutory evidence.'),
        ('Accounting', 'Additional payroll support; ordinary wages remain fully payable. Miscellaneous payroll expenses budget. Exact site expense is recorded once only after the required evidence.'),
        ('Security boundary', 'Sheet protection, hashes and scope manifests are NOT authentication, encryption, digital approval or tamper-proof security. Prima rechecks roles, identity, roster and duplicate submissions.'),
        ('No overwrite', 'Never edit prepared/paid/posted transactions. Full unpaid return has independent Finance counting; other corrections/reversals are gated pending an agreed authorization policy.'),
    ]
    for row in instructions:
        info.append(row)
    info.column_dimensions['A'].width = 30
    info.column_dimensions['B'].width = 115
    for row in info.iter_rows(min_row=2):
        row[1].alignment = Alignment(wrap_text=True, vertical='top')
        info.row_dimensions[row[0].row].height = 48
    config = wb.create_sheet('Control')
    style_sheet(config, ['Field', 'Value'])
    for k, v in [('Format version', VERSION), ('Company ID', source['companyId']), ('Master refreshed at', source['refreshedAt']), ('Source SHA256', digest(source)), ('Batch ID', batch), ('Workbook reference', reference)]:
        config.append([k, v])
    config.column_dimensions['B'].width = 75
    for coord in ('B6', 'B7'):
        config[coord].protection = Protection(locked=False)
        config[coord].fill = PatternFill('solid', fgColor='DDEBF7')
    master = wb.create_sheet('Guard master')
    style_sheet(master, MASTER_HEADERS)
    for p in source['master']:
        for a in p['assignments'] or [{'siteId': None, 'siteName': None, 'date': None}]:
            vals = [p['personId'], p['staffNo'], p['name'], source['companyId'], a['siteId'], a['siteName'], a['date']]
            master.append(vals)
            for c, v in zip(master[master.max_row], vals):
                safe_cell(c, v)
    master.auto_filter.ref = f'A1:G{max(2, master.max_row)}'
    wb.defined_names.add(DefinedName('GuardIDs', attr_text=f"'Guard master'!$A$2:$A${max(2, master.max_row)}"))
    wb.defined_names.add(DefinedName('SiteIDs', attr_text=f"'Guard master'!$E$2:$E${max(2, master.max_row)}"))
    entry = wb.create_sheet('Approved list')
    style_sheet(entry, HEADERS)
    for r in range(2, MAX_ROWS + 2):
        for c in range(1, 14):
            cell = entry.cell(r, c)
            cell.protection = Protection(locked=False)
            cell.fill = PatternFill('solid', fgColor='DDEBF7')
            cell.number_format = '0.00' if c == 4 else '@'
        for col, index in [('N', 2), ('O', 3)]:
            entry[f'{col}{r}'] = f'=IF(A{r}="","",IFERROR(VLOOKUP(A{r},\'Guard master\'!$A$2:$G${max(2, master.max_row)},{index},FALSE),"NOT IN MASTER"))'
        entry[f'P{r}'] = f'=IF(B{r}="","",IFERROR(VLOOKUP(B{r},\'Guard master\'!$E$2:$F${max(2, master.max_row)},2,FALSE),"NOT IN MASTER"))'
    for formula, cell_range in [('GuardIDs', 'A2:A201'), ('SiteIDs', 'B2:B201')]:
        dv = DataValidation(type='list', formula1=formula, allow_blank=True)
        dv.errorTitle, dv.error = 'Use the master', 'Select a value from the authorized master.'
        dv.showErrorMessage = True
        entry.add_data_validation(dv)
        dv.add(cell_range)
    dv = DataValidation(type='decimal', operator='greaterThan', formula1=0, allow_blank=True)
    dv.showErrorMessage = True
    entry.add_data_validation(dv)
    dv.add('D2:D201')
    for r, values in enumerate(entries or [], 2):
        for c, value in enumerate(values, 1):
            safe_cell(entry.cell(r, c), value)
    hand = wb.create_sheet('Finance handover')
    style_sheet(hand, ['Guard ID', 'Staff number', 'Guard name', 'Site ID', 'Site name', 'Occasion', 'Approved RM', 'Approval line'])
    for r in range(2, MAX_ROWS + 2):
        for c, src in enumerate(['A', 'N', 'O', 'B', 'P', 'C', 'D', 'I'], 1):
            hand.cell(r, c, f'=IF(\'Approved list\'!A{r}="","",\'Approved list\'!{src}{r})')
    hand['J1'] = 'APPROVAL ONLY — NOT A PAYMENT RECEIPT'
    hand.column_dimensions['J'].width = 48
    wb.active = 0
    return wb


def save_new(wb, output):
    p = Path(output)
    if p.exists():
        fail('Refusing to overwrite existing file: ' + str(p))
    # Workbook has no macros, external links, embedded credentials or network queries.
    with p.open('xb') as f:
        os.chmod(p, 0o600)
        wb.save(f)


def write_new(path, value):
    p = Path(path)
    with p.open('x') as f:
        os.chmod(p, 0o600)
        json.dump(value, f, indent=2, ensure_ascii=False)
        f.write('\n')


def load_entries(path):
    wb = load_workbook(path, data_only=False, keep_links=False)
    if set(wb.sheetnames) != {'Read me', 'Control', 'Guard master', 'Approved list', 'Finance handover'}:
        fail('Use the controlled workbook sheets')
    ws = wb['Approved list']
    if [c.value for c in ws[1]] != HEADERS:
        fail('Approved list columns changed')
    if ws.max_row > MAX_ROWS + 1 and any(c.value is not None for row in ws.iter_rows(min_row=MAX_ROWS+2) for c in row):
        fail('Maximum 200 approved rows')
    entries = []
    for row in ws.iter_rows(min_row=2, max_row=MAX_ROWS+1, max_col=13):
        vals = [c.value for c in row]
        if all(v in (None, '') for v in vals):
            continue
        if any(c.data_type == 'f' for c in row):
            fail('Formula in approved input; enter literal approved values')
        entries.append(vals)
    return wb, entries


def read_evidence(folder, relative):
    rel = Path(text(relative, 'Evidence filename'))
    base = Path(folder).resolve()
    p = (base / rel).resolve()
    if rel.is_absolute() or '..' in rel.parts or base not in p.parents:
        fail('Evidence must stay inside the local evidence directory')
    mime = FORMATS.get(p.suffix.lower())
    if not mime or not p.is_file() or not 0 < p.stat().st_size <= 1_499_000:
        fail('Evidence must be a nonempty PDF/PNG/JPEG under 1.5 MB')
    content = p.read_bytes()
    if not (content.startswith(b'%PDF-') if mime == 'application/pdf' else content.startswith(b'\x89PNG\r\n\x1a\n') if mime == 'image/png' else content.startswith(b'\xff\xd8\xff')):
        fail('Evidence file signature does not match its extension')
    return {'name': p.name, 'data': 'data:' + mime + ';base64,' + base64.b64encode(content).decode()}


def validated(workbook, source, folder):
    wb, entries = load_entries(workbook)
    control = wb['Control']
    if control['B2'].value != VERSION or control['B3'].value != source['companyId'] or control['B4'].value != source['refreshedAt'] or control['B5'].value != digest(source):
        fail('Workbook master is stale or belongs to another company; refresh using the latest authorized export')
    expected = [[p['personId'], p['staffNo'], p['name'], p['companyId'], a['siteId'], a['siteName'], a['date']] for p in source['master'] for a in (p['assignments'] or [{'siteId': None, 'siteName': None, 'date': None}])]
    actual = [[c.value for c in row] for row in wb['Guard master'].iter_rows(min_row=2, max_col=7)]
    if actual != (expected or [[None]*7]):
        fail('Read-only guard master was edited; refresh from authorized source')
    if any(control[c].data_type == 'f' for c in ('B6', 'B7')):
        fail('Control fields must be literal text, not formulas')
    batch = text(control['B6'].value, 'Batch ID')
    ref = text(control['B7'].value, 'Workbook reference')
    if any(r['batchId'] == batch for r in source['submitted']):
        fail('Batch already submitted')
    if not entries:
        fail('Approved list is empty')
    guards = {p['personId']: p for p in source['master']}
    rows, keys, approvals, superseded = [], set(), set(), set()
    for vals in entries:
        pid, sid, occasion, amt, reason, om, req_at, req_file, aid, ceo, app_at, app_file, supersedes = vals
        pid, sid, occasion, aid = text(pid, 'Guard ID'), text(sid, 'Site ID'), day(occasion), text(aid, 'Approval line')
        person = guards.get(pid)
        if not person:
            fail('Recipient is not in the authorized active guard master')
        before = max([a['date'] for a in person['assignments'] if a['date'] <= occasion], default=None)
        after = min([a['date'] for a in person['assignments'] if a['date'] >= occasion], default=None)
        if not any(a['siteId'] == sid and a['date'] in (before, after) for a in person['assignments']):
            fail('Guard/site is not the current or next published assignment')
        if (pid, occasion) in keys or aid in approvals:
            fail('Duplicate guard/occasion or approval row')
        keys.add((pid, occasion)); approvals.add(aid)
        supersedes = text(supersedes, 'Supersedes', optional=True)
        if supersedes:
            prev = next((r for r in source['submitted'] if r['id'] == supersedes), None)
            if not prev or prev['status'] != 'submitted' or supersedes in superseded:
                fail('Only one unprepared original row may be superseded')
            superseded.add(supersedes)
        for r in source['submitted']:
            if r['approvalId'] == aid or (r['id'] != supersedes and r['status'] != 'superseded' and (r['personId'], r['occasion']) == (pid, occasion)):
                fail('Approval or guard/occasion already submitted')
        requested, approved = stamp(req_at), stamp(app_at)
        from datetime import timedelta
        if approved < requested or approved.astimezone(timezone(timedelta(hours=8))).date().isoformat() > occasion:
            fail('Manual approval must follow request and precede occasion')
        row = {'personId': pid, 'siteId': sid, 'occasion': occasion, 'amount': money(amt), 'reason': text(reason, 'Individual reason'),
               'request': {'byId': text(om, 'OM account'), 'at': req_at, 'evidence': read_evidence(folder, req_file)},
               'approval': {'id': aid, 'byId': text(ceo, 'CEO account'), 'at': app_at, 'evidence': read_evidence(folder, app_file)}}
        if supersedes:
            row['supersedes'] = supersedes
        rows.append(row)
    return {'version': VERSION, 'batchId': batch, 'workbookRef': ref, 'evidenceChecked': True, 'rows': rows}


def scope_of(payload, company):
    # Bind the approved business scope and exact evidence bytes independently of Excel formulas/caches.
    return {'companyId': company, 'rows': payload['rows']}


def refresh(args):
    source = snapshot(args.source)
    entries, batch, ref = [], '', ''
    if args.workbook:
        old, entries = load_entries(args.workbook)
        if old['Control']['B3'].value != source['companyId']:
            fail('Cannot refresh across companies')
        batch, ref = old['Control']['B6'].value, old['Control']['B7'].value
    save_new(build(source, entries, batch, ref), args.output)


def seal(args):
    if not args.evidence_checked:
        fail('DOA must check actual manual request/approval evidence before sealing')
    source = snapshot(args.source)
    payload = validated(args.workbook, source, args.evidence_dir)
    scope = scope_of(payload, source['companyId'])
    # Keep only hashes of files in the local manifest, not additional embedded evidence copies.
    for row in scope['rows']:
        for kind in ('request', 'approval'):
            row[kind]['evidence'] = {'sha256': digest(row[kind]['evidence'])}
    write_new(args.output, {'version': VERSION, 'kind': 'human-checked-manual-approval-scope', 'checkedBy': text(args.checked_by, 'DOA account reference'), 'checkedAt': datetime.now(timezone.utc).isoformat(), 'scope': scope, 'sha256': digest(scope)})


def convert(args):
    source = snapshot(args.source)
    payload = validated(args.workbook, source, args.evidence_dir)
    scope = json.loads(json.dumps(scope_of(payload, source['companyId'])))
    for row in scope['rows']:
        for kind in ('request', 'approval'):
            row[kind]['evidence'] = {'sha256': digest(row[kind]['evidence'])}
    approved = read_json(args.approved_scope)
    if approved.get('kind') != 'human-checked-manual-approval-scope' or approved.get('version') != VERSION or approved.get('scope') != scope or approved.get('sha256') != digest(scope):
        fail('Missing/changed manual approval scope or evidence: obtain/check new approval; do not edit the original manifest')
    text(approved.get('checkedBy'), 'Scope checker'); stamp(approved.get('checkedAt'))
    if len(json.dumps(payload).encode()) > 9_900_000:
        fail('Handover exceeds app upload size; prepare separately identified approved batches')
    target = Path(args.output_dir)
    # Refuse overwriting/replaying a prior conversion package.
    target.mkdir(mode=0o700, parents=False, exist_ok=False)
    write_new(target/'handover.json', payload)
    book = Workbook(); ws = book.active; ws.title = 'Finance handover'
    style_sheet(ws, ['Company', 'Guard ID', 'Staff number', 'Guard name', 'Site ID', 'Site name', 'Occasion', 'Approved RM', 'Approval line', 'Manual approver', 'Approved at', 'Batch', 'Workbook'])
    guards = {p['personId']: p for p in source['master']}
    for row in payload['rows']:
        p = guards[row['personId']]; site = next(a['siteName'] for a in p['assignments'] if a['siteId'] == row['siteId'])
        vals = [source['companyId'], p['personId'], p['staffNo'], p['name'], row['siteId'], site, row['occasion'], row['amount'], row['approval']['id'], row['approval']['byId'], row['approval']['at'], payload['batchId'], payload['workbookRef']]
        ws.append(vals)
        for c, v in zip(ws[ws.max_row], vals): safe_cell(c, v)
        ws.cell(ws.max_row, 8).number_format = '0.00'
    ws['O1'] = 'APPROVAL ONLY — NOT PROOF OF PAYMENT'
    ws['O2'] = 'Total approved RM'; ws['P2'] = sum(r['amount'] for r in payload['rows']); ws['P2'].number_format = '0.00'
    ws.column_dimensions['O'].width = 45
    save_new(book, target/'finance-handover.xlsx')
    write_new(target/'conversion-record.json', {'version': VERSION, 'companyId': source['companyId'], 'sourceSha256': digest(source), 'workbookSha256': hashlib.sha256(Path(args.workbook).read_bytes()).hexdigest(), 'approvalScopeSha256': digest(approved), 'handoverSha256': hashlib.sha256((target/'handover.json').read_bytes()).hexdigest(), 'financeWorkbookSha256': hashlib.sha256((target/'finance-handover.xlsx').read_bytes()).hexdigest(), 'rowCount': len(payload['rows']), 'convertedAt': datetime.now(timezone.utc).isoformat(), 'note': 'Local human-checked preparation only. No API submission, payment, signature verification or statutory calculation.'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='command', required=True)
    p = subs.add_parser('refresh', help='Create/refresh a NEW protected workbook from authorized export')
    p.add_argument('--source', required=True); p.add_argument('--workbook'); p.add_argument('--output', required=True); p.set_defaults(run=refresh)
    for command, fn in [('seal', seal), ('convert', convert)]:
        p = subs.add_parser(command)
        for key in ['source', 'workbook', 'evidence-dir']: p.add_argument('--'+key, required=True)
        if command == 'seal':
            p.add_argument('--evidence-checked', action='store_true'); p.add_argument('--checked-by', required=True); p.add_argument('--output', required=True)
        else:
            p.add_argument('--approved-scope', required=True); p.add_argument('--output-dir', required=True)
        p.set_defaults(run=fn)
    args = parser.parse_args()
    try:
        args.run(args)
        print('Local ' + args.command + ' complete. No upload or payment performed.')
    except (ValueError, OSError, KeyError, TypeError) as e:
        parser.exit(2, 'Rejected: ' + str(e) + '\n')


if __name__ == '__main__':
    main()
