export type TargetLanguage = "zh" | "en" | "es";
export type AudioSource = "microphone" | "tab";
export type SegmentStatus =
  | "pending"
  | "transcribing"
  | "translating"
  | "done"
  | "error";

export interface TranslationSession {
  id: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  sourceMode: AudioSource;
  targetLanguage: TargetLanguage;
}

export interface TranslationSegment {
  id: string;
  sessionId: string;
  sequence: number;
  startedAtMs: number;
  endedAtMs: number;
  sourceText: string;
  translatedText: string;
  status: SegmentStatus;
  latencyMs?: number;
  errorMessage?: string;
}

export interface TranslationContextItem {
  sourceText: string;
  translatedText: string;
}

export interface CapturedSegment {
  blob: Blob;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
}

export interface TranslationDelta {
  text: string;
}

export interface WorkerError {
  code: string;
  message: string;
}

export type InterpretEvent =
  | { type: "source"; text: string }
  | { type: "translation"; text: string }
  | { type: "done"; latencyMs?: number }
  | { type: "error"; error: WorkerError };

export const LANGUAGE_LABELS: Record<TargetLanguage, string> = {
  zh: "中文",
  en: "英文",
  es: "西班牙文",
};
