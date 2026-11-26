import { describe, expect, it } from "vitest";
import { parseSse } from "./sse";

describe("parseSse", () => {
  it("parses events split across arbitrary chunks", async () => {
    const encoded = new TextEncoder().encode(
      'event: source\ndata: {"type":"source","text":"你好"}\n\n' +
        'event: translation\ndata: {"type":"translation","text":"Hello"}\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 9));
        controller.enqueue(encoded.slice(9, 31));
        controller.enqueue(encoded.slice(31));
        controller.close();
      },
    });

    const events = [];
    for await (const event of parseSse(stream)) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        event: "source",
        data: '{"type":"source","text":"你好"}',
      },
      {
        event: "translation",
        data: '{"type":"translation","text":"Hello"}',
      },
    ]);
  });
});
