import type {
  TranslationSegment,
  TranslationSession,
} from "../types";
import { LANGUAGE_LABELS } from "../types";

export type ExportFormat = "markdown" | "txt" | "srt" | "json";

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-")
    + " "
    + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(
      ":",
    );
}

export function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatSrtTimestamp(milliseconds: number): string {
  const safeValue = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(safeValue / 3_600_000);
  const minutes = Math.floor((safeValue % 3_600_000) / 60_000);
  const seconds = Math.floor((safeValue % 60_000) / 1000);
  const millis = safeValue % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

export const formatSrtTimestampForTest = formatSrtTimestamp;

function sessionHeader(session: TranslationSession): string {
  return [
    `开始时间：${formatSessionTime(session.startedAt)}`,
    `目标语言：${LANGUAGE_LABELS[session.targetLanguage]}`,
    `音频来源：${session.sourceMode === "microphone" ? "麦克风" : "标签页/系统音频"}`,
  ].join("\n");
}

export function toMarkdown(
  session: TranslationSession,
  segments: TranslationSegment[],
): string {
  const lines = [
    `# ${session.title}`,
    "",
    sessionHeader(session),
    "",
  ];

  for (const segment of segments) {
    lines.push(
      `## ${formatClock(segment.startedAtMs)} - ${formatClock(segment.endedAtMs)}`,
      "",
      `**原文：** ${segment.sourceText || "（无识别结果）"}`,
      "",
      `**译文：** ${segment.translatedText || "（无翻译结果）"}`,
      "",
    );
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function toPlainText(
  session: TranslationSession,
  segments: TranslationSegment[],
): string {
  const lines = [session.title, sessionHeader(session), ""];

  for (const segment of segments) {
    lines.push(
      `[${formatClock(segment.startedAtMs)}]`,
      `原文：${segment.sourceText || "（无识别结果）"}`,
      `译文：${segment.translatedText || "（无翻译结果）"}`,
      "",
    );
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function toSrt(segments: TranslationSegment[]): string {
  return segments
    .filter((segment) => segment.sourceText || segment.translatedText)
    .map((segment, index) => {
      const source = segment.sourceText || "（无识别结果）";
      const translation = segment.translatedText || "（无翻译结果）";
      return [
        String(index + 1),
        `${formatSrtTimestamp(segment.startedAtMs)} --> ${formatSrtTimestamp(segment.endedAtMs)}`,
        source,
        translation,
      ].join("\n");
    })
    .join("\n\n")
    .trimEnd()
    + "\n";
}

export function toJson(
  session: TranslationSession,
  segments: TranslationSegment[],
): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      session,
      segments,
    },
    null,
    2,
  );
}

export function renderExport(
  format: ExportFormat,
  session: TranslationSession,
  segments: TranslationSegment[],
): string {
  switch (format) {
    case "markdown":
      return toMarkdown(session, segments);
    case "txt":
      return toPlainText(session, segments);
    case "srt":
      return toSrt(segments);
    case "json":
      return toJson(session, segments);
  }
}

const MIME_TYPES: Record<ExportFormat, string> = {
  markdown: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8",
  srt: "application/x-subrip;charset=utf-8",
  json: "application/json;charset=utf-8",
};

const EXTENSIONS: Record<ExportFormat, string> = {
  markdown: "md",
  txt: "txt",
  srt: "srt",
  json: "json",
};

export function downloadExport(
  format: ExportFormat,
  session: TranslationSession,
  segments: TranslationSegment[],
): void {
  const content = renderExport(format, session, segments);
  const blob = new Blob([content], { type: MIME_TYPES[format] });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const date = new Date(session.startedAt);
  const datePart = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("");
  const timePart = [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");

  anchor.href = url;
  anchor.download = `traductor-${datePart}-${timePart}.${EXTENSIONS[format]}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
