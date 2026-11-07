// P85: label and scanner pieces, evaluated from the exact TS sources with no browser, camera or printer (those are UAT).
// Wedge vs typed detection, scanner prefix cleaning, the zxing .wasm never fetched off this website, the native reader
// used only when it reads both formats, the Code 128 check symbol against a hand-worked vector, the QR code in
// alphanumeric mode with error correction Q and a 4-module quiet zone, and the label sheet layout.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path'), ts = require('typescript');
const src = path.join(__dirname, '../src/views');
function load(file, deps = {}, patch = (s) => s) {
  const out = ts.transpileModule(patch(fs.readFileSync(path.join(src, file), 'utf8')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(out, { exports, require: (id) => deps[id] ?? require(id), window: {}, document: {}, Promise, setTimeout });
  return exports;
}
(async () => {
  // Keyboard wedge: a fast burst ended by Enter is a scanner; slow keys or no terminator is typed.
  const keys = load('items/keys.ts');
  const fast = Array.from({ length: 19 }, (_, k) => k * 8);
  const slow = Array.from({ length: 19 }, (_, k) => k * 140);
  assert.equal(keys.classifyKeys(fast, 19, true), 'wedge');
  assert.equal(keys.classifyKeys(fast, 19, false), 'typed');
  assert.equal(keys.classifyKeys(slow, 19, true), 'typed');
  assert.equal(keys.classifyKeys(fast.slice(0, 5), 5, true), 'typed');
  assert.equal(keys.cleanScan(']Q1P1ABCDEFGHJKMNPQRST\r\n'), 'P1ABCDEFGHJKMNPQRST');
  assert.equal(keys.cleanScan('x'.repeat(200)).length, 80);

  // The reader's .wasm always comes from this website, under its base path; never jsDelivr.
  const dec = load('items/decoder.ts', {}, (s) => s.replace(/import\.meta\.env\.BASE_URL/g, "'/prima/'").replace('declare const __DEMO__: boolean;', '').replace(/__DEMO__/g, 'false'));
  assert.equal(dec.zxingWasmUrl('/prima/'), '/prima/zxing/zxing_reader.wasm');
  assert.equal(dec.zxingWasmUrl('/'), '/zxing/zxing_reader.wasm');
  assert.equal(dec.locateFile('zxing_reader.wasm', 'https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.6/dist/reader/'), '/prima/zxing/zxing_reader.wasm');
  assert.ok(!/^https?:/.test(dec.locateFile('anything.wasm', 'https://cdn.example/')));
  // The browser's own reader only when it reads both QR and Code 128.
  const ctor = (formats) => Object.assign(class { async detect() { return [{ rawValue: 'P1' }]; } }, { getSupportedFormats: async () => formats });
  assert.equal(await dec.nativeDecoder({ BarcodeDetector: ctor(['qr_code']) }), null);
  assert.equal(await dec.nativeDecoder({}), null);
  assert.equal((await dec.nativeDecoder({ BarcodeDetector: ctor(['qr_code', 'code_128', 'ean_13']) })).kind, 'native');

  // Code 128 B check symbol, worked by hand: "P1" = start B (104) + 48x1 + 17x2 = 186; 186 mod 103 = 83; then stop (106).
  const c128 = load('code128.ts');
  assert.deepEqual([...c128.code128Codes('P1')], [104, 48, 17, 83, 106]);
  assert.throws(() => c128.code128Codes('Pé1'));
  assert.match(c128.code128Svg('P1ABC'), /^<svg /);

  // QR: alphanumeric mode, error correction Q, quiet zone of 4 modules (4 x cell size), version 2 for a label payload.
  const labels = load('items/labels.ts', { '../code128': c128 });
  const payload = 'P17K4M2X8Q6C9R5N3TA';
  const svg = labels.qrSvg(payload);
  const n = labels.qrModules(payload);
  assert.equal(n, 25, 'version 2 (25 modules) for a 19-character alphanumeric payload at level Q');
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? /width="(\d+)px" height="(\d+)px"/.exec(svg);
  assert.ok(vb, 'svg has a size');
  assert.equal(Number(vb[1]), (n + 8) * 4, 'four modules of quiet zone on each side');
  assert.throws(() => labels.qrSvg('https://example.invalid'), /upper-case/);
  // Label sheets: 21 per A4 sheet; "start at 20" leaves 19 cells empty and moves the rest to a second sheet.
  const t = labels.TEMPLATES.a4_l7160_21;
  assert.equal(labels.perPage(t), 21);
  const pages = labels.layout(t, Array.from({ length: 5 }, (_, k) => k), 20);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].filter((x) => x === null).length, 19);
  assert.deepEqual([...pages[1]], [2, 3, 4]);
  for (const tp of Object.values(labels.TEMPLATES)) {
    assert.ok(tp.margin.left * 2 + tp.cols * tp.cell.w + (tp.cols - 1) * tp.gap.x <= tp.page.w + 0.01, `${tp.id} fits the page width`);
    assert.ok(tp.margin.top + tp.rows * tp.cell.h + (tp.rows - 1) * tp.gap.y <= tp.page.h + 0.01, `${tp.id} fits the page height`);
  }
  // At 0.5 mm per module the QR code with its quiet zone is 16.5 mm: it fits every label height used.
  assert.ok(Object.values(labels.TEMPLATES).every((tp) => tp.cell.h >= (25 + 8) * 0.5));
  console.log('PASS: wedge vs typed, scanner prefixes, same-origin .wasm, native reader choice, Code 128 vector, QR alphanumeric/Q/quiet zone, label sheet layout (no browser).');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
