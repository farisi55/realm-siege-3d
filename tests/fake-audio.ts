/**
 * Minimal Web Audio double for jsdom tests: enough of the API for the synth voices and the AudioManager to run
 * headlessly. Nodes never emit `onended` on their own (`FakeSource.fireEnded()` does it on demand), so voices stay
 * live until `dispose()`/`stopAll()` — tests that need natural voice cleanup count *play attempts* or fire the event
 * themselves. Every node records its outgoing connections (`out`) and the context keeps the arrays `gains`,
 * `sources`, `filters` and `compressors` of the nodes it created, so tests can assert the built graph.
 */
export class FakeParam {
  value = 0;
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}
export class FakeNode { out: unknown[] = []; connect(n: unknown) { this.out.push(n); return n; } disconnect() {} }
export class FakeGain extends FakeNode { gain = new FakeParam(); }
export class FakePanner extends FakeNode { pan = new FakeParam(); }
export class FakeFilter extends FakeNode { type = 'lowpass'; frequency = new FakeParam(); Q = new FakeParam(); gain = new FakeParam(); }
export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam(); attack = new FakeParam(); release = new FakeParam();
}
export class FakeOsc extends FakeNode { type = 'sine'; frequency = new FakeParam(); detune = new FakeParam(); onended: (() => void) | null = null; start() {} stop() {} }
export class FakeSource extends FakeNode {
  buffer: unknown = null; loop = false; playbackRate = new FakeParam(); onended: (() => void) | null = null;
  start() {} stop() {}
  /** Simulate the source reaching its end (what a real browser does on `onended`). */
  fireEnded() { this.onended?.(); }
}
export class FakeBuffer { constructor(public length = 8, public sampleRate = 44100) {} getChannelData() { return new Float32Array(this.length); } }
export class FakeCtx {
  /** The most recently built context (tests reach the graph through it). */
  static last: FakeCtx | null = null;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0; sampleRate = 44100; destination = new FakeNode();
  gains: FakeGain[] = []; sources: FakeSource[] = []; filters: FakeFilter[] = []; compressors: FakeCompressor[] = [];
  constructor() { FakeCtx.last = this; }
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createOscillator() { return new FakeOsc(); }
  createBiquadFilter() { const f = new FakeFilter(); this.filters.push(f); return f; }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s; }
  createStereoPanner() { return new FakePanner(); }
  createDynamicsCompressor() { const c = new FakeCompressor(); this.compressors.push(c); return c; }
  createBuffer(_c: number, len: number, rate: number) { return new FakeBuffer(len, rate); }
  decodeAudioData(_d: ArrayBuffer) { return Promise.resolve(new FakeBuffer(64)); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
