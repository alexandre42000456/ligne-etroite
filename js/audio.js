// Sons synthétisés (Web Audio) : moteur diesel, portes, sonnette, clignotant, klaxon, chocs
export class Sound {
  constructor() {
    this.ctx = null;
    this.vol = 0.8;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* facultatif */ }
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.vol;
    this.master.connect(c.destination);
    // bruit blanc réutilisable
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // moteur
    this.eng = c.createGain(); this.eng.gain.value = 0;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 300; this.lp.Q.value = 2;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'square';
    const g2 = c.createGain(); g2.gain.value = 0.35;
    this.o1.connect(this.lp); this.o2.connect(g2); g2.connect(this.lp);
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    this.bp = c.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.frequency.value = 900; this.bp.Q.value = 1.2;
    this.ng = c.createGain(); this.ng.gain.value = 0;
    n.connect(this.bp); this.bp.connect(this.ng); this.ng.connect(this.eng);
    this.lp.connect(this.eng); this.eng.connect(this.master);
    this.o1.start(); this.o2.start(); n.start();
    // bip de recul
    this.beep = c.createOscillator(); this.beep.type = 'square'; this.beep.frequency.value = 1150;
    this.beepG = c.createGain(); this.beepG.gain.value = 0;
    this.beep.connect(this.beepG); this.beepG.connect(this.master); this.beep.start();
    // klaxon
    this.hornG = c.createGain(); this.hornG.gain.value = 0;
    const hl = c.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 1600;
    for (const f of [311, 392]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(hl); o.start(); }
    hl.connect(this.hornG); this.hornG.connect(this.master);
    this.t = 0;
  }

  setVolume(v) {
    this.vol = v;
    if (this.master) this.master.gain.value = v;
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  update(dt, bus, on) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.t += dt;
    const rpm = bus.rpm, thr = bus.throttle;
    const f = rpm / 20;
    this.o1.frequency.setTargetAtTime(f, now, 0.05);
    this.o2.frequency.setTargetAtTime(f / 2, now, 0.05);
    this.lp.frequency.setTargetAtTime(160 + thr * 520 + rpm * 0.18, now, 0.08);
    this.eng.gain.setTargetAtTime(on ? 0.11 + thr * 0.16 : 0, now, 0.1);
    this.ng.gain.setTargetAtTime(on ? 0.02 + thr * 0.05 * (rpm / 2000) : 0, now, 0.1);
    this.bp.frequency.setTargetAtTime(500 + rpm * 0.9, now, 0.1);
    const rev = on && bus.gear === 'R' && (this.t % 0.9) < 0.45;
    this.beepG.gain.setTargetAtTime(rev ? 0.06 : 0, now, 0.01);
    // clignotant
    if (bus.blink && on) {
      const ph = bus.blinkT % 0.7 < 0.38;
      if (ph !== this.lastBlink) this.tick(ph ? 1800 : 1300);
      this.lastBlink = ph;
    }
    // détente d'air à l'arrêt
    if (on && this.lastV > 0.8 && bus.v === 0) this.psst(0.25, 0.5);
    this.lastV = Math.abs(bus.v);
  }

  burst(dur, freq, q, gain, type = 'lowpass') {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(now, Math.random()); s.stop(now + dur + 0.05);
  }
  tone(freq, dur, gain, type = 'sine', delay = 0, slide = 0) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, now);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + dur + 0.05);
  }
  psst(gain = 0.3, dur = 0.7) { this.burst(dur, 3500, 0.6, gain, 'highpass'); }
  tick(f = 1600) { this.tone(f, 0.03, 0.08, 'square'); }
  door(open) {
    this.psst(0.28, 0.6);
    if (!open) { this.tone(880, 0.25, 0.12, 'sine', 0.05); this.tone(660, 0.35, 0.12, 'sine', 0.3); }
  }
  bell() { this.tone(1568, 0.6, 0.18, 'sine'); this.tone(3136, 0.4, 0.05, 'sine'); }
  crash(k) { this.burst(0.35, 900, 0.8, 0.5 * k); this.tone(70, 0.3, 0.6 * k, 'sine', 0, 0.5); }
  curb() { this.tone(85, 0.18, 0.5, 'sine', 0, 0.6); this.burst(0.12, 400, 1, 0.12); }
  horn(on) { if (this.hornG) this.hornG.gain.setTargetAtTime(on ? 0.12 : 0, this.ctx.currentTime, 0.02); }
  ui() { this.tone(1200, 0.06, 0.06, 'triangle'); }
  error() { this.tone(220, 0.18, 0.12, 'square'); }
  chime() { this.tone(988, 0.2, 0.1); this.tone(1319, 0.35, 0.1, 'sine', 0.15); }
}
