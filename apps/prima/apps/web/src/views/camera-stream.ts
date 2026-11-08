/**
 * P90 (Fitri, 9 Nov 2026: "when I open the camera sometimes the camera allowed is very slow"): one way to open the camera
 * for the item scanner and the face check. The camera is asked for at once, before anything else loads (the code reader
 * and the face engine load beside it, never in front of it), with sizes every phone camera has (no exact sizes that make
 * a phone hunt for a mode), and a plain fallback when a phone refuses the preferred settings. Every track is stopped
 * when the screen closes, so the camera light goes off at once.
 */

export type Facing = 'user' | 'environment';

/** The sizes asked for: big enough to read a label or see a face, small enough to open fast on any phone. */
export function cameraConstraints(facing: Facing, deviceId?: string | null): MediaStreamConstraints {
  const size = facing === 'environment' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 640 }, height: { ideal: 480 } };
  const video: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: facing }, ...size };
  return { video: { ...video, frameRate: { ideal: 30, max: 30 } }, audio: false };
}

/**
 * Opens the camera. A phone that refuses the preferred settings (OverconstrainedError, or a chosen camera that is gone)
 * is asked once more for any camera of that side; a refusal of permission is passed on as it is.
 */
export async function openCamera(facing: Facing, deviceId?: string | null, md: Pick<MediaDevices, 'getUserMedia'> | undefined = navigator.mediaDevices): Promise<MediaStream> {
  if (!md?.getUserMedia) throw Object.assign(new Error('No camera API'), { name: window.isSecureContext === false ? 'SecurityError' : 'NotSupportedError' });
  try {
    return await md.getUserMedia(cameraConstraints(facing, deviceId));
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? '';
    if (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError' && !(deviceId && name === 'NotFoundError')) throw e;
    return md.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
  }
}

/** Stops every track, so the camera light goes off. */
export function stopStream(s: MediaStream | null | undefined): void {
  s?.getTracks().forEach((t) => t.stop());
}

/** The cameras of this device (names show only after permission was given). */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

/** Keeps a label sharp where the phone allows it (continuous focus); quietly does nothing elsewhere. */
export function keepFocus(track: MediaStreamTrack | undefined): void {
  try {
    const caps = (track?.getCapabilities?.() ?? {}) as { focusMode?: string[] };
    if (caps.focusMode?.includes('continuous')) void track!.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
  } catch {
    /* not supported */
  }
}

/** Whether the camera has a torch that the page may switch on. */
export function hasTorch(track: MediaStreamTrack | undefined): boolean {
  try {
    return !!(track?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch;
  } catch {
    return false;
  }
}

/** Runs a job when the browser is idle (or soon), so a heavy file loads before it is needed without slowing the page. */
export function whenIdle(job: () => void, timeoutMs = 1500): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(job, { timeout: timeoutMs });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(job, 600);
  return () => window.clearTimeout(t);
}

/** A short buzz and beep: high for a good read, low for anything else. Skipped quietly where the phone does not allow it. */
export function scanFeedback(ok: boolean): void {
  try {
    navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
  } catch {
    /* no vibration */
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1320 : 330;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    o.onended = () => void ctx.close();
  } catch {
    /* no sound */
  }
}
