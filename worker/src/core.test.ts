import { describe, expect, it } from "vitest";
import { encodeWav } from "../../src/audio/wav";
import {
  buildTranslationMessages,
  isTargetLanguage,
  normalizeContext,
  parseWavDurationSeconds,
} from "./core";

describe("worker core", () => {
  it("reads WAV duration from the header", () => {
    const buffer = encodeWav(new Float32Array(16_000), 16_000);
    expect(parseWavDurationSeconds(buffer)).toBeCloseTo(1, 5);
  });

  it("rejects bytes that are not WAV", () => {
    expect(() =>
      parseWavDurationSeconds(new ArrayBuffer(100)),
    ).toThrow("有效的 WAV");
  });

  it("limits context and builds a translation-only prompt", () => {
    const context = normalizeContext([
      { sourceText: "a", translatedText: "甲" },
      { sourceText: "b", translatedText: "乙" },
      { sourceText: "c", translatedText: "丙" },
    ]);
    const messages = buildTranslationMessages("hello", "zh", context);

    expect(context).toHaveLength(2);
    expect(messages[0]?.content).toContain("Simplified Chinese");
    expect(messages[0]?.content).toContain("Output only");
    expect(messages[1]?.content).toContain('"text":"hello"');
  });

  it("only accepts supported target languages", () => {
    expect(isTargetLanguage("zh")).toBe(true);
    expect(isTargetLanguage("en")).toBe(true);
    expect(isTargetLanguage("es")).toBe(true);
    expect(isTargetLanguage("fr")).toBe(false);
  });
});
