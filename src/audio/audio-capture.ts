import type { AudioSource, CapturedSegment } from "../types";
import { VoiceSegmenter } from "./segmenter";
import { StreamingResampler } from "./wav";

const TARGET_SAMPLE_RATE = 16_000;

async function openStream(source: AudioSource): Promise<MediaStream> {
  if (source === "microphone") {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  }

  if (!navigator.mediaDevices.getDisplayMedia) {
    throw new Error("当前浏览器不支持捕获标签页音频");
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true,
  });
  for (const track of stream.getVideoTracks()) {
    track.stop();
    stream.removeTrack(track);
  }

  if (stream.getAudioTracks().length === 0) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
    throw new Error("没有捕获到音频，请重新共享并勾选“分享音频”");
  }

  return stream;
}

export class AudioCapture {
  private stream?: MediaStream;
  private context?: AudioContext;
  private sourceNode?: MediaStreamAudioSourceNode;
  private workletNode?: AudioWorkletNode;
  private segmenter?: VoiceSegmenter;
  private resampler?: StreamingResampler;

  constructor(
    private readonly onSegment: (segment: CapturedSegment) => void,
    private readonly onStreamEnded: () => void,
    private readonly onError: (message: string) => void,
  ) {}

  async start(source: AudioSource): Promise<void> {
    await this.stop();
    this.stream = await openStream(source);
    const audioTrack = this.stream.getAudioTracks()[0];
    if (!audioTrack) {
      throw new Error("音频轨道不可用");
    }
    audioTrack.addEventListener("ended", this.onStreamEnded, { once: true });

    this.context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    await this.context.audioWorklet.addModule(
      `${import.meta.env.BASE_URL}audio-worklet.js`,
    );
    await this.context.resume();

    this.segmenter = new VoiceSegmenter(
      { sampleRate: this.context.sampleRate },
      this.onSegment,
    );
    this.resampler = new StreamingResampler(
      this.context.sampleRate,
      TARGET_SAMPLE_RATE,
    );
    this.sourceNode = this.context.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(
      this.context,
      "capture-processor",
    );
    this.workletNode.port.onmessage = (
      event: MessageEvent<Float32Array>,
    ) => {
      try {
        const normalized = this.resampler?.process(event.data);
        if (normalized) {
          this.segmenter?.push(normalized);
        }
      } catch (error) {
        this.onError(
          error instanceof Error ? error.message : "音频处理失败",
        );
      }
    };
    this.sourceNode.connect(this.workletNode);
  }

  async stop(): Promise<void> {
    this.segmenter?.flush();
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.workletNode?.port.close();
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    if (this.context && this.context.state !== "closed") {
      await this.context.close();
    }

    this.stream = undefined;
    this.context = undefined;
    this.sourceNode = undefined;
    this.workletNode = undefined;
    this.segmenter = undefined;
    this.resampler = undefined;
  }
}
