/**
 * Minimal Web Audio double for jsdom tests: enough of the API for the synth voices and the AudioManager to run
 * headlessly. Nodes never emit `onended` on their own, so voices stay live until `dispose()`/`stopAll()` — tests that
 * need natural voice cleanup count *play attempts* instead of relying on the registry emptying.
 */
export class FakeParam {
  value = 0;
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}
export class FakeNode { connect(_n: unknown) { return _n; } disconnect() {} }
export class FakeGain extends FakeNode { gain = new FakeParam(); }
export class FakeFilter extends FakeNode { type = 'lowpass'; frequency = new FakeParam(); Q = new FakeParam(); }
export class FakeOsc extends FakeNode { type = 'sine'; frequency = new FakeParam(); detune = new FakeParam(); onended: (() => void) | null = null; start() {} stop() {} }
export class FakeSource extends FakeNode { buffer: unknown = null; loop = false; playbackRate = new FakeParam(); onended: (() => void) | null = null; start() {} stop() {} }
export class FakeBuffer { constructor(public length = 8, public sampleRate = 44100) {} getChannelData() { return new Float32Array(this.length); } }
export class FakeCtx {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0; sampleRate = 44100; destination = new FakeNode();
  createGain() { return new FakeGain(); }
  createOscillator() { return new FakeOsc(); }
  createBiquadFilter() { return new FakeFilter(); }
  createBufferSource() { return new FakeSource(); }
  createBuffer(_c: number, len: number, rate: number) { return new FakeBuffer(len, rate); }
  decodeAudioData(_d: ArrayBuffer) { return Promise.resolve(new FakeBuffer(64)); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
