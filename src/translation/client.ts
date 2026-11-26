import type {
  InterpretEvent,
  TargetLanguage,
  TranslationContextItem,
} from "../types";
import { parseSse } from "./sse";

export class TranslationRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "TranslationRequestError";
  }
}

interface InterpretOptions {
  audio: Blob;
  targetLanguage: TargetLanguage;
  context: TranslationContextItem[];
  onSource: (text: string) => void;
  onTranslation: (text: string) => void;
  onLatency: (latencyMs: number | undefined) => void;
}

interface TranslateTextOptions {
  text: string;
  targetLanguage: TargetLanguage;
  context: TranslationContextItem[];
  onTranslation: (text: string) => void;
  onLatency: (latencyMs: number | undefined) => void;
}

const RETRYABLE_CODES = new Set([
  "NETWORK_ERROR",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
  "UPSTREAM_RATE_LIMITED",
]);

function apiUrl(path: string): string {
  const baseUrl = (import.meta.env.VITE_WORKER_URL ?? "").replace(/\/$/, "");
  return `${baseUrl}${path}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function throwHttpError(response: Response): Promise<never> {
  let body: { code?: string; message?: string } = {};
  try {
    body = (await response.json()) as { code?: string; message?: string };
  } catch {
    // The status text is sufficient when the server does not return JSON.
  }

  const code = body.code ?? `HTTP_${response.status}`;
  const retryable =
    response.status === 503 ||
    response.status === 504 ||
    (response.status === 429 && code !== "QUOTA_EXCEEDED");
  throw new TranslationRequestError(
    code,
    body.message ?? response.statusText ?? "请求失败",
    response.status,
    retryable,
  );
}

async function consumeEvents(
  response: Response,
  handlers: {
    onSource?: (text: string) => void;
    onTranslation: (text: string) => void;
    onLatency: (latencyMs: number | undefined) => void;
  },
): Promise<void> {
  if (!response.ok) {
    await throwHttpError(response);
  }
  if (!response.body) {
    throw new TranslationRequestError(
      "EMPTY_RESPONSE",
      "服务端没有返回数据",
    );
  }

  let emitted = false;
  let completed = false;
  for await (const message of parseSse(response.body)) {
    const event = JSON.parse(message.data) as InterpretEvent;

    switch (message.event) {
      case "source":
        if (event.type === "source") {
          emitted = true;
          handlers.onSource?.(event.text);
        }
        break;
      case "translation":
        if (event.type === "translation") {
          emitted = true;
          handlers.onTranslation(event.text);
        }
        break;
      case "done":
        if (event.type === "done") {
          handlers.onLatency(event.latencyMs);
          completed = true;
        }
        break;
      case "error":
        if (event.type === "error") {
          throw new TranslationRequestError(
            event.error.code,
            event.error.message,
            undefined,
            emissionIsRetryable(event.error.code, emitted),
          );
        }
        break;
    }
  }

  if (!completed) {
    throw new TranslationRequestError(
      "STREAM_INTERRUPTED",
      "翻译流意外中断",
      undefined,
      !emitted,
    );
  }
}

function emissionIsRetryable(code: string, emitted: boolean): boolean {
  return !emitted && RETRYABLE_CODES.has(code);
}

export async function interpretSegment(
  options: InterpretOptions,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let emitted = false;
    try {
      const formData = new FormData();
      formData.append(
        "audio",
        options.audio,
        `segment-${Date.now()}.wav`,
      );
      formData.append("targetLanguage", options.targetLanguage);
      formData.append("context", JSON.stringify(options.context.slice(-2)));

      const response = await fetch(apiUrl("/api/interpret"), {
        method: "POST",
        body: formData,
      });
      await consumeEvents(response, {
        onSource: (text) => {
          emitted = true;
          options.onSource(text);
        },
        onTranslation: (text) => {
          emitted = true;
          options.onTranslation(text);
        },
        onLatency: options.onLatency,
      });
      return;
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof TranslationRequestError) ||
        !error.retryable ||
        emitted ||
        attempt === 2
      ) {
        throw error;
      }
      await sleep(400 * 2 ** attempt);
    }
  }

  throw lastError;
}

export async function translateText(
  options: TranslateTextOptions,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let emitted = false;
    try {
      const response = await fetch(apiUrl("/api/translate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: options.text,
          targetLanguage: options.targetLanguage,
          context: options.context.slice(-2),
        }),
      });
      await consumeEvents(response, {
        onTranslation: (text) => {
          emitted = true;
          options.onTranslation(text);
        },
        onLatency: options.onLatency,
      });
      return;
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof TranslationRequestError) ||
        !error.retryable ||
        emitted ||
        attempt === 2
      ) {
        throw error;
      }
      await sleep(400 * 2 ** attempt);
    }
  }

  throw lastError;
}
