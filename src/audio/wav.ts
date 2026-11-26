const HEADER_SIZE = 44;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(HEADER_SIZE + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * CHANNELS * bytesPerSample, true);
  view.setUint16(32, CHANNELS * bytesPerSample, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = HEADER_SIZE;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, Math.round(value), true);
    offset += bytesPerSample;
  }

  return buffer;
}

export class StreamingResampler {
  private pending = new Float32Array();
  private position = 0;

  constructor(
    private readonly inputRate: number,
    private readonly outputRate: number,
  ) {}

  process(input: Float32Array): Float32Array {
    if (this.inputRate === this.outputRate) {
      return input.slice();
    }

    const combined = new Float32Array(this.pending.length + input.length);
    combined.set(this.pending);
    combined.set(input, this.pending.length);
    const ratio = this.inputRate / this.outputRate;
    const output: number[] = [];

    while (this.position < combined.length - 1) {
      const lowerIndex = Math.floor(this.position);
      const fraction = this.position - lowerIndex;
      const lower = combined[lowerIndex] ?? 0;
      const upper = combined[lowerIndex + 1] ?? lower;
      output.push(lower + (upper - lower) * fraction);
      this.position += ratio;
    }

    const consumed = Math.min(Math.floor(this.position), combined.length);
    this.pending = combined.slice(consumed);
    this.position -= consumed;

    return Float32Array.from(output);
  }
}
