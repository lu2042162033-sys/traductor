import { describe, expect, it } from "vitest";
import type {
  TranslationSegment,
  TranslationSession,
} from "../types";
import {
  formatSrtTimestampForTest,
  toJson,
  toMarkdown,
  toPlainText,
  toSrt,
} from "./exporters";

const session: TranslationSession = {
  id: "session",
  title: "双语记录",
  startedAt: new Date(2026, 10, 25, 10, 30, 0).getTime(),
  sourceMode: "tab",
  targetLanguage: "zh",
};

const segments: TranslationSegment[] = [
  {
    id: "one",
    sessionId: session.id,
    sequence: 1,
    startedAtMs: 0,
    endedAtMs: 3200,
    sourceText: "Good morning.",
    translatedText: "早上好。",
    status: "done",
  },
  {
    id: "two",
    sessionId: session.id,
    sequence: 2,
    startedAtMs: 4200,
    endedAtMs: 8750,
    sourceText: "Welcome.",
    translatedText: "欢迎。",
    status: "done",
  },
];

describe("exporters", () => {
  it("creates readable Markdown and plain text", () => {
    expect(toMarkdown(session, segments)).toContain("**原文：** Good morning.");
    expect(toMarkdown(session, segments)).toContain("**译文：** 早上好。");
    expect(toPlainText(session, segments)).toContain("[00:00:04]");
  });

  it("creates bilingual SRT with millisecond timestamps", () => {
    const srt = toSrt(segments);
    expect(srt).toContain("00:00:00,000 --> 00:00:03,200");
    expect(srt).toContain("Good morning.\n早上好。");
    expect(formatSrtTimestampForTest(3_723_456)).toBe(
      "01:02:03,456",
    );
  });

  it("serializes all data as versioned JSON", () => {
    const parsed = JSON.parse(toJson(session, segments)) as {
      schemaVersion: number;
      segments: TranslationSegment[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.segments).toHaveLength(2);
  });
});
