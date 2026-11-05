import { useEffect, useRef, useState } from 'react';

/**
 * A finger or stylus signature on the screen (Fauzan, 2 Nov 2026), for someone who signs on another person's phone,
 * such as a patrolling officer or a guard receiving a Goodwill item from the OM. Gives a PNG once enough has been drawn,
 * and null while the pad is empty or cleared.
 */
export function SignaturePad({ label, onChange }: { label: string; onChange: (png: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const ink = useRef(0);
  const [signed, setSigned] = useState(false);

  const reset = () => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.round(w * ratio);
    c.height = Math.round(h * ratio);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // A white page, so the signature reads the same in light and dark mode and in the saved file.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ink.current = 0;
    setSigned(false);
    onChange(null);
  };

  useEffect(() => {
    reset();
    // Only on first show; clearing is the button's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = point(e);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const from = drawing.current;
    const ctx = canvas.current?.getContext('2d');
    if (!from || !ctx) return;
    e.preventDefault();
    const to = point(e);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ink.current += Math.hypot(to.x - from.x, to.y - from.y);
    drawing.current = to;
  };

  const up = () => {
    if (!drawing.current) return;
    drawing.current = null;
    // A dot or a tiny tick is not a signature.
    const ok = ink.current > 80;
    setSigned(ok);
    onChange(ok && canvas.current ? canvas.current.toDataURL('image/png') : null);
  };

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div className="small">{label}</div>
      <canvas
        ref={canvas}
        aria-label={label}
        role="img"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
        style={{ width: '100%', height: 150, border: '1px solid var(--line, #ccc)', borderRadius: 8, background: '#ffffff', touchAction: 'none' }}
      />
      <div className="row" style={{ gap: 6, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="muted small">{signed ? 'Signed.' : 'Sign with a finger inside the box.'}</span>
        <button type="button" className="btn btn-sm" onClick={reset}>
          Clear
        </button>
      </div>
    </div>
  );
}
