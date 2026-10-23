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

  // one enveloped oscillator note
  function note(t0, freq, dur, { type = 'sine', gain = 0.5, attack = 0.005, glideTo = null, detune = 0, lowpass = null } = {}) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); o.detune.value = detune;
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur * 0.6);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let out = g;
    if (lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; g.connect(f); out = f; }
    o.connect(g); out.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
    return 1;
  }
  function click(t0, gain = 0.35) { // short noise transient = "punch"
    const len = Math.floor(ctx.sampleRate * 0.025); const b = ctx.createBuffer(1, len, ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const s = ctx.createBufferSource(); const g = ctx.createGain(); const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 2500; g.gain.value = gain; s.buffer = b; s.connect(f).connect(g).connect(master); s.start(t0);
    return 1;
  }
  const N = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760, B6: 1975.53, C7: 2093, E7: 2637.02, G4: 392 };
  const SOUNDS = {
    // short punchy chime
    set(t) { return click(t, 0.3) + note(t, N.E6, 0.22, { type: 'triangle', gain: 0.55 }) + note(t + 0.055, N.B6, 0.32, { type: 'sine', gain: 0.4 }) + note(t, N.E5, 0.12, { type: 'sine', gain: 0.25 }); },
    // bigger, rising arpeggio
    exercise(t) {
      let n = click(t, 0.3);
      [N.C6, N.E6, N.G6, N.C7].forEach((f, i) => { n += note(t + i * 0.075, f, 0.32 + i * 0.06, { type: 'triangle', gain: 0.45 }); n += note(t + i * 0.075, f / 2, 0.25, { type: 'sine', gain: 0.18 }); });
      return n + note(t + 0.3, N.C6, 0.6, { type: 'sine', gain: 0.25, glideTo: N.C7 });
    },
    // celebratory fanfare: G4-C5-E5 pickup, then held C-major chord (brassy, filtered saws)
    finish(t) {
      let n = 0; const brass = { type: 'sawtooth', gain: 0.22, attack: 0.02, lowpass: 2600 };
      [[N.G4, 0], [N.C5, 0.13], [N.E5, 0.26]].forEach(([f, d]) => { n += note(t + d, f, 0.16, brass); });
      [N.C5, N.E5, N.G5, N.C6].forEach((f) => { n += note(t + 0.42, f, 1.1, { ...brass, gain: 0.16 }); n += note(t + 0.42, f, 1.1, { ...brass, gain: 0.1, detune: 7 }); });
      return n + click(t + 0.42, 0.25) + note(t + 0.5, N.E7, 0.5, { type: 'sine', gain: 0.08 });
    },
    // distinct PR "sparkle": fast twinkling run + shimmer with vibrato-ish detune
    pr(t) {
      let n = 0;
      [N.A5, N.E6, N.A6, N.C7, N.E7, N.C7, N.E7].forEach((f, i) => { n += note(t + i * 0.06, f, 0.22, { type: 'sine', gain: 0.32 }); });
      n += note(t + 0.45, N.A6, 0.9, { type: 'triangle', gain: 0.22 }) + note(t + 0.45, N.A6, 0.9, { type: 'triangle', gain: 0.14, detune: 14 });
      return n + note(t + 0.45, N.E7, 0.9, { type: 'sine', gain: 0.1 });
    },
    // gentle rest-over pattern: three soft beeps, last one higher
    rest(t) { return note(t, N.E5, 0.18, { gain: 0.35, attack: 0.02 }) + note(t + 0.28, N.E5, 0.18, { gain: 0.35, attack: 0.02 }) + note(t + 0.56, N.A5, 0.4, { gain: 0.4, attack: 0.02 }); }
  };
  const HAPTICS = { set: 18, exercise: [20, 40, 35], finish: [30, 60, 30, 60, 90], pr: [60, 40, 60, 40, 140], rest: [200, 120, 200] };
  const api = {
    names: Object.keys(SOUNDS), last: null, count: 0,
    play(name, delay = 0) {
      const st = settings();
      if (st.vibrate && navigator.vibrate && HAPTICS[name]) { try { navigator.vibrate(HAPTICS[name]); } catch (e) { /* */ } }
      api.last = name; api.count++;
      if (!st.sound || !SOUNDS[name]) return 0;
      const c = ensure(); if (!c) return 0;
      if (c.state === 'suspended') c.resume().catch(() => {});
      master.gain.setValueAtTime(Math.max(0, Math.min(1, (st.volume ?? 70) / 100)) * 0.9, c.currentTime);
      return SOUNDS[name](c.currentTime + 0.01 + delay);
    },
    unlock, get state() { return ctx ? ctx.state : 'none'; }
  };
  window.LTSound = api;
})();
