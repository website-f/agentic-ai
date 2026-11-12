// P100 newa (Fauzan, 11 Nov 2026): input shaping shared by the new workflow controllers. Only shapes and bounds what
// comes in; who may do each step is checked in the core service.
import { BadRequestException } from '@nestjs/common';

/** Papers as proof: documents (PDF, JPEG, PNG) and SharePoint links, at most 3. Photos with GPS are not taken here. */
export function paperProof(v: unknown) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 3) throw new BadRequestException('proof must be a list of up to 3 items');
  return v.map((x) => {
    const b = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const cap = typeof b.caption === 'string' ? b.caption.slice(0, 200) : '';
    if (b.kind === 'document') {
      if (typeof b.name !== 'string' || b.name.length > 120 || typeof b.data !== 'string' || b.data.length > 1_000_000)
        throw new BadRequestException('proof document is not valid');
      return { kind: 'document' as const, name: b.name, data: b.data, caption: cap };
    }
    if (b.kind === 'link') {
      if (typeof b.url !== 'string' || b.url.length > 1800) throw new BadRequestException('proof.url is not valid');
      return { kind: 'link' as const, url: b.url, caption: cap };
    }
    throw new BadRequestException('proof.kind must be document or link');
  });
}

/**
 * The body of one workflow step: the action must be one of the list; plain values only (text up to 4,000 characters,
 * numbers, true/false, short lists of text), and the proof list checked as papers.
 */
export function stepBody(b: unknown, actions: readonly string[]): { action: string; body: Record<string, unknown> } {
  const raw = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const action = raw.action;
  if (typeof action !== 'string' || !actions.includes(action)) throw new BadRequestException(`action must be one of ${actions.join(', ')}`);
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'action') continue;
    if (k === 'proof') body.proof = paperProof(v);
    else if (v === null || typeof v === 'boolean') body[k] = v;
    else if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new BadRequestException(`${k} is not a number`);
      body[k] = v;
    } else if (typeof v === 'string') {
      if (v.length > 4000) throw new BadRequestException(`${k} is too long`);
      body[k] = v;
    } else if (Array.isArray(v)) {
      if (v.length > 200 || v.some((x) => typeof x !== 'string' || x.length > 200)) throw new BadRequestException(`${k} must be a short list of text`);
      body[k] = v;
    } else throw new BadRequestException(`${k} is not valid`);
  }
  return { action, body };
}
