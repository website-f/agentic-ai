import { useState } from 'react';
import portrait from './assets/arisha-approved.png?inline';

/** Approved Canva portrait, bundled locally in both server and self-contained demo builds. */
export function ArishaAvatar({ size = 56, decorative = false }: { size?: number; decorative?: boolean }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, pointerEvents: 'none' as const };
  if (failed) return <span className="arisha-portrait arisha-portrait-fallback" style={style}
    role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'Arisha'} aria-hidden={decorative || undefined}>
    <span aria-hidden="true">A</span>
  </span>;
  return <img className="arisha-portrait" src={portrait} width={size} height={size} style={style}
    alt={decorative ? '' : 'Arisha'} draggable={false} onError={() => setFailed(true)} />;
}
