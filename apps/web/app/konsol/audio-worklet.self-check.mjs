// Run: node apps/web/app/konsol/audio-worklet.self-check.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, "../../public/audio-worklet.js"), "utf8");
for (const sampleRate of [48000, 44100]) {
  for (const codec of ["pcm16_16k", "mulaw_8k"]) {
    let Processor;
    const frames = [];
    vm.runInNewContext(source, {
      sampleRate,
      AudioWorkletProcessor: class { port = { postMessage: (data) => { if (data.frame) frames.push(data.frame); } }; },
      registerProcessor: (_, processor) => { Processor = processor; },
    });
    const processor = new Processor();
    processor.port.onmessage({ data: { codec } });
    const samples = new Float32Array(sampleRate).fill(.5);
    for (let offset = 0; offset < samples.length; offset += 128) processor.process([[samples.subarray(offset, offset + 128)]]);
    assert.equal(frames.length, 10, `${sampleRate}/${codec}: one second = ten frames`);
    assert.ok(frames.every((frame) => frame.byteLength === (codec === "mulaw_8k" ? 800 : 3200)));
    assert.equal(processor.mulaw(0), 255);
    assert.equal(processor.mulaw(-32768), 0);
    assert.equal(processor.mulaw(32767), 128);
    if (codec === "pcm16_16k") assert.equal(new DataView(frames[0]).getInt16(0, true), 16384);
  }
}
console.log("Audio worklet self-check passed: 44.1/48 kHz, both codecs, framing, PCM endian, G.711 vectors.");

const audioSource = fs.readFileSync(path.join(__dirname, "../../lib/console-audio.ts"), "utf8");
const compiled = ts.transpileModule(audioSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const timers = [];
const sources = [];
const exportsObject = {};
vm.runInNewContext(compiled, {
  exports: exportsObject,
  window: { setTimeout: (callback) => timers.push(callback) },
  AudioContext: class {
    currentTime = 0; state = "running"; destination = {};
    createBuffer(_, length, rate) {
      const samples = new Float32Array(length);
      return { duration: length / rate, getChannelData: () => samples };
    }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(at) { this.at = at; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    }
    close() { this.state = "closed"; return Promise.resolve(); }
  },
});
const player = new exportsObject.PcmPlayer();
const context = player.context;
const chunk = new ArrayBuffer(4801);
const view = new DataView(chunk);
view.setUint8(0, 1); view.setInt16(1, -16384, true);
let starts = 0;
player.push(chunk, () => starts++);
player.push(chunk, () => starts++);
player.push(new Uint8Array([2]).buffer, () => starts++);
player.push(chunk, () => starts++);
assert.deepEqual(sources.map((source) => source.at), [0, .1, .2], "PCM chunks schedule gaplessly across utterances");
assert.equal(sources[0].buffer.getChannelData(0)[0], -.5);
assert.equal(starts, 1, "only the first chunk reports playback");
context.currentTime = .2;
timers.splice(0).forEach((callback) => callback());
assert.equal(starts, 2, "each utterance reports actual scheduled playback");
player.push(new Uint8Array([1, 0]).buffer, () => starts++);
assert.equal(sources.length, 3, "malformed PCM is ignored");
player.close();
assert.ok(sources.every((source) => source.stopped));
assert.equal(context.state, "closed");
console.log("PCM player self-check passed: framing, endian, gapless scheduling, utterance timing, teardown.");
