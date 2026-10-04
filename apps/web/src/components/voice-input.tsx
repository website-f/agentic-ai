import { MicrophoneIcon, StopIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError, errorMessage, readCookie } from "@/lib/api";
import { cn } from "@/lib/utils";
import { groupsQuery } from "@/pages/ai-engine/data";

/** Longest recording the server accepts (it refuses more than 10 minutes). */
const MAX_SECONDS = 600;
const NOT_SET_UP = "Voice input needs a speech-to-text model. An admin can add one in AI Engine > Model groups > Speech to text.";
// Recorder formats in order of preference; Safari only offers audio/mp4.
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

type Phase = "idle" | "starting" | "recording" | "sending";

async function transcribe(blob: Blob, seconds: number): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api/transcribe?seconds=${Math.round(seconds * 10) / 10}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/octet-stream",
        "x-csrf-token": readCookie("agentic_csrf"),
        "x-file-type": blob.type || "audio/webm",
      },
      body: blob,
    });
  } catch {
    throw new ApiError(0, "network", "Could not reach the server. Check that the stack is running.");
  }
  const data = (await res.json().catch(() => null)) as { text?: string; code?: string; message?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.code ?? "http_error", data?.message ?? `Transcription failed (${res.status}).`);
  return (data?.text ?? "").trim();
}

function clock(s: number): string {
  const whole = Math.floor(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Microphone for a chat box: records in the browser, sends the recording to /api/transcribe
 * and hands back the text so the person can read and edit it before sending. Nothing is sent
 * to the agent by this button.
 */
export function VoiceInput({
  onText,
  disabled,
  className,
  round,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
  className?: string;
  /** Match a round send button (the assistant composer). */
  round?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const started = useRef(0);
  const timer = useRef<number | null>(null);
  const { data: groups } = useQuery(groupsQuery);
  const transcribeGroup = groups?.find((g) => g.name === "transcribe");
  const notSetUp = !!groups && (!transcribeGroup || transcribeGroup.members.length === 0);

  const release = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  // Leaving the page mid-recording stops the microphone and throws the recording away.
  useEffect(
    () => () => {
      cancelled.current = true;
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      if (timer.current !== null) window.clearInterval(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const stop = () => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  };
  const cancel = () => {
    cancelled.current = true;
    stop();
  };

  const finish = async (blob: Blob, seconds: number) => {
    setPhase("sending");
    try {
      const text = await transcribe(blob, seconds);
      if (text) onText(text);
      else toast.info("No words were heard. Try again a little closer to the microphone.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPhase("idle");
    }
  };

  const start = async () => {
    if (notSetUp) {
      toast.info(NOT_SET_UP);
      return;
    }
    if (typeof window.MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("This browser cannot record audio. Type your message instead.");
      return;
    }
    setPhase("starting");
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      toast.error(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access is blocked. Allow it for this site in the browser settings, then try again."
          : name === "NotFoundError"
            ? "No microphone was found on this device."
            : "Could not start the microphone.",
      );
      setPhase("idle");
      return;
    }
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(media, type ? { mimeType: type } : undefined);
    } catch {
      media.getTracks().forEach((t) => t.stop());
      toast.error("This browser cannot record audio. Type your message instead.");
      setPhase("idle");
      return;
    }
    stream.current = media;
    recorder.current = rec;
    chunks.current = [];
    cancelled.current = false;
    rec.ondataavailable = (ev) => {
      if (ev.data.size) chunks.current.push(ev.data);
    };
    rec.onstop = () => {
      const seconds = (performance.now() - started.current) / 1000;
      release();
      recorder.current = null;
      const blob = new Blob(chunks.current, { type: (rec.mimeType || type || "audio/webm").split(";")[0] });
      chunks.current = [];
      if (cancelled.current || !blob.size) {
        setPhase("idle");
        return;
      }
      void finish(blob, seconds);
    };
    started.current = performance.now();
    setElapsed(0);
    rec.start(1000);
    setPhase("recording");
    timer.current = window.setInterval(() => {
      const s = (performance.now() - started.current) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
  };

  if (phase === "recording") {
    return (
      <div
        role="group"
        aria-label="Recording a voice message"
        className={cn("flex shrink-0 items-center gap-1 rounded-full border border-danger/30 bg-danger/10 p-0.5", className)}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
        }}
      >
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel recording"
          title="Cancel"
          className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <XIcon size={15} weight="bold" />
        </button>
        <span className="flex items-center gap-1.5 px-1 font-mono text-[12.5px] text-fg tabular-nums">
          <span aria-hidden className="size-2 rounded-full bg-danger motion-safe:animate-pulse" />
          <span aria-hidden>{clock(elapsed)}</span>
          <span className="sr-only">Recording. Press stop to turn it into text.</span>
        </span>
        <button
          type="button"
          onClick={stop}
          aria-label="Stop recording and turn it into text"
          title="Stop and transcribe"
          autoFocus
          className="grid size-9 place-items-center rounded-full bg-danger text-white transition-[filter] hover:brightness-110"
        >
          <StopIcon size={14} weight="fill" />
        </button>
      </div>
    );
  }

  const busy = phase === "starting" || phase === "sending";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => void start()}
      disabled={disabled || busy}
      loading={phase === "sending"}
      aria-label={phase === "sending" ? "Turning your voice into text" : "Record a voice message"}
      title={notSetUp ? "Voice input is not set up yet" : "Speak instead of typing"}
      className={cn(round && "size-11 rounded-full", notSetUp && "opacity-60", className)}
    >
      {phase === "sending" ? null : <MicrophoneIcon size={19} />}
    </Button>
  );
}
