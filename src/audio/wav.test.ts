import { describe, expect, it } from "vitest";
import { encodeWav, StreamingResampler } from "./wav";

describe("encodeWav", () => {
  it("creates a mono 16-bit PCM WAV with correct headers", () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 1, -1]);
    const buffer = encodeWav(samples, 16_000);
    const view = new DataView(buffer);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(
        ...Array.from({ length }, (_, index) =>
          view.getUint8(offset + index),
        ),
      );

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(buffer.byteLength).toBe(44 + samples.length * 2);
  });
});

describe("StreamingResampler", () => {
  it("preserves continuity across chunk boundaries", () => {
    const resampler = new StreamingResampler(48_000, 16_000);
    const first = resampler.process(new Float32Array(480).fill(0.25));
    const second = resampler.process(new Float32Array(480).fill(-0.25));

    expect(first.length).toBeGreaterThan(140);
    expect(first.length).toBeLessThanOrEqual(160);
    expect(second.length).toBeGreaterThan(140);
    expect(second.length).toBeLessThanOrEqual(160);
    expect(first.at(-1)).toBeCloseTo(0.25, 5);
  });
});
