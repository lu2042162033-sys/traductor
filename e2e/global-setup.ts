import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeWav } from "../src/audio/wav";

export default async function globalSetup(): Promise<void> {
  const sampleRate = 16_000;
  const patternSeconds = 1.8;
  const repeats = 10;
  const samples = new Float32Array(
    Math.ceil(sampleRate * patternSeconds * repeats),
  );

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    const offset = Math.floor(repeat * patternSeconds * sampleRate);
    for (let index = 0; index < sampleRate; index += 1) {
      const position = offset + index;
      if (position >= samples.length) {
        break;
      }
      samples[position] =
        Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.2;
    }
  }

  const outputPath = path.resolve("test-results/fake-audio.wav");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    Buffer.from(encodeWav(samples, sampleRate)),
  );
}
