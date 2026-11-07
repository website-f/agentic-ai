import fs from 'node:fs';
import ts from 'typescript';

// Keep the real HTTP error and offline context behavior in transport tests.
// Loading an explicit dependency graph avoids relative imports from data URLs.
function loadSource(path, dependencies = {}) {
  const source = fs.readFileSync(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const require = (name) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency in ${path}: ${name}`);
    return dependencies[name];
  };
  // No browser channel in these Node transport tests. Shadow it only within
  // this module, without mutating globals or leaving Node channel handles open.
  new Function('require', 'module', 'exports', 'BroadcastChannel', code)(
    require, module, module.exports, undefined,
  );
  return module.exports;
}

export const dutyContext = loadSource('duty/context.ts');
export const { HttpApi, SESSION_ENDED } = loadSource('api/http.ts', {
  './types': loadSource('api/types.ts'),
  './microsoft': {
    MicrosoftSignIn: class {
      static start() { throw new Error('Supply a synthetic Microsoft session in HTTP tests.'); }
    },
  },
  '../duty/context': dutyContext,
});
