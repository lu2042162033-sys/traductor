export interface SseMessage {
  event: string;
  data: string;
}

export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary).replaceAll("\r\n", "\n");
      buffer = buffer.slice(boundary + 2);
      const message = parseBlock(block);
      if (message) {
        yield message;
      }
      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      const message = parseBlock(buffer.replaceAll("\r\n", "\n"));
      if (message) {
        yield message;
      }
      return;
    }
  }
}

function parseBlock(block: string): SseMessage | undefined {
  if (!block.trim()) {
    return undefined;
  }

  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }

  return data.length > 0 ? { event, data: data.join("\n") } : undefined;
}
