import { describe, expect, it } from "vitest";

import { clock, duration, isActive, isRecording, parseClock, speakerColor, speakerNumber, stageOf } from "./minutes";

describe("meeting minutes helpers", () => {
  it("formats transcript times and lengths", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(405.7)).toBe("6:45");
    expect(clock(3725)).toBe("1:02:05");
    expect(duration(null)).toBe("");
    expect(duration(42)).toBe("42 s");
    expect(duration(1200)).toBe("20 min");
    expect(duration(3600)).toBe("1 h");
    expect(duration(5400)).toBe("1 h 30 min");
  });

  it("reads topic start times back", () => {
    expect(parseClock("6:45")).toBe(405);
    expect(parseClock("[1:02:05]")).toBe(3725);
    expect(parseClock("soon")).toBeNull();
  });

  it("knows which files are recordings", () => {
    expect(isRecording(new File([""], "board.M4A"))).toBe(true);
    expect(isRecording(new File([""], "call", { type: "video/quicktime" }))).toBe(true);
    expect(isRecording(new File([""], "notes.pdf", { type: "application/pdf" }))).toBe(false);
  });

  it("maps status to the timeline stage", () => {
    expect(stageOf({ status: "queued" })).toBe("extract");
    expect(stageOf({ status: "transcribing" })).toBe("transcribe");
    expect(stageOf({ status: "ready" })).toBe("ready");
    expect(isActive("writing")).toBe(true);
    expect(isActive("failed")).toBe(false);
    expect(stageOf({ status: "extracting", speakers_total: 0 })).toBe("extract");
    expect(stageOf({ status: "extracting", speakers_total: 6 })).toBe("speakers");
  });

  it("gives each speaker a palette colour", () => {
    expect(speakerColor("S1")).toBe("var(--series-1)");
    expect(speakerColor("S8")).toBe("var(--series-8)");
    expect(speakerColor("S9")).toBe("var(--series-1)");
    expect(speakerNumber("S3")).toBe("3");
  });
});
