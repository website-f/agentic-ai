import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately mirrored from apps/api/src/arisha-transport.ts; exact body parity is tested.
// Builtins-only so diagnostics work before npm ci or an application build.
export function azureOpenAiEndpoint(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.openai\.azure\.com$/i.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

export function endpointShapeValid(document) {
  const env = document?.properties?.template?.containers?.[0]?.env;
  const entry = Array.isArray(env) ? env.find(item => item?.name === 'AZURE_OPENAI_ENDPOINT') : undefined;
  // Never resolve secret references or treat an absent/blank endpoint as a known invalid endpoint.
  if (entry?.secretRef || typeof entry?.value !== 'string' || !entry.value.trim()) return null;
  return azureOpenAiEndpoint(entry.value) !== null;
}

async function main() {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) throw new Error('Invalid diagnostic input');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    const document = JSON.parse(raw);
    const projected = spawnSync('jq', ['-f', join(dirname(fileURLToPath(import.meta.url)), 'arisha-readiness.jq')], {
      input: raw, encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024,
    });
    if (projected.status !== 0) throw new Error('Projection failed');
    const result = JSON.parse(projected.stdout);
    process.stdout.write(JSON.stringify({ ...result, endpointShapeValid: endpointShapeValid(document) }, null, 2) + '\n');
  } catch {
    // No input, provider settings, raw parser errors or jq stderr are disclosed.
    process.stderr.write('Arisha readiness diagnostics could not be generated.\n');
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
