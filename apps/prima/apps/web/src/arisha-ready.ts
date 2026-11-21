import { useEffect, useState } from 'react';
import { api } from './api';
import type { Sample } from './Arisha';

/**
 * P122 (speed): whether Arisha can answer here, apart from Arisha.tsx itself. The launcher asks this on every screen;
 * Arisha's panel, her screen guides and task cards (about 0.5 MB) are fetched only when someone opens her.
 */

interface ClaudeHost {
  use(name: 'sample'): Promise<Sample | null>;
}

/** Claude through the test-link viewer: undefined while finding out, null when not available here. */
export function useSample(enabled = true): Sample | null | undefined {
  const [sample, setSample] = useState<Sample | null | undefined>(undefined);
  // Finding out asks nothing of the person; consent is asked on the first question.
  useEffect(() => {
    if (!enabled) return setSample(null);
    const host = (window as unknown as { claude?: ClaudeHost }).claude;
    if (!host?.use) return setSample(null);
    host.use('sample').then(
      (s) => setSample(() => s),
      () => setSample(null),
    );
  }, [enabled]);
  return sample;
}

export function useArishaReady(): { serverOn: boolean; sample: Sample | null | undefined; ready: boolean } {
  const sampleCapability = useSample(api.mode === 'demo');
  // Never substitute the demo's provider for the configured server AI service.
  const sample = api.mode === 'demo' ? sampleCapability : null;
  // On the Prima server: the office's AI (or Azure OpenAI) once switched on; the test link uses Claude through the page.
  const [serverOn, setServerOn] = useState(false);
  useEffect(() => {
    if (api.mode !== 'server') return;
    api.arishaStatus().then(
      (r) => setServerOn(r.enabled),
      () => setServerOn(false),
    );
  }, []);
  return { serverOn, sample, ready: serverOn || !!sample };
}
