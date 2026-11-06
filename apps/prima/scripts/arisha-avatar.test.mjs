// Offline component/asset regression checks. These are not browser layout or pointer UAT.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
const asset = readFileSync(new URL('../apps/web/src/assets/arisha-approved.png', import.meta.url));
const uri = `data:image/png;base64,${asset.toString('base64')}`;
const source = readFileSync(new URL('../apps/web/src/ArishaAvatar.tsx', import.meta.url), 'utf8');
function load(react = React) {
  const code = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
  const module = {exports:{}};
  const localRequire = name => {
    if (name === 'react') return react;
    if (name === './assets/arisha-approved.png?inline') return {default:uri};
    throw new Error(`Unexpected avatar dependency ${name}`);
  };
  new Function('require','module','exports','React',code)(localRequire,module,module.exports,react);
  return module.exports.ArishaAvatar;
}
test('approved image bytes and 200px dimensions are unchanged', () => {
  assert.equal(createHash('sha256').update(asset).digest('hex'),'4923e1d8962fb84c27c57115fa9a68198e1c9704adce91d662274e30410748fc');
  assert.equal(asset.readUInt32BE(16),200); assert.equal(asset.readUInt32BE(20),200);
});
test('real component renders a bundled accessible image with no native image dragging', () => {
  const html = renderToStaticMarkup(React.createElement(load(),{size:52}));
  assert.ok(html.includes(uri)); assert.match(html,/alt="Arisha"/); assert.match(html,/draggable="false"/);
  assert.match(html,/width="52"/); assert.match(html,/height="52"/); assert.match(html,/pointer-events:none/);
  assert.doesNotMatch(html,/https?:\/\/|<svg/);
});
test('image error switches to accessible A fallback without a remote retry', () => {
  let failed = false;
  const Component = load({...React,useState:()=>[failed,value=>{failed=value;}]});
  const image = Component({size:28}); assert.equal(image.type,'img'); image.props.onError();
  const fallback = Component({size:28}); const html=renderToStaticMarkup(fallback);
  assert.equal(failed,true); assert.match(html,/role="img"/); assert.match(html,/aria-label="Arisha"/);
  assert.match(html,/>A<\/span>/); assert.doesNotMatch(html,/<img|src=/);
});
test('decorative slots avoid duplicate accessible labels, including after image failure', () => {
  const html=renderToStaticMarkup(React.createElement(load(),{size:28,decorative:true})); assert.match(html,/alt=""/);
  const fallback=load({...React,useState:()=>[true,()=>{}]})({size:28,decorative:true});
  const markup=renderToStaticMarkup(fallback); assert.match(markup,/aria-hidden="true"/); assert.doesNotMatch(markup,/role="img"|aria-label=/);
});
test('P80: the one launcher and the panel header use the same component; the panel is a side panel, not a dragged avatar', () => {
  const integration=readFileSync(new URL('../apps/web/src/Arisha.tsx',import.meta.url),'utf8');
  const launcher=readFileSync(new URL('../apps/web/src/Launcher.tsx',import.meta.url),'utf8');
  assert.equal((integration.match(/<ArishaAvatar /g)||[]).length,1);
  assert.equal((launcher.match(/<ArishaAvatar /g)||[]).length,2);
  for(const hook of ['role="dialog"','aria-labelledby={titleId}','hidden={!open}',"e.key !== 'Escape'","aria-label={t('close', lang)}"])assert.ok(integration.includes(hook),hook);
  assert.doesNotMatch(integration,/onPointerDown|function Face\(|<Face|prima\.arisha\.pos/);
  const css=readFileSync(new URL('../apps/web/src/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.launcher-button \{[^}]*width: 56px;[^}]*height: 56px;/s);
  assert.match(css,/\.arisha-head \.arisha-heading \{[^}]*min-width: 0;[^}]*text-overflow: ellipsis;/s);
  assert.doesNotMatch(css,/\.arisha-avatar/);
});
test('built demo contains exact image bytes with no external avatar file dependency', {skip:!existsSync(new URL('../apps/web/dist-demo/index.html',import.meta.url))}, () => {
  const html=readFileSync(new URL('../apps/web/dist-demo/index.html',import.meta.url),'utf8');
  assert.ok(html.includes(uri)); assert.doesNotMatch(html,/src=["'][^"']*arisha-approved\.png/);
});
