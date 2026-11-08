import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS

spec = importlib.util.spec_from_file_location('cash_workbook', Path(__file__).parents[1]/'cash_workbook.py')
cw = importlib.util.module_from_spec(spec); spec.loader.exec_module(cw)


class WorkbookControls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.source = {'version': 1, 'kind': 'exceptional-cash-workbook-master', 'companyId': 'synthetic-company',
                       'refreshedAt': '2026-10-31T09:00:00+08:00', 'master': [
                           {'personId': 'synthetic-guard', 'staffNo': 'SYN001', 'name': 'Synthetic Guard', 'companyId': 'synthetic-company',
                            'assignments': [{'siteId': 'synthetic-site', 'siteName': 'Synthetic Site', 'date': '2026-10-31'}]}], 'submitted': []}
        self.src = self.root/'master.json'; self.src.write_text(json.dumps(self.source))
        self.evidence = self.root/'evidence'; self.evidence.mkdir()
        for name in ['request', 'approval']:
            (self.evidence/(name+'.pdf')).write_bytes(b'%PDF-1.4\nSYNTHETIC '+name.encode()+b'\n%%EOF')
        self.values = ['synthetic-guard', 'synthetic-site', '2026-10-31', 150, 'Additional payroll support', 'synthetic-om', '2026-10-31T08:00:00+08:00', 'request.pdf', 'SYN-APP-1', 'synthetic-ceo', '2026-10-31T08:30:00+08:00', 'approval.pdf', None]
        self.wb = self.root/'approved.xlsx'
        cw.save_new(cw.build(self.source, [self.values], 'SYN-BATCH-1', 'SYN-WORKBOOK-1'), self.wb)
        self.scope = self.root/'scope.json'
        cw.seal(NS(source=self.src, workbook=self.wb, evidence_dir=self.evidence, evidence_checked=True, checked_by='synthetic-doa', output=self.scope))

    def tearDown(self): self.tmp.cleanup()

    def edit(self, sheet, cell, value):
        wb = cw.load_workbook(self.wb); wb[sheet][cell] = value; wb.save(self.wb)

    def convert(self, name='package'):
        cw.convert(NS(source=self.src, workbook=self.wb, evidence_dir=self.evidence, approved_scope=self.scope, output_dir=self.root/name))
        return json.loads((self.root/name/'handover.json').read_text())

    def test_roundtrip_protected_master_lookup_and_static_finance_output(self):
        wb = cw.load_workbook(self.wb)
        self.assertTrue(wb['Guard master'].protection.sheet)
        self.assertTrue(wb['Guard master']['A2'].protection.locked)
        self.assertFalse(wb['Approved list']['A2'].protection.locked)
        self.assertTrue(wb['Approved list']['N2'].protection.locked)
        self.assertIn('VLOOKUP', wb['Approved list']['O2'].value)
        self.assertTrue(wb['Finance handover'].protection.sheet)
        p = self.convert(); self.assertEqual(p['rows'][0]['amount'], 150)
        self.assertTrue(p['evidenceChecked']); self.assertEqual(p['rows'][0]['personId'], 'synthetic-guard')
        output = cw.load_workbook(self.root/'package/finance-handover.xlsx', data_only=True)
        self.assertEqual(output.active['D2'].value, 'Synthetic Guard'); self.assertEqual(output.active['H2'].value, 150)
        self.assertEqual(output.active['P2'].value, 150)
        self.assertEqual(len(list(self.root.joinpath('package').iterdir())), 3)
        self.assertEqual((self.root/'package/handover.json').stat().st_mode & 0o777, 0o600)

    def test_unassigned_buffer_guard_is_visible_but_cannot_invent_site_assignment(self):
        self.source['master'].append({'personId': 'buffer', 'staffNo': 'BUFFER', 'name': 'Synthetic buffer', 'companyId': 'synthetic-company', 'assignments': []})
        self.src.write_text(json.dumps(self.source))
        source = cw.snapshot(self.src)
        cw.save_new(cw.build(source, [self.values], 'SYN-BATCH-1', 'SYN-WORKBOOK-1'), self.root/'buffer.xlsx')
        wb = cw.load_workbook(self.root/'buffer.xlsx')
        self.assertEqual(wb['Guard master']['A3'].value, 'buffer')
        self.assertIsNone(wb['Guard master']['E3'].value)
        cw.validated(self.root/'buffer.xlsx', source, self.evidence)
        wb['Approved list']['A2'] = 'buffer'; wb.save(self.root/'buffer.xlsx')
        with self.assertRaisesRegex(ValueError, 'assignment'):
            cw.validated(self.root/'buffer.xlsx', source, self.evidence)

    def test_changed_approval_scope_is_rejected(self):
        original = self.wb.read_bytes()
        for cell, value in [('D2', 151), ('C2', '2026-11-01'), ('I2', 'SYN-APP-2'), ('J2', 'different-ceo'), ('F2', 'different-om'), ('E2', 'changed reason')]:
            with self.subTest(cell=cell):
                self.wb.write_bytes(original); self.edit('Approved list', cell, value)
                with self.assertRaisesRegex(ValueError, 'scope'): self.convert()
                self.assertFalse((self.root/'package').exists())

    def test_changed_evidence_bytes_rejected(self):
        (self.evidence/'approval.pdf').write_bytes(b'%PDF-1.4\nCHANGED\n%%EOF')
        with self.assertRaisesRegex(ValueError, 'scope'): self.convert()

    def test_missing_scope_or_attestation_rejected(self):
        with self.assertRaisesRegex(ValueError, 'DOA must check'):
            cw.seal(NS(source=self.src, workbook=self.wb, evidence_dir=self.evidence, evidence_checked=False, checked_by='doa', output=self.root/'new.json'))
        self.scope.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'scope'): self.convert()

    def test_missing_or_unsafe_evidence_rejected(self):
        for value in ['missing.pdf', '../request.pdf', str(self.evidence/'request.pdf')]:
            self.edit('Approved list', 'H2', value)
            with self.assertRaises(ValueError): self.convert()
        self.edit('Approved list', 'H2', 'bad.pdf'); (self.evidence/'bad.pdf').write_text('not PDF')
        with self.assertRaisesRegex(ValueError, 'signature'): self.convert()

    def test_duplicate_rows_and_approval_lines_rejected(self):
        wb = cw.load_workbook(self.wb)
        for col, val in enumerate(self.values, 1): wb['Approved list'].cell(3, col, val)
        wb.save(self.wb)
        with self.assertRaisesRegex(ValueError, 'Duplicate'): self.convert()

    def test_invalid_amounts_guard_site_and_missing_fields_rejected(self):
        original = self.wb.read_bytes()
        for cell, val in [('A2', 'staff-not-guard'), ('B2', 'other-site'), ('D2', 0), ('D2', -1), ('D2', 1.001), ('H2', None), ('I2', None), ('C2', '2026-02-30'), ('G2', '2026-10-31T09:00:00')]:
            with self.subTest(cell=cell, val=val):
                self.wb.write_bytes(original); self.edit('Approved list', cell, val)
                with self.assertRaises((ValueError, TypeError)): self.convert()

    def test_formula_in_input_rejected_and_source_formula_text_safe(self):
        self.edit('Approved list', 'A2', '=1+1')
        with self.assertRaisesRegex(ValueError, 'Formula'): self.convert()
        s = copy.deepcopy(self.source); s['master'][0]['name'] = '=HYPERLINK("https://invalid")'
        wb = cw.build(s); self.assertEqual(wb['Guard master']['C2'].data_type, 's')

    def test_modified_master_and_stale_source_rejected(self):
        self.edit('Guard master', 'C2', 'Wrong Name')
        with self.assertRaisesRegex(ValueError, 'master was edited'): self.convert()
        self.source['refreshedAt'] = '2026-10-31T10:00:00+08:00'; self.src.write_text(json.dumps(self.source))
        with self.assertRaisesRegex(ValueError, 'stale'): self.convert()

    def test_refresh_preserves_entries_rebuilds_master_and_excludes_extra_private_fields(self):
        self.source['refreshedAt'] = '2026-10-31T10:00:00+08:00'
        self.source['master'][0]['bankAccount'] = 'must-not-export'
        self.source['master'][0]['name'] = 'Refreshed Synthetic Name'
        self.src.write_text(json.dumps(self.source))
        new = self.root/'refreshed.xlsx'
        cw.refresh(NS(source=self.src, workbook=self.wb, output=new))
        wb = cw.load_workbook(new); self.assertEqual(wb['Guard master']['C2'].value, 'Refreshed Synthetic Name')
        self.assertEqual(wb['Approved list']['D2'].value, 150)
        self.assertNotIn('bankAccount', str(cw.snapshot(self.src)))
        self.wb = new; self.convert()

    def test_cross_company_refresh_and_duplicate_export_rejected(self):
        self.source['companyId'] = 'other'; self.source['master'][0]['companyId'] = 'other'; self.src.write_text(json.dumps(self.source))
        with self.assertRaisesRegex(ValueError, 'across companies'): cw.refresh(NS(source=self.src, workbook=self.wb, output=self.root/'new.xlsx'))
        self.source['companyId'] = 'synthetic-company'; self.source['master'][0]['companyId'] = 'synthetic-company'
        self.source['submitted'] = [{'id':'existing', 'personId':'synthetic-guard', 'occasion':'2026-10-31','approvalId':'old','batchId':'old-batch','status':'prepared'}]
        self.src.write_text(json.dumps(self.source)); new = self.root/'refreshed.xlsx'
        cw.refresh(NS(source=self.src, workbook=self.wb, output=new)); self.wb = new
        with self.assertRaisesRegex(ValueError, 'already submitted'): self.convert()

    def test_sheet_reordering_does_not_invalidate_approved_scope(self):
        wb = cw.load_workbook(self.wb); wb.move_sheet('Approved list', offset=1); wb.save(self.wb)
        self.assertEqual(self.convert()['rows'][0]['amount'], 150)

    def test_files_are_never_overwritten(self):
        with self.assertRaises(ValueError): cw.save_new(cw.build(self.source), self.wb)
        self.convert()
        with self.assertRaises(FileExistsError): self.convert()
        with self.assertRaises(FileExistsError): cw.seal(NS(source=self.src, workbook=self.wb, evidence_dir=self.evidence, evidence_checked=True, checked_by='doa', output=self.scope))

    def test_changed_recipient_even_valid_master_requires_new_approval(self):
        other = copy.deepcopy(self.source['master'][0]); other['personId'] = 'other-guard'; other['staffNo'] = 'SYN002'; self.source['master'].append(other)
        self.src.write_text(json.dumps(self.source)); new = self.root/'refreshed.xlsx'
        cw.refresh(NS(source=self.src, workbook=self.wb, output=new)); self.wb = new
        self.edit('Approved list', 'A2', 'other-guard')
        with self.assertRaisesRegex(ValueError, 'scope'): self.convert()


if __name__ == '__main__': unittest.main()
