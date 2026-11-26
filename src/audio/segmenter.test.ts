import { describe, expect, it } from "vitest";
import type { CapturedSegment } from "../types";
import { VoiceSegmenter } from "./segmenter";

function frame(value: number, size = 320): Float32Array {
  return new Float32Array(size).fill(value);
}

describe("VoiceSegmenter", () => {
  it("captures speech and finalizes after enough silence", () => {
    const segments: CapturedSegment[] = [];
    const segmenter = new VoiceSegmenter(
      {
        sampleRate: 16_000,
        frameMs: 20,
        preRollMs: 40,
        minSpeechMs: 40,
        silenceMs: 60,
        maxSegmentMs: 500,
        threshold: 0.01,
      },
      (segment) => segments.push(segment),
    );

    segmenter.push(frame(0.0001));
    segmenter.push(frame(0.1));
    segmenter.push(frame(0.1));
    segmenter.push(frame(0.1));
    segmenter.push(frame(0.0001));
    segmenter.push(frame(0.0001));
    segmenter.push(frame(0.0001));

    expect(segments).toHaveLength(1);
    expect(segments[0]?.blob.type).toBe("audio/wav");
    expect(segments[0]?.durationMs).toBeGreaterThanOrEqual(100);
    expect(segments[0]?.blob.size).toBeGreaterThan(44);
  });

  it("forces a segment at the maximum duration", () => {
    const segments: CapturedSegment[] = [];
    const segmenter = new VoiceSegmenter(
      {
        frameMs: 20,
        minSpeechMs: 20,
        maxSegmentMs: 60,
        silenceMs: 500,
        threshold: 0.01,
      },
      (segment) => segments.push(segment),
    );

    for (let index = 0; index < 5; index += 1) {
      segmenter.push(frame(0.2));
    }

    expect(segments).toHaveLength(1);
    expect(segments[0]?.durationMs).toBeGreaterThanOrEqual(60);
  });

  it("flushes an active segment on stop", () => {
    const segments: CapturedSegment[] = [];
    const segmenter = new VoiceSegmenter(
      { minSpeechMs: 20, threshold: 0.01 },
      (segment) => segments.push(segment),
    );
    segmenter.push(frame(0.2));
    segmenter.push(frame(0.2));
    segmenter.flush();

    expect(segments).toHaveLength(1);
  });
});
