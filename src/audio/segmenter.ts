import type { CapturedSegment } from "../types";
import { encodeWav } from "./wav";

export interface SegmenterOptions {
  sampleRate?: number;
  silenceMs?: number;
  minSpeechMs?: number;
  maxSegmentMs?: number;
  preRollMs?: number;
  frameMs?: number;
  threshold?: number;
}

interface ResolvedOptions {
  sampleRate: number;
  silenceMs: number;
  minSpeechMs: number;
  maxSegmentMs: number;
  preRollMs: number;
  frameMs: number;
  threshold: number;
}

export class VoiceSegmenter {
  private readonly options: ResolvedOptions;
  private readonly frameSize: number;
  private readonly maxPreRollFrames: number;
  private pendingSamples = new Float32Array();
  private preRollFrames: Float32Array[] = [];
  private segmentFrames: Float32Array[] = [];
  private frameIndex = 0;
  private segmentStartFrame = 0;
  private silenceFrames = 0;
  private speaking = false;

  constructor(
    options: SegmenterOptions = {},
    private readonly onSegment: (segment: CapturedSegment) => void,
  ) {
    this.options = {
      sampleRate: options.sampleRate ?? 16_000,
      silenceMs: options.silenceMs ?? 500,
      minSpeechMs: options.minSpeechMs ?? 1000,
      maxSegmentMs: options.maxSegmentMs ?? 10_000,
      preRollMs: options.preRollMs ?? 250,
      frameMs: options.frameMs ?? 20,
      threshold: options.threshold ?? 0.012,
    };
    this.frameSize = Math.round(
      (this.options.sampleRate * this.options.frameMs) / 1000,
    );
    this.maxPreRollFrames = Math.ceil(
      this.options.preRollMs / this.options.frameMs,
    );
  }

  push(samples: Float32Array): void {
    if (samples.length === 0) {
      return;
    }

    const combined = new Float32Array(
      this.pendingSamples.length + samples.length,
    );
    combined.set(this.pendingSamples);
    combined.set(samples, this.pendingSamples.length);

    let offset = 0;
    while (offset + this.frameSize <= combined.length) {
      this.processFrame(combined.slice(offset, offset + this.frameSize));
      offset += this.frameSize;
    }

    this.pendingSamples = combined.slice(offset);
  }

  flush(): void {
    if (this.speaking) {
      this.finishSegment();
    }
    this.pendingSamples = new Float32Array();
  }

  private processFrame(frame: Float32Array): void {
    this.frameIndex += 1;
    const isVoice = this.calculateRms(frame) >= this.options.threshold;

    this.preRollFrames.push(frame);
    if (this.preRollFrames.length > this.maxPreRollFrames) {
      this.preRollFrames.shift();
    }

    if (!this.speaking) {
      if (isVoice) {
        this.speaking = true;
        this.segmentFrames = [...this.preRollFrames];
        this.segmentStartFrame = Math.max(
          0,
          this.frameIndex - this.segmentFrames.length,
        );
        this.silenceFrames = 0;
      }
      return;
    }

    if (this.segmentFrames.at(-1) !== frame) {
      this.segmentFrames.push(frame);
    }
    this.silenceFrames = isVoice ? 0 : this.silenceFrames + 1;

    const durationMs = this.currentDurationMs();
    const reachedMax = durationMs >= this.options.maxSegmentMs;
    const reachedSilence =
      this.silenceFrames * this.options.frameMs >= this.options.silenceMs;

    if (reachedMax || (reachedSilence && durationMs >= this.options.minSpeechMs)) {
      this.finishSegment();
    }
  }

  private currentDurationMs(): number {
    return (
      (this.frameIndex - this.segmentStartFrame) *
      this.options.frameMs
    );
  }

  private finishSegment(): void {
    if (this.segmentFrames.length === 0) {
      this.resetState();
      return;
    }

    const sampleCount = this.segmentFrames.reduce(
      (total, frame) => total + frame.length,
      0,
    );
    const samples = new Float32Array(sampleCount);
    let offset = 0;
    for (const frame of this.segmentFrames) {
      samples.set(frame, offset);
      offset += frame.length;
    }

    const startedAtMs = Math.round(
      (this.segmentStartFrame * 1000) / (1000 / this.options.frameMs),
    );
    const endedAtMs = Math.round(
      (this.frameIndex * 1000) / (1000 / this.options.frameMs),
    );
    const durationMs = Math.max(0, endedAtMs - startedAtMs);
    const wav = encodeWav(samples, this.options.sampleRate);

    this.onSegment({
      blob: new Blob([wav], { type: "audio/wav" }),
      startedAtMs,
      endedAtMs,
      durationMs,
    });
    this.resetState();
  }

  private resetState(): void {
    this.speaking = false;
    this.segmentFrames = [];
    this.preRollFrames = [];
    this.silenceFrames = 0;
  }

  private calculateRms(frame: Float32Array): number {
    let sum = 0;
    for (const sample of frame) {
      sum += sample * sample;
    }
    return Math.sqrt(sum / frame.length);
  }
}
