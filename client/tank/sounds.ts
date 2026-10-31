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

  chime() {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, f, 0.6, 0.12, 'triangle', i * 0.12));
  }
}
