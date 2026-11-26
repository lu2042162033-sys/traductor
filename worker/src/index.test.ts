// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeWav } from "../../src/audio/wav";
import worker from "./index";
import type { Env } from "./types";

function createEnv(): Env {
  const quotaStub = {
    fetch: vi.fn(async () => Response.json({ code: "OK" })),
  };
  return {
    DEEPSEEK_API_KEY: "test-key",
    ALLOWED_ORIGINS:
      "https://*.github.io,http://localhost:5173,http://127.0.0.1:5173",
    DAILY_GLOBAL_LIMIT: "600",
    DAILY_IP_LIMIT: "120",
    MAX_CONCURRENT_PER_IP: "2",
    QUOTA: {
      idFromName: () => "global",
      get: () => quotaStub,
    } as unknown as DurableObjectNamespace,
  };
}

function interpretRequest(): Request {
  const formData = new FormData();
  formData.append(
    "audio",
    new File([encodeWav(new Float32Array(1600), 16_000)], "segment.wav", {
      type: "audio/wav",
    }),
  );
  formData.append("targetLanguage", "en");
  formData.append("context", JSON.stringify([]));
  return new Request("https://worker.example/api/interpret", {
    method: "POST",
    headers: {
      Origin: "https://example.github.io",
      "CF-Connecting-IP": "203.0.113.10",
    },
    body: formData,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("worker /api/interpret", () => {
  it("streams source, translation, and done events", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/tools/asr")) {
          return Response.json({
            request_id: "asr",
            text: "你好",
            duration_ms: 100,
          });
        }
        if (url.endsWith("/chat/completions")) {
          return new Response(
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
              'data: {"choices":[{"delta":{"content":" there"}}]}\n\n' +
              "data: [DONE]\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    );

    const response = await worker.fetch(
      interpretRequest(),
      createEnv(),
    );
    const body = await response.text();

    expect(response.status, body).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(
      "text/event-stream",
    );
    expect(body).toContain('event: source\ndata: {"type":"source","text":"你好"}');
    expect(body).toContain(
      'event: translation\ndata: {"type":"translation","text":"Hello"}',
    );
    expect(body).toContain(
      'event: translation\ndata: {"type":"translation","text":" there"}',
    );
    expect(body).toContain('event: done\ndata: {"type":"done"');
  });

  it("rejects disallowed origins", async () => {
    const request = interpretRequest();
    const headers = new Headers(request.headers);
    headers.set("Origin", "https://malicious.example");
    const response = await worker.fetch(
      new Request(request, { headers }),
      createEnv(),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "ORIGIN_NOT_ALLOWED",
    });
  });

  it("does not call DeepSeek when quota is exhausted", async () => {
    const env = createEnv();
    env.QUOTA = {
      idFromName: () => "global",
      get: () => ({
        fetch: async () =>
          Response.json(
            {
              code: "GLOBAL_QUOTA_EXCEEDED",
              message: "今日公开额度已用完",
            },
            { status: 429 },
          ),
      }),
    } as unknown as DurableObjectNamespace;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await worker.fetch(interpretRequest(), env);

    expect(response.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      code: "GLOBAL_QUOTA_EXCEEDED",
    });
  });

  it("surfaces upstream ASR failures without opening an SSE stream", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("busy", { status: 503 }),
    );

    const response = await worker.fetch(
      interpretRequest(),
      createEnv(),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });
});
