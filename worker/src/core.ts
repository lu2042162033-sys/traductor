import type { TargetLanguage, TranslationContextItem } from "./types";

const TARGET_LABELS: Record<TargetLanguage, string> = {
  zh: "Simplified Chinese",
  en: "English",
  es: "Spanish",
};

export function isTargetLanguage(value: unknown): value is TargetLanguage {
  return value === "zh" || value === "en" || value === "es";
}

export function normalizeContext(value: unknown): TranslationContextItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(-2)
    .filter(
      (item): item is TranslationContextItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as TranslationContextItem).sourceText === "string" &&
        typeof (item as TranslationContextItem).translatedText === "string",
    )
    .map((item) => ({
      sourceText: item.sourceText.slice(0, 4000),
      translatedText: item.translatedText.slice(0, 4000),
    }));
}

export function buildTranslationMessages(
  text: string,
  targetLanguage: TargetLanguage,
  context: TranslationContextItem[],
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "You are a professional real-time interpreter.",
        `Translate the supplied source text into ${TARGET_LABELS[targetLanguage]}.`,
        "Output only the translation.",
        "Do not explain, summarize, annotate, or use Markdown.",
        "Preserve names, numbers, units, technical terms, and factual meaning.",
        "Use the context only to resolve references and maintain terminology.",
        "If the source is already in the target language, return it unchanged except for punctuation normalization.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({ context: context.slice(-2), text }),
    },
  ];
}

export function parseWavDurationSeconds(buffer: ArrayBuffer): number {
  if (buffer.byteLength < 44) {
    throw new Error("WAV 文件不完整");
  }

  const view = new DataView(buffer);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(
      ...Array.from(
        { length },
        (_, index) => view.getUint8(offset + index),
      ),
    );

  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error("文件不是有效的 WAV 音频");
  }

  let offset = 12;
  let sampleRate = 0;
  let blockAlign = 0;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = ascii(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;

    if (chunkId === "fmt " && chunkSize >= 16) {
      sampleRate = view.getUint32(chunkStart + 4, true);
      blockAlign = view.getUint16(chunkStart + 12, true);
    } else if (chunkId === "data") {
      dataSize = Math.min(chunkSize, view.byteLength - chunkStart);
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (sampleRate <= 0 || blockAlign <= 0 || dataSize <= 0) {
    throw new Error("WAV 文件缺少有效的音频数据");
  }

  return dataSize / (sampleRate * blockAlign);
}

export function parseInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
