import { beforeEach, describe, expect, it } from "vitest";
import type {
  TranslationSegment,
  TranslationSession,
} from "../types";
import {
  deleteSession,
  getSession,
  listSegments,
  listSessions,
  resetDatabaseForTests,
  saveSegment,
  saveSession,
} from "./database";

const session: TranslationSession = {
  id: "session-1",
  title: "测试记录",
  startedAt: 1_000,
  sourceMode: "microphone",
  targetLanguage: "en",
};

function segment(sequence: number): TranslationSegment {
  return {
    id: `segment-${sequence}`,
    sessionId: session.id,
    sequence,
    startedAtMs: sequence * 1000,
    endedAtMs: sequence * 1000 + 800,
    sourceText: `原文 ${sequence}`,
    translatedText: `Translation ${sequence}`,
    status: "done",
  };
}

describe("IndexedDB storage", () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  it("saves sessions and returns segments in sequence order", async () => {
    await saveSession(session);
    await saveSegment(segment(2));
    await saveSegment(segment(1));

    expect(await getSession(session.id)).toEqual(session);
    expect((await listSessions()).map((item) => item.id)).toEqual([
      session.id,
    ]);
    expect(
      (await listSegments(session.id)).map((item) => item.sequence),
    ).toEqual([1, 2]);
  });

  it("deletes a session and all of its segments", async () => {
    await saveSession(session);
    await saveSegment(segment(1));
    await deleteSession(session.id);

    expect(await getSession(session.id)).toBeUndefined();
    expect(await listSegments(session.id)).toEqual([]);
  });
});
