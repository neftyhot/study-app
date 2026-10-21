import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const parse = require("../../../electron/lecture-parse.cjs");

describe("whisper-cli and ffmpeg output", () => {
  it("reads the newest progress percentage from stderr", () => {
    expect(
      parse.parseProgress(
        "whisper_print_progress_callback: progress =  35%\nwhisper_print_progress_callback: progress =  40%\n",
      ),
    ).toBe(40);
    expect(parse.parseProgress("progress = 100%")).toBe(100);
    expect(parse.parseProgress("whisper_model_load: loading model")).toBeNull();
  });

  it("reads the line whisper just printed", () => {
    expect(
      parse.parseLiveSegment("[00:00:02.620 --> 00:00:06.040]   The Krebs cycle starts here.\n"),
    ).toEqual({ end: 6.04, text: "The Krebs cycle starts here." });
    expect(parse.parseLiveSegment("nothing")).toBeNull();
  });

  it("reads ffmpeg's duration and position", () => {
    expect(parse.parseDuration("  Duration: 00:52:14.08, start: 0.000000")).toBeCloseTo(3134.08);
    expect(parse.parseDuration("Duration: N/A")).toBeNull();
    expect(parse.parseFfmpegTime("size=1kB time=00:00:01.00 x\nsize=2kB time=00:10:02.31 x")).toBeCloseTo(
      602.31,
    );
  });

  it("converts clocks with either separator", () => {
    expect(parse.clockToSeconds("01:04:07,250")).toBeCloseTo(3847.25);
    expect(parse.clockToSeconds("4:07")).toBeNull();
  });

  it("accepts only the recordings the tab lists", () => {
    for (const name of ["a.mp3", "a.M4A", "a.wav", "a.aac", "a.mov", "a.mp4"]) {
      expect(parse.isSupportedRecording(name)).toBe(true);
    }
    expect(parse.isSupportedRecording("notes.pdf")).toBe(false);
    expect(parse.isSupportedRecording("mp3")).toBe(false);
  });

  it("titles a transcript after its file", () => {
    expect(parse.titleFromFile("/x/Bio_101__Lecture 4.m4a")).toBe("Bio 101 Lecture 4");
    expect(parse.titleFromFile("/x/.mp3")).not.toBe("");
  });
});

describe("parseWhisperJson", () => {
  const json = JSON.stringify({
    transcription: [
      { offsets: { from: 0, to: 2500 }, text: " Today is glycolysis." },
      { offsets: { from: 2500, to: 4000 }, text: " [BLANK_AUDIO]" },
      { offsets: { from: 3500, to: 6000 }, text: " It  makes\npyruvate." },
      { offsets: { from: 9000, to: 11000 }, text: " Next, the Krebs cycle." },
      { offsets: {}, text: " lost" },
    ],
  });

  it("gives seconds, numbers from zero and drops silence", () => {
    const { segments, duration } = parse.parseWhisperJson(json);
    expect(segments).toEqual([
      { id: 0, start: 0, end: 2.5, text: "Today is glycolysis." },
      { id: 1, start: 3.5, end: 6, text: "It makes pyruvate." },
      { id: 2, start: 9, end: 11, text: "Next, the Krebs cycle." },
    ]);
    expect(duration).toBe(11);
  });

  it("breaks paragraphs at pauses", () => {
    expect(parse.parseWhisperJson(json).fullText).toBe(
      "Today is glycolysis. It makes pyruvate.\n\nNext, the Krebs cycle.",
    );
  });

  it("survives a file with nothing in it", () => {
    expect(parse.parseWhisperJson("{}")).toEqual({ segments: [], fullText: "", duration: 0 });
  });
});
