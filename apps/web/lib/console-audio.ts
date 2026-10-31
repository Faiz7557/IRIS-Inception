import type { AnswerData } from "./protocol";

export type Codec = AnswerData["codec"];
let mic: { context: AudioContext; stream: MediaStream; node: AudioWorkletNode } | undefined;
let generation = 0;

export function stopMic() {
  generation++;
  if (!mic) return;
  mic.node.disconnect();
  mic.stream.getTracks().forEach((track) => track.stop());
  void mic.context.close();
  mic = undefined;
}

export async function startMic(codec: Codec, onFrame: (frame: ArrayBuffer) => void, onLevel: (level: number) => void = () => {}) {
  stopMic();
  const current = generation;
  const context = new AudioContext();
  let stream: MediaStream | undefined;
  try {
    await context.resume();
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    await context.audioWorklet.addModule("/audio-worklet.js");
    if (current !== generation) { stream.getTracks().forEach((track) => track.stop()); await context.close(); return; }
    const node = new AudioWorkletNode(context, "console-mic");
    node.port.postMessage({ codec });
    node.port.onmessage = ({ data }: MessageEvent<{ frame?: ArrayBuffer; level?: number }>) => {
      if (current !== generation) return;
      if (data.frame) onFrame(data.frame);
      if (data.level !== undefined) onLevel(data.level);
    };
    context.createMediaStreamSource(stream).connect(node);
    // The processor emits silence; connecting it keeps browser audio processing alive.
    node.connect(context.destination);
    mic = { context, stream, node };
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (context.state !== "closed") await context.close();
    throw error;
  }
}

export class PcmPlayer {
  private context = new AudioContext();
  private nextAt = 0;
  private firstChunk = true;
  private sources = new Set<AudioBufferSourceNode>();
  async resume() { await this.context.resume(); }
  /** Wire framing: 0x01 + little-endian PCM16 at 24 kHz; 0x02 ends an utterance. */
  push(frame: ArrayBuffer, onStarted: () => void) {
    const bytes = new DataView(frame);
    if (!bytes.byteLength) return;
    if (bytes.getUint8(0) === 2) { this.firstChunk = true; return; }
    if (bytes.getUint8(0) !== 1 || bytes.byteLength < 3 || (bytes.byteLength - 1) % 2) return;
    const buffer = this.context.createBuffer(1, (bytes.byteLength - 1) / 2, 24000);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < output.length; i++) output[i] = bytes.getInt16(1 + i * 2, true) / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const at = Math.max(this.context.currentTime, this.nextAt);
    source.start(at);
    this.nextAt = at + buffer.duration;
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    if (this.firstChunk) {
      this.firstChunk = false;
      // AudioContext time pauses with autoplay suspension; the callback follows actual playback.
      const timer = () => {
        if (!this.sources.has(source)) return;
        if (this.context.state === "running" && this.context.currentTime >= at) onStarted();
        else window.setTimeout(timer, 10);
      };
      timer();
    }
  }
  close() {
    for (const source of this.sources) source.stop();
    this.sources.clear();
    void this.context.close();
  }
}
