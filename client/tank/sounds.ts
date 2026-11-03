/**
 * Soft, optional tank sounds made on the fly (no sound files): bubbly bloops from the aerators,
 * a plop when food lands in the water, and a little chime when an egg hatches. Off until turned on.
 */
export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled: boolean;

  constructor() {
    let saved = false;
    try {
      saved = localStorage.getItem('doodlearium.sound') === 'on';
    } catch {}
    this.enabled = saved;
    // Browsers only allow sound after a click or key press, so wake up on the first one.
    const wake = () => {
      if (this.enabled) this.start();
    };
    addEventListener('pointerdown', wake);
    addEventListener('keydown', wake);
  }

  toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem('doodlearium.sound', this.enabled ? 'on' : 'off');
    } catch {}
    if (this.enabled) this.start();
    else void this.ctx?.suspend();
  }

  private start() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  private get ready() {
    return this.enabled && this.ctx?.state === 'running' && this.master;
  }

  /** A tone sliding from one pitch to another, fading out. */
  private tone(from: number, to: number, seconds: number, volume: number, type: OscillatorType = 'sine', delay = 0) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + seconds);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + seconds + 0.05);
  }

  bubble() {
    const base = 300 + Math.random() * 500;
    this.tone(base, base * 2.2, 0.09, 0.12);
  }

  plop() {
    this.tone(500, 120, 0.18, 0.3);
    this.tone(900, 300, 0.08, 0.08, 'sine', 0.03);
  }

  /** Off to another world: a rising whoosh, then a sparkle. */
  whoosh() {
    this.tone(120, 900, 1.2, 0.18, 'sawtooth');
    this.tone(180, 1400, 1.2, 0.08, 'triangle', 0.1);
    [1319, 1568, 2093].forEach((f, i) => this.tone(f, f, 0.4, 0.08, 'triangle', 1.1 + i * 0.1));
  }

  chime() {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, f, 0.6, 0.12, 'triangle', i * 0.12));
  }

  /** An explorer's show begins: ta-da! */
  fanfare() {
    [523, 659, 784].forEach((f, i) => this.tone(f, f, 0.18, 0.12, 'square', i * 0.14));
    this.tone(1047, 1047, 0.7, 0.14, 'square', 0.42);
  }

  /** One step of a parade's tune (n counts the steps). */
  march(n: number) {
    const tune = [392, 392, 523, 523, 659, 587, 523, 0, 440, 440, 587, 587, 698, 659, 587, 0];
    const f = tune[n % tune.length];
    if (f) this.tone(f, f, 0.22, 0.07, 'square');
    if (n % 2 === 0) this.tone(140, 60, 0.12, 0.2);
  }

  /** One beat of a dance party: a thump, a tick, and a bouncy bass line. */
  beat(n: number) {
    this.tone(160, 45, 0.18, 0.35);
    this.tone(3000, 3000, 0.03, 0.03, 'square', 0.25);
    const bass = [110, 110, 165, 147][Math.floor(n / 2) % 4];
    this.tone(bass, bass, 0.2, 0.12, 'sawtooth', 0.25);
  }

  /** Treasure! A jingle of coins. */
  coins() {
    for (let i = 0; i < 5; i++) {
      const f = 1800 + Math.random() * 1600;
      this.tone(f, f, 0.12, 0.05, 'triangle', i * 0.05);
    }
  }
}
