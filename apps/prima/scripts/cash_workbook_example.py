#!/usr/bin/env python3
"""Generate a minimal synthetic rehearsal, never a valid manual approval."""
import argparse
from pathlib import Path
from types import SimpleNamespace as NS
import cash_workbook as cw


def pdf(label):
    content = ('BT /F1 14 Tf 40 750 Td (SYNTHETIC EXAMPLE - NOT VALID APPROVAL) Tj 0 -30 Td (' + label + ') Tj ET').encode()
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Length '+str(len(content)).encode()+b' >>\nstream\n'+content+b'\nendstream']
    data = b'%PDF-1.4\n'; offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data)); data += str(i).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
    xref = len(data); data += b'xref\n0 6\n0000000000 65535 f \n'
    for n in offsets[1:]: data += ('%010d 00000 n \n' % n).encode()
    return data+b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+str(xref).encode()+b'\n%%EOF\n'


def generate(output):
    root = Path(output); root.mkdir(mode=0o700, parents=False, exist_ok=False)
    source = {'version': 1, 'kind': 'exceptional-cash-workbook-master', 'companyId': 'synthetic-company', 'refreshedAt': '2026-10-31T10:00:00+08:00',
              'master': [{'personId': 'synthetic-guard', 'staffNo': 'SYN001', 'name': 'Synthetic Guard', 'companyId': 'synthetic-company',
                          'assignments': [{'siteId': 'synthetic-site', 'siteName': 'Synthetic Site', 'date': '2026-10-31'}]}], 'submitted': []}
    cw.write_new(root/'master.json', source)
    evidence = root/'evidence'; evidence.mkdir(mode=0o700)
    for name in ['request', 'approval']:
        (evidence/(name+'.pdf')).write_bytes(pdf('Synthetic '+name+' for SYN001 / RM150 / 2026-10-31 / synthetic-site'))
    vals = ['synthetic-guard', 'synthetic-site', '2026-10-31', 150, 'Synthetic additional support example; not an eligibility rule or cap', 'synthetic-om', '2026-10-31T08:00:00+08:00', 'request.pdf', 'SYN-APP-1', 'synthetic-ceo', '2026-10-31T09:00:00+08:00', 'approval.pdf', None]
    cw.save_new(cw.build(source, [vals], 'SYN-BATCH-1', 'SYN-WORKBOOK-1'), root/'approved-example.xlsx')
    cw.seal(NS(source=root/'master.json', workbook=root/'approved-example.xlsx', evidence_dir=evidence, evidence_checked=True, checked_by='synthetic-doa', output=root/'checked-scope.json'))
    cw.convert(NS(source=root/'master.json', workbook=root/'approved-example.xlsx', evidence_dir=evidence, approved_scope=root/'checked-scope.json', output_dir=root/'finance-package'))
    empty = dict(source, companyId='replace-via-authorized-refresh', master=[])
    cw.save_new(cw.build(empty), root/'blank-template.xlsx')
    print('Synthetic rehearsal generated; never submit this example as a real approval.')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--output-dir', required=True)
    generate(p.parse_args().output_dir)
