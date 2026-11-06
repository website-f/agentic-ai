// P80: Prima's one launcher (Launcher.tsx), rendered offline with stand-ins for Arisha and the office widget.
// Not a browser test: it checks what the button offers and how it is labelled in each case.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const source = readFileSync(new URL('../apps/web/src/Launcher.tsx', import.meta.url), 'utf8');
const icon = (name) => (props) => React.createElement('svg', { 'data-icon': name, 'aria-hidden': props['aria-hidden'] });

function render({ arishaReady, widget, lang = 'en' }) {
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const module = { exports: {} };
  const deps = {
    react: React,
    '@phosphor-icons/react': { BookOpenTextIcon: icon('book'), ChatCircleDotsIcon: icon('chat'), MegaphoneSimpleIcon: icon('megaphone'), XIcon: icon('x') },
    './Arisha': {
      useArishaReady: () => ({ serverOn: arishaReady, sample: null, ready: arishaReady }),
      Arisha: (p) => React.createElement('section', { 'data-arisha-panel': '', hidden: !p.open }),
    },
    './ArishaAvatar': { ArishaAvatar: () => React.createElement('img', { alt: '', 'data-avatar': '' }) },
    './i18n': { useLang: () => ({ lang }) },
  };
  const localRequire = (name) => {
    if (name in deps) return deps[name];
    throw new Error(`Unexpected launcher dependency ${name}`);
  };
  globalThis.window = { AgenticFeedback: widget, addEventListener() {}, removeEventListener() {} };
  try {
    new Function('require', 'module', 'exports', 'React', code)(localRequire, module, module.exports, React);
    return renderToStaticMarkup(React.createElement(module.exports.Launcher, { user: { id: 'u-staff', name: 'Aina' }, view: 'leave', viewLabel: 'Leave', menu: ['Leave'] }));
  } finally {
    delete globalThis.window;
  }
}
const on = { enabled: true, isOpen: () => false, open: () => true, close() {} };
const off = { enabled: false, isOpen: () => false, open: () => false, close() {} };

test('with Arisha and the office feedback on, one button opens a menu of the three', () => {
  const html = render({ arishaReady: true, widget: on });
  assert.equal((html.match(/class="launcher-button"/g) || []).length, 1);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Help: Arisha, feedback, rules and guide"/);
  assert.match(html, /data-face="arisha"/);
  // Never in the office's own screenshots of the page; never translated by the page translator.
  assert.match(html, /class="launcher" data-feedback-ignore="" data-no-translate="true"/);
  // Arisha's panel is there, closed, so the conversation survives closing it.
  assert.match(html, /data-arisha-panel="" hidden=""/);
});

test('without the widget (or feedback off for this person) the launcher is just Arisha', () => {
  for (const widget of [undefined, off]) {
    const html = render({ arishaReady: true, widget });
    assert.match(html, /aria-label="Ask Arisha"/);
    assert.doesNotMatch(html, /aria-haspopup|aria-expanded/);
  }
  assert.match(render({ arishaReady: true, widget: undefined, lang: 'ms' }), /aria-label="Tanya Arisha"/);
});

test('Arisha off here: the feedback items alone, on a help face; nothing at all when neither is on', () => {
  const html = render({ arishaReady: false, widget: on });
  assert.match(html, /data-face="help"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.doesNotMatch(html, /data-arisha-panel/);
  assert.equal(render({ arishaReady: false, widget: undefined }), '');
  assert.equal(render({ arishaReady: false, widget: off }), '');
});

test('the page sets host mode before it loads the office widget, in office builds only', () => {
  const main = readFileSync(new URL('../apps/web/src/main.tsx', import.meta.url), 'utf8');
  const flag = main.indexOf("window.__agenticLauncher = 'host';");
  const load = main.indexOf("widget.src = '/feedback-widget.js';");
  assert.ok(flag > 0 && load > flag);
  assert.ok(main.lastIndexOf("import.meta.env.VITE_OFFICE === 'true'", flag) > 0);
  // The sheet: a menu with Escape, arrows and focus back to the button.
  for (const hook of ['role="menu"', 'role="menuitem"', "e.key === 'Escape'", "'ArrowDown'", 'button.current?.focus()', 'window.AgenticFeedback?.open(id)']) assert.ok(source.includes(hook), hook);
});
