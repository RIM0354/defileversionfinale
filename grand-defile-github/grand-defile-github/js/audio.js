// Audio interactif 100 % généré en direct (Web Audio API) : grosse caisse, claps, hi-hats,
// basse, nappes d'accords, arpèges. L'intensité du défilé (nombre de mannequins sur le podium) pilote le tempo (100 -> 134 BPM),
// couches et accords. Effets sonores : déclencheur d'appareil photo + flash, applaudissements.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const PROGS = [
  // calme : La mineur – Fa – Do – Sol
  [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
  // enlevé : Fa maj7 – Sol – La mineur 7 – Mi mineur
  [[53, 57, 60, 64], [55, 59, 62, 66], [57, 60, 64, 67], [52, 55, 59, 62]],
  // iconique : Do – Sol/Si – La mineur – Fa maj7 (hymne)
  [[48, 55, 60, 64], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 64]],
];
const ROOTS = [[33, 29, 24, 31], [29, 31, 33, 28], [36, 31, 33, 29]];

export class AudioEngine {
  constructor() {
    this.ctx = null; this.started = false; this.volume = 0.7; this.score = 0; this.bpm = 100;
    this.step = 0; this.bar = 0; this.nextTime = 0; this.lastKick = -10; this.kickTimes = [];
    this.startTime = 0; this.muted = false;
  }

  start() {
    if (this.started) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master.connect(this.comp); this.comp.connect(ctx.destination);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.9; this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 1.0; this.sfxBus.connect(this.master);
    // réverbération (réponse impulsionnelle synthétique)
    const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.32; this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    // bruit blanc partagé
    const nl = ctx.sampleRate * 1.0; this.noiseBuf = ctx.createBuffer(1, nl, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0); for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
    // ambiance de salle : bruit filtré (public)
    this.crowd = ctx.createBufferSource(); this.crowd.buffer = this.noiseBuf; this.crowd.loop = true;
    const cf = ctx.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 700; cf.Q.value = 0.4;
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0.02;
    this.crowd.connect(cf); cf.connect(this.crowdGain); this.crowdGain.connect(this.master); this.crowd.start();
    this.started = true; this.nextTime = ctx.currentTime + 0.1; this.startTime = this.nextTime;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05); }
  setMuted(m) { this.muted = m; this.setVolume(this.volume); }

  // intensité 0..10 -> tempo 100..134 BPM et nombre de couches (ici : nombre de mannequins sur le podium)
  setIntensity(score) {
    this.score = score;
    this.bpm = 100 + 34 * Math.min(1, Math.max(0, score / 10));
    if (this.crowdGain) this.crowdGain.gain.setTargetAtTime(0.012 + 0.035 * (score / 10), this.ctx.currentTime, 0.5);
  }

  // ------------------------------------------------------------- séquenceur
  schedule() {
    const ctx = this.ctx; if (!ctx) return;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += 60 / this.bpm / 4;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  layer() { const s = this.score; return { clap: s >= 2, bass: s >= 3, pad: s >= 4.2, arp: s >= 6, open: s >= 7.5, lead: s >= 8.8 }; }

  playStep(step, t) {
    const L = this.layer();
    const prog = this.score < 5.5 ? 0 : this.score < 8.3 ? 1 : 2;
    const chordIx = this.bar % 4, chord = PROGS[prog][chordIx], root = ROOTS[prog][chordIx];
    // grosse caisse : sur chaque temps (4 on the floor)
    if (step % 4 === 0) { this.kick(t); this.kickTimes.push(t); if (this.kickTimes.length > 16) this.kickTimes.shift(); }
    if (L.clap && (step === 4 || step === 12)) this.clap(t);
    // hi-hats : croches, plus denses quand l'intensité monte
    if (step % 2 === 0 || (this.score > 6 && step % 2 === 1 && Math.random() < 0.55)) this.hat(t, step % 4 === 2 && L.open, step % 2 === 1 ? 0.5 : 1);
    if (L.bass) { const pat = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]; if (pat[step] && step % 4 !== 0 || step === 0 || step === 8) this.bass(t, root + (step % 8 === 6 ? 12 : 0), 60 / this.bpm / 4 * 1.8); }
    if (L.pad && step === 0) this.pad(t, chord, 60 / this.bpm * 4);
    if (L.arp && step % 2 === 0) { const seq = [0, 1, 2, 3, 2, 1, 3, 2]; const n = chord[seq[(step / 2) % 8] % chord.length] + 12 + (step % 8 === 6 ? 12 : 0); this.pluck(t, n, 0.12); }
    if (L.lead && (step === 0 || step === 6 || step === 10)) this.lead(t, chord[chord.length - 1] + 12 + (step === 6 ? 2 : 0), 0.4);
  }

  // ---------------------------------------------------------------- voix
  kick(t) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.45);
    // petit clic d'attaque
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; const ng = c.createGain(), nf = c.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 3000;
    ng.gain.setValueAtTime(0.12, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02); n.connect(nf); nf.connect(ng); ng.connect(this.musicBus); n.start(t, Math.random() * 0.5, 0.03);
  }
  noiseHit(t, { freq, q = 1, type = 'bandpass', dur = 0.1, gain = 0.5, bus, send = 0 }) {
    const c = this.ctx, n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(bus || this.musicBus);
    if (send) { const s = c.createGain(); s.gain.value = send; g.connect(s); s.connect(this.reverb); }
    n.start(t, Math.random() * 0.4, dur + 0.05);
  }
  clap(t) { for (let i = 0; i < 3; i++) this.noiseHit(t + i * 0.011, { freq: 1500, q: 0.9, dur: i === 2 ? 0.16 : 0.025, gain: 0.45, send: 0.35 }); }
  hat(t, open, acc) { this.noiseHit(t, { freq: 7500, type: 'highpass', q: 0.7, dur: open ? 0.22 : 0.045, gain: 0.22 * acc }); }
  bass(t, midi, dur) {
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = mtof(midi); o2.frequency.value = mtof(midi - 12);
    f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(140, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.42, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.musicBus); o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  pad(t, chord, dur) {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(1800 + this.score * 120, t + dur * 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.11, t + dur * 0.25); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.02);
    f.connect(g); g.connect(this.musicBus);
    const s = c.createGain(); s.gain.value = 0.7; g.connect(s); s.connect(this.reverb);
    for (const m of chord) for (const det of [-9, 0, 9]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m + 12); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur * 1.05);
    }
  }
  pluck(t, midi, dur) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = mtof(midi);
    f.type = 'lowpass'; f.Q.value = 4; f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(500, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.06);
    o.connect(f); f.connect(g); g.connect(this.musicBus); const s = c.createGain(); s.gain.value = 0.3; g.connect(s); s.connect(this.reverb);
    o.start(t); o.stop(t + dur + 0.1);
  }
  lead(t, midi, dur) {
    const c = this.ctx, g = c.createGain(), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3200;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    f.connect(g); g.connect(this.musicBus); const s = c.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(this.reverb);
    for (const det of [-7, 7]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = mtof(midi); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.05); }
  }

  // ---------------------------------------------------------------- effets
  // Flash d'appareil photo : charge (sifflement), éclair (claquement), déclencheur mécanique.
  flash(x = 0, vol = 1) {
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime + 0.005;
    const pan = c.createStereoPanner(); pan.pan.value = Math.max(-1, Math.min(1, x / 8));
    const bus = c.createGain(); bus.gain.value = 0.6 * vol; bus.connect(pan); pan.connect(this.sfxBus);
    // sifflement de la charge du condensateur
    const o = c.createOscillator(), og = c.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(3200, t); o.frequency.exponentialRampToValueAtTime(7800, t + 0.11);
    og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.05, t + 0.08); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    o.connect(og); og.connect(bus); o.start(t); o.stop(t + 0.15);
    // claquement du flash
    const tf = t + 0.12;
    this.noiseHit(tf, { freq: 2500, type: 'highpass', q: 0.5, dur: 0.07, gain: 0.9, bus, send: 0.25 });
    const pop = c.createOscillator(), pg = c.createGain(); pop.frequency.setValueAtTime(240, tf); pop.frequency.exponentialRampToValueAtTime(60, tf + 0.08);
    pg.gain.setValueAtTime(0.5, tf); pg.gain.exponentialRampToValueAtTime(0.001, tf + 0.12); pop.connect(pg); pg.connect(bus); pop.start(tf); pop.stop(tf + 0.14);
    // déclencheur mécanique (double clic)
    this.noiseHit(tf + 0.01, { freq: 1800, q: 4, dur: 0.018, gain: 0.5, bus });
    this.noiseHit(tf + 0.07, { freq: 1100, q: 5, dur: 0.025, gain: 0.4, bus });
  }

  // Applaudissements / acclamations (fin de défilé)
  cheer(power = 0.5) {
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.1 * power, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    n.connect(f); f.connect(g); g.connect(this.sfxBus); n.start(t); n.stop(t + 2);
  }

  // ------------------------------------------------------------- rythme pour la scène
  // impulsion 0..1 (pic à chaque grosse caisse) et phase du temps en radians
  getBeat() {
    if (!this.started) return { pulse: 0, phase: 0 };
    const now = this.ctx.currentTime;
    let last = -10;
    for (const k of this.kickTimes) if (k <= now) last = Math.max(last, k);
    return { pulse: Math.exp(-(now - last) * 7), phase: ((now - this.startTime) * this.bpm / 60) * Math.PI * 2 };
  }
}
