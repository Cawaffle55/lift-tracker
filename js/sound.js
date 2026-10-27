/* Lift Tracker sounds + haptics. Everything is synthesized with Web Audio (no audio files).
   LTSound.play(name) -> number of notes scheduled (0 if muted/unavailable).
   Names: 'set', 'exercise', 'finish', 'pr', 'rest'. */
(function () {
  'use strict';
  let ctx = null; let master = null;
  const settings = () => (window.LTStore && window.LTStore.data.settings) || { sound: true, volume: 70, vibrate: true };
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination); } catch (e) { ctx = null; }
    return ctx;
  }
  // iOS Safari: audio must be started/resumed inside a user gesture. Also play a 1-sample silent buffer.
  let unlocked = false;
  function unlock() {
    const c = ensure(); if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    if (!unlocked) {
      try { const b = c.createBuffer(1, 1, 22050); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); unlocked = true; } catch (e) { /* */ }
    }
  }
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach((ev) => document.addEventListener(ev, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); });

  // small "room": a generated decaying-noise impulse response feeding a convolver, so notes get a soft shimmer tail
  let verbs = {};
  function room(long) { // short room (0.3 s) keeps the set ding under 400 ms; long hall (0.9 s) for fanfares
    const k = long ? 'l' : 's'; if (verbs[k]) return verbs[k];
    let verb;
    try {
      const len = Math.floor(ctx.sampleRate * (long ? 0.9 : 0.2)); const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4) * (i < 200 ? i / 200 : 1); }
      const cv = ctx.createConvolver(); cv.buffer = ir; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
      const g = ctx.createGain(); g.gain.value = 0.9; cv.connect(lp).connect(g).connect(master); verb = cv;
    } catch (e) { verb = master; }
    return (verbs[k] = verb);
  }
  // one enveloped oscillator note. wet = reverb send; lowpass/filterEnv = brass-style opening filter; vibrato in cents
  function note(t0, freq, dur, { type = 'sine', gain = 0.5, attack = 0.005, release = null, glideTo = null, detune = 0, lowpass = null, filterEnv = null, wet = 0, hall = false, vibrato = 0, hold = false } = {}) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); o.detune.value = detune;
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur * 0.6);
    if (vibrato) { const lfo = ctx.createOscillator(); const lg = ctx.createGain(); lfo.frequency.value = 5.5; lg.gain.setValueAtTime(0, t0); lg.gain.linearRampToValueAtTime(vibrato, t0 + 0.25); lfo.connect(lg).connect(o.detune); lfo.start(t0); lfo.stop(t0 + dur + 0.05); }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    if (hold) { g.gain.setValueAtTime(gain, t0 + dur - (release || 0.25)); g.gain.exponentialRampToValueAtTime(gain * 0.75, t0 + dur - (release || 0.25) + 0.001); }
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let out = g;
    if (lowpass || filterEnv) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = filterEnv ? 2.5 : 0.7;
      if (filterEnv) { const [lo, hi, rise] = filterEnv; f.frequency.setValueAtTime(lo, t0); f.frequency.exponentialRampToValueAtTime(hi, t0 + rise); f.frequency.exponentialRampToValueAtTime(Math.max(lo, hi * 0.6), t0 + dur); } else f.frequency.value = lowpass;
      g.connect(f); out = f;
    }
    o.connect(g); out.connect(master);
    if (wet) { const s = ctx.createGain(); s.gain.value = wet; out.connect(s); s.connect(room(hall)); }
    o.start(t0); o.stop(t0 + dur + 0.05);
    return 1;
  }
  function click(t0, gain = 0.35, hp = 2500) { // short soft noise transient = "pop"
    const len = Math.floor(ctx.sampleRate * 0.02); const b = ctx.createBuffer(1, len, ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    const s = ctx.createBufferSource(); const g = ctx.createGain(); const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = hp; g.gain.value = gain; s.buffer = b; s.connect(f).connect(g).connect(master); s.start(t0);
    return 1;
  }
  const N = { G4: 392, C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760, B6: 1975.53, C7: 2093, E7: 2637.02 };
  // brass voice: two slightly detuned saws through a lowpass that "blooms" open, like a horn's attack
  function brass(t0, f, dur, gain = 0.16, opts = {}) {
    const fe = [Math.max(300, f * 1.2), Math.min(5200, f * 5), 0.07];
    return note(t0, f, dur, { type: 'sawtooth', gain, attack: 0.025, filterEnv: fe, wet: 0.22, hall: true, ...opts }) + note(t0, f, dur, { type: 'sawtooth', gain: gain * 0.7, attack: 0.03, detune: 9, filterEnv: fe, wet: 0.22, hall: true, ...opts });
  }
  const SOUNDS = {
    // set done: warm "pop-ding" — soft pop, sine on E6 with a sweet perfect-fifth (B6) a beat later, octave-below body, short shimmer
    set(t) {
      return click(t, 0.12, 3500)
        + note(t, N.E6, 0.32, { type: 'sine', gain: 0.42, attack: 0.008, wet: 0.18 })
        + note(t, N.E5, 0.16, { type: 'triangle', gain: 0.16, attack: 0.006 })
        + note(t + 0.045, N.B6, 0.3, { type: 'sine', gain: 0.24, attack: 0.012, wet: 0.25 })
        + note(t + 0.045, N.E7, 0.18, { type: 'sine', gain: 0.05, attack: 0.02, wet: 0.3 });
    },
    // last set of an exercise: same warm timbre as a quick rising C-major arpeggio
    exercise(t) {
      let n = click(t, 0.12, 3500);
      [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => { n += note(t + i * 0.07, f, 0.3 + i * 0.05, { type: 'sine', gain: 0.36, attack: 0.008, wet: 0.22 }); n += note(t + i * 0.07, f / 2, 0.18, { type: 'triangle', gain: 0.12, attack: 0.006 }); });
      return n;
    },
    // workout finished: brass G-C-E pickup into a held C-major chord
    finish(t) {
      let n = 0;
      [[N.G4, 0], [N.C5, 0.13], [N.E5, 0.26]].forEach(([f, d]) => { n += brass(t + d, f, 0.17, 0.15); });
      [N.C5, N.E5, N.G5, N.C6].forEach((f) => { n += brass(t + 0.42, f, 1.0, 0.1, { hold: true, vibrato: 8 }); });
      return n + click(t + 0.42, 0.15);
    },
    // NEW PR: triumphant horn fanfare — "ba-da-da-BAAA": rising C-major arpeggio (G4 C5 E5 G5) then a held C6 major chord with vibrato + sparkle
    pr(t) {
      let n = 0;
      [[N.G4, 0], [N.C5, 0.11], [N.E5, 0.22], [N.G5, 0.33]].forEach(([f, d]) => { n += brass(t + d, f, 0.14, 0.16); n += brass(t + d, f / 2, 0.14, 0.06); });
      const T = t + 0.46;
      [N.C5, N.E5, N.G5, N.C6].forEach((f) => { n += brass(T, f, 0.95, 0.11, { hold: true, vibrato: 10, release: 0.3 }); });
      n += brass(T, N.C5 / 2, 0.95, 0.07, { hold: true, release: 0.3 }) + click(T, 0.2, 1800);
      [N.C7, N.E7, N.G6, N.C7].forEach((f, i) => { n += note(T + 0.08 + i * 0.07, f, 0.25, { type: 'sine', gain: 0.06, wet: 0.5, hall: true }); });
      return n;
    },
    // rest over: bright rising A-C#-E "ding-ding-DING", played twice; louder than the set ding
    rest(t) {
      let n = 0;
      [0, 0.62].forEach((o) => {
        [[N.A5, 0], [1108.73, 0.12], [N.E6, 0.24]].forEach(([f, d], i) => {
          const last = i === 2; const dur = last ? 0.32 : 0.13;
          n += note(t + o + d, f, dur, { type: 'triangle', gain: 0.62, attack: 0.006, wet: 0.15 });
          n += note(t + o + d, f * 2, dur * 0.8, { type: 'square', gain: 0.07, attack: 0.006, lowpass: 4500 });
        });
      });
      return n;
    }
  };
  // vibration patterns (ms): set = one crisp tick; PR = a celebratory rumble "da-da-da-DAAA"; rest = two long buzzes
  const HAPTICS = { set: 20, exercise: [20, 50, 30], finish: [30, 60, 30, 60, 90], pr: [40, 40, 40, 40, 40, 60, 220], rest: [200, 100, 200] };
  function buzz(name) {
    const st = settings();
    if (!st.vibrate || !HAPTICS[name] || typeof navigator.vibrate !== 'function') return false; // iOS Safari has no vibrate: silently skip
    try { return navigator.vibrate(HAPTICS[name]) !== false; } catch (e) { return false; }
  }
  const api = {
    names: Object.keys(SOUNDS), last: null, count: 0, buzzed: false, haptics: HAPTICS,
    play(name, delay = 0) {
      const st = settings();
      api.buzzed = buzz(name); api.last = name; api.count++;
      if (!st.sound || !SOUNDS[name]) return 0;
      const c = ensure(); if (!c) return 0;
      if (c.state === 'suspended') c.resume().catch(() => {});
      master.gain.setValueAtTime(Math.max(0, Math.min(1, (st.volume ?? 70) / 100)) * 0.9, c.currentTime);
      return SOUNDS[name](c.currentTime + 0.01 + delay);
    },
    // offline render for tests/tuning: { peak, audibleMs (last sample above -46 dBFS), notes }
    async render(name, vol = 70) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OAC || !SOUNDS[name]) return null;
      const saved = [ctx, master, verbs]; const off = new OAC(1, 44100 * 3, 44100);
      try {
        ctx = off; verbs = {}; master = off.createGain(); master.gain.value = (vol / 100) * 0.9; master.connect(off.destination);
        const notes = SOUNDS[name](0.01); const buf = await off.startRendering(); const d = buf.getChannelData(0);
        let peak = 0, last = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a > 0.005) last = i; }
        return { peak, audibleMs: Math.round((last / 44100 - 0.01) * 1000), notes };
      } finally { [ctx, master, verbs] = saved; }
    },
    unlock, get state() { return ctx ? ctx.state : 'none'; }
  };
  window.LTSound = api;
})();
