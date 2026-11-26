import {
  buildTranslationMessages,
  isTargetLanguage,
  normalizeContext,
  parseInteger,
  parseWavDurationSeconds,
} from "./core";
import { QuotaStore } from "./quota";
import type {
  DeepSeekAsrResponse,
  Env,
  TargetLanguage,
  TranslationContextItem,
} from "./types";

export { QuotaStore };

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 10;
const MAX_TEXT_LENGTH = 5000;

const encoder = new TextEncoder();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: cors.allowed ? 204 : 403,
        headers: cors.headers,
      });
    }
    if (!cors.allowed) {
      return jsonError(
        "ORIGIN_NOT_ALLOWED",
        "当前来源不允许调用翻译服务",
        403,
        cors.headers,
      );
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/interpret" && request.method === "POST") {
        return await handleInterpret(request, env, cors.headers);
      }
      if (url.pathname === "/api/translate" && request.method === "POST") {
        return await handleTranslate(request, env, cors.headers);
      }
      return jsonError("NOT_FOUND", "接口不存在", 404, cors.headers);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "服务端处理失败";
      return jsonError("INTERNAL_ERROR", message, 500, cors.headers);
    }
  },
};

async function handleInterpret(
  request: Request,
  env: Env,
  headers: HeadersInit,
): Promise<Response> {
  if (!env.DEEPSEEK_API_KEY) {
    return jsonError(
      "MISSING_API_KEY",
      "Worker 尚未配置 DEEPSEEK_API_KEY",
      503,
      headers,
    );
  }

  const formData = await request.formData();
  const audio = formData.get("audio");
  const targetLanguage = formData.get("targetLanguage");
  const rawContext = formData.get("context");

  if (!(audio instanceof File)) {
    return jsonError("MISSING_AUDIO", "缺少音频文件", 400, headers);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return jsonError(
      "AUDIO_TOO_LARGE",
      "音频片段不能超过 2 MiB",
      413,
      headers,
    );
  }
  if (!isTargetLanguage(targetLanguage)) {
    return jsonError(
      "INVALID_TARGET_LANGUAGE",
      "目标语言必须是 zh、en 或 es",
      400,
      headers,
    );
  }

  const audioBuffer = await audio.arrayBuffer();
  let durationSeconds: number;
  try {
    durationSeconds = parseWavDurationSeconds(audioBuffer);
  } catch (error) {
    return jsonError(
      "INVALID_AUDIO",
      error instanceof Error ? error.message : "音频格式无效",
      400,
      headers,
    );
  }
  if (durationSeconds > MAX_AUDIO_SECONDS + 0.1) {
    return jsonError(
      "AUDIO_TOO_LONG",
      "单个音频片段不能超过 10 秒",
      400,
      headers,
    );
  }

  const context = parseContext(rawContext);
  const ip = getClientIp(request);
  const release = await claimQuota(request, env, ip);
  if (release instanceof Response) {
    return withHeaders(release, headers);
  }

  let sourceText: string;
  try {
    sourceText = await transcribe(audioBuffer, env.DEEPSEEK_API_KEY);
  } catch (error) {
    await release();
    return jsonError(
      error instanceof WorkerRequestError ? error.code : "ASR_FAILED",
      error instanceof Error ? error.message : "语音识别失败",
      error instanceof WorkerRequestError ? error.status : 502,
      headers,
    );
  }

  const startedAt = performance.now();
  let released = false;
  const releaseOnce = async () => {
    if (!released) {
      released = true;
      await release();
    }
  };

  return sseResponse(
    headers,
    async (send) => {
      if (!sourceText.trim()) {
        send("error", {
          code: "NO_SPEECH",
          message: "没有识别到可翻译的语音",
        });
        return;
      }

      send("source", { type: "source", text: sourceText });
      await streamTranslation({
        sourceText,
        targetLanguage,
        context,
        apiKey: env.DEEPSEEK_API_KEY,
        startedAt,
        send,
      });
    },
    releaseOnce,
  );
}

async function handleTranslate(
  request: Request,
  env: Env,
  headers: HeadersInit,
): Promise<Response> {
  if (!env.DEEPSEEK_API_KEY) {
    return jsonError(
      "MISSING_API_KEY",
      "Worker 尚未配置 DEEPSEEK_API_KEY",
      503,
      headers,
    );
  }

  const body = (await request.json()) as {
    text?: unknown;
    targetLanguage?: unknown;
    context?: unknown;
  };
  if (typeof body.text !== "string" || !body.text.trim()) {
    return jsonError("MISSING_TEXT", "缺少待翻译文本", 400, headers);
  }
  if (body.text.length > MAX_TEXT_LENGTH) {
    return jsonError(
      "TEXT_TOO_LONG",
      `待翻译文本不能超过 ${MAX_TEXT_LENGTH} 个字符`,
      400,
      headers,
    );
  }
  if (!isTargetLanguage(body.targetLanguage)) {
    return jsonError(
      "INVALID_TARGET_LANGUAGE",
      "目标语言必须是 zh、en 或 es",
      400,
      headers,
    );
  }

  const targetLanguage = body.targetLanguage;
  const context = normalizeContext(body.context);
  const ip = getClientIp(request);
  const release = await claimQuota(request, env, ip);
  if (release instanceof Response) {
    return withHeaders(release, headers);
  }

  const startedAt = performance.now();
  let released = false;
  const releaseOnce = async () => {
    if (!released) {
      released = true;
      await release();
    }
  };

  return sseResponse(
    headers,
    async (send) => {
      await streamTranslation({
        sourceText: body.text as string,
        targetLanguage,
        context,
        apiKey: env.DEEPSEEK_API_KEY,
        startedAt,
        send,
      });
    },
    releaseOnce,
  );
}

function parseContext(value: FormDataEntryValue | null): TranslationContextItem[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    return normalizeContext(JSON.parse(value));
  } catch {
    return [];
  }
}

async function transcribe(
  audioBuffer: ArrayBuffer,
  apiKey: string,
): Promise<string> {
  const formData = new FormData();
  formData.append(
    "file",
    new File([audioBuffer], "segment.wav", { type: "audio/wav" }),
  );
  const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/tools/asr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    throw upstreamError(response.status);
  }

  const data = (await response.json()) as DeepSeekAsrResponse;
  if (typeof data.text !== "string") {
    throw new WorkerRequestError(
      "INVALID_ASR_RESPONSE",
      "DeepSeek ASR 返回格式异常",
      502,
    );
  }
  return data.text;
}

interface StreamTranslationOptions {
  sourceText: string;
  targetLanguage: TargetLanguage;
  context: TranslationContextItem[];
  apiKey: string;
  startedAt: number;
  send: (event: string, data: unknown) => void;
}

async function streamTranslation(
  options: StreamTranslationOptions,
): Promise<void> {
  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-flash",
        messages: buildTranslationMessages(
          options.sourceText,
          options.targetLanguage,
          options.context,
        ),
        stream: true,
        temperature: 0,
        max_tokens: 2048,
        thinking: { type: "disabled" },
      }),
    });

    if (!response.ok || !response.body) {
      throw upstreamError(response.status);
    }

    await forwardTranslationStream(response.body, (delta) => {
      options.send("translation", { type: "translation", text: delta });
    });
    options.send("done", {
      type: "done",
      latencyMs: Math.round(performance.now() - options.startedAt),
    });
  } catch (error) {
    options.send("error", {
      code:
        error instanceof WorkerRequestError
          ? error.code
          : "TRANSLATION_STREAM_FAILED",
      message:
        error instanceof Error ? error.message : "翻译流处理失败",
    });
  }
}

async function forwardTranslationStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      processDeepSeekLine(line, onDelta);
    }

    if (done) {
      if (buffer) {
        processDeepSeekLine(buffer, onDelta);
      }
      return;
    }
  }
}

function processDeepSeekLine(
  line: string,
  onDelta: (delta: string) => void,
): void {
  const normalized = line.trim();
  if (!normalized.startsWith("data:")) {
    return;
  }
  const payload = normalized.slice(5).trim();
  if (!payload || payload === "[DONE]") {
    return;
  }

  const data = JSON.parse(payload) as {
    choices?: Array<{ delta?: { content?: string } }>;
  };
  const delta = data.choices?.[0]?.delta?.content;
  if (delta) {
    onDelta(delta);
  }
}

function sseResponse(
  baseHeaders: HeadersInit,
  run: (
    send: (event: string, data: unknown) => void,
  ) => Promise<void>,
  onFinally: () => Promise<void>,
): Response {
  let closed = false;
  let finalized = false;
  const finalize = async () => {
    if (!finalized) {
      finalized = true;
      await onFinally();
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) {
          return;
        }
        controller.enqueue(
          encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        );
      };

      try {
        await run(send);
      } catch (error) {
        send("error", {
          code: "STREAM_FAILED",
          message:
            error instanceof Error ? error.message : "翻译流处理失败",
        });
      } finally {
        await finalize();
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    async cancel() {
      closed = true;
      await finalize();
    },
  });

  const headers = new Headers(baseHeaders);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Accel-Buffering", "no");
  return new Response(stream, { status: 200, headers });
}

async function claimQuota(
  request: Request,
  env: Env,
  ip: string,
): Promise<(() => Promise<void>) | Response> {
  const id = env.QUOTA.idFromName("global");
  const stub = env.QUOTA.get(id);
  const claim = {
    ip,
    dailyGlobalLimit: parseInteger(env.DAILY_GLOBAL_LIMIT, 600),
    dailyIpLimit: parseInteger(env.DAILY_IP_LIMIT, 120),
    maxConcurrentPerIp: parseInteger(env.MAX_CONCURRENT_PER_IP, 2),
  };

  const response = await stub.fetch("https://quota.internal/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(claim),
  });

  if (!response.ok) {
    const data = (await response.json()) as {
      code?: string;
      message?: string;
    };
    return jsonError(
      data.code ?? "QUOTA_EXCEEDED",
      data.message ?? "翻译额度已用完",
      response.status,
    );
  }

  return async () => {
    try {
      await stub.fetch("https://quota.internal/release", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": request.headers.get("CF-Connecting-IP") ?? "",
        },
        body: JSON.stringify({ ip }),
      });
    } catch {
      // Quota cleanup is best-effort; the next successful release repairs it.
    }
  };
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function corsHeaders(
  origin: string,
  allowedOrigins: string,
): { allowed: boolean; headers: Headers } {
  const patterns = allowedOrigins
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = Boolean(origin) && patterns.some((pattern) => {
    if (pattern === origin) {
      return true;
    }
    if (pattern.startsWith("https://*.")) {
      const suffix = pattern.slice("https://*".length);
      return origin.startsWith("https://") && origin.endsWith(suffix);
    }
    return false;
  });

  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return { allowed, headers };
}

function jsonError(
  code: string,
  message: string,
  status: number,
  headers?: HeadersInit,
): Response {
  const merged = new Headers(headers);
  merged.set("Content-Type", "application/json; charset=utf-8");
  merged.set("Cache-Control", "no-store");
  return Response.json({ code, message }, { status, headers: merged });
}

function withHeaders(response: Response, headers: HeadersInit): Response {
  const merged = new Headers(headers);
  response.headers.forEach((value, key) => merged.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}

function upstreamError(status: number): WorkerRequestError {
  if (status === 429) {
    return new WorkerRequestError(
      "UPSTREAM_RATE_LIMITED",
      "DeepSeek 当前请求过多，请稍后重试",
      503,
    );
  }
  if (status === 503) {
    return new WorkerRequestError(
      "UPSTREAM_UNAVAILABLE",
      "DeepSeek 服务繁忙，请稍后重试",
      503,
    );
  }
  if (status === 504) {
    return new WorkerRequestError(
      "UPSTREAM_TIMEOUT",
      "DeepSeek 处理超时，请重试",
      504,
    );
  }
  return new WorkerRequestError(
    "UPSTREAM_BAD_REQUEST",
    `DeepSeek 请求失败（HTTP ${status}）`,
    502,
  );
}

class WorkerRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "WorkerRequestError";
  }
}
