/* AudioWorklet globals are supplied by the browser. */
class ConsoleMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.codec = "pcm16_16k";
    this.levelTick = 0;
    this.reset();
    this.port.onmessage = ({ data }) => {
      if (data.codec === "pcm16_16k" || data.codec === "mulaw_8k") {
        this.codec = data.codec;
        this.reset();
      }
    };
  }
  reset() {
    this.phase = 0;
    this.sum = 0;
    this.weight = 0;
    this.offset = 0;
    this.frame = new ArrayBuffer(this.codec === "mulaw_8k" ? 800 : 3200);
  }
  mulaw(sample) {
    const sign = sample < 0 ? 0x80 : 0;
    let magnitude = Math.min(Math.abs(sample), 32635) + 132;
    let exponent = 7;
    for (let mask = 0x4000; exponent > 0 && !(magnitude & mask); mask >>= 1) exponent--;
    return (~(sign | (exponent << 4) | ((magnitude >> (exponent + 3)) & 15))) & 255;
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    const rate = this.codec === "mulaw_8k" ? 8000 : 16000;
    const ratio = sampleRate / rate;
    let power = 0;
    for (const sample of samples) {
      power += sample * sample;
      // Integrate fractional input samples so 44.1 kHz keeps the same clock as 48 kHz.
      let remaining = 1;
      while (remaining > 1e-9) {
        const part = Math.min(remaining, ratio - this.phase);
        this.sum += sample * part;
        this.weight += part;
        this.phase += part;
        remaining -= part;
        if (this.phase >= ratio - 1e-9) {
          const value = Math.max(-1, Math.min(1, this.sum / this.weight));
          const pcm = Math.round(value * (value < 0 ? 32768 : 32767));
          const view = new DataView(this.frame);
          if (rate === 8000) view.setUint8(this.offset++, this.mulaw(pcm));
          else { view.setInt16(this.offset, pcm, true); this.offset += 2; }
          this.sum = this.weight = this.phase = 0;
          if (this.offset === this.frame.byteLength) {
            this.port.postMessage({ frame: this.frame }, [this.frame]);
            this.frame = new ArrayBuffer(rate === 8000 ? 800 : 3200);
            this.offset = 0;
          }
        }
      }
    }
    if (++this.levelTick % 16 === 0) this.port.postMessage({ level: Math.min(1, Math.sqrt(power / samples.length)) });
    return true;
  }
}
registerProcessor("console-mic", ConsoleMicProcessor);
