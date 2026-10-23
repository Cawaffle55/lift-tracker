/* Lift Tracker v1.4 feature helpers (pure functions, no DOM state): progression, plates, warm-ups,
   streak/calendar, muscle heatmap, charts, CSV history import/export, program links, share card.
   Exposed as window.LTX (and module.exports for Node). */
(function (root) {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const roundTo = (x, step) => Math.round(x / step) * step;
  const fmt = (n) => String(Math.round(n * 100) / 100);

  /* ---------- 1. progressive overload ---------- */
  // "8-12" -> [8,12]; "5" -> [5,5]; "30-45 s" -> [30,45]; "AMRAP" -> null
  function parseRange(reps) {
    const m = String(reps || '').replace(/[–—]/g, '-').match(/(\d+)(?:\s*-\s*(\d+))?/);
    if (!m) return null; const lo = +m[1]; const hi = m[2] ? +m[2] : lo; return lo > 0 ? [Math.min(lo, hi), Math.max(lo, hi)] : null;
  }
  function defaultIncrement(unit, equipment) {
    if (unit === 'kg') return equipment === 'dumbbell' || equipment === 'kettlebell' ? 2 : 2.5;
    return 5;
  }
  // sessions: newest first, each { sets:[{weight, reps, rpe}] } = done working (non-drop) sets, weight already in the current unit
  // opts: { reps (target text), planned (working set count), inc, mode: 'auto'|'double'|'linear'|'off', deload (pct), bw, time }
  function suggest(sessions, opts) {
    if (!sessions || !sessions.length || opts.mode === 'off') return null;
    const last = sessions[0]; const sets = last.sets.filter((s) => s.reps != null);
    if (!sets.length) return null;
    const inc = opts.inc || 5; const deload = opts.deload ?? 10;
    let range = parseRange(opts.reps);
    if (!range) { const r = sets.map((s) => s.reps); range = [Math.min(...r), Math.max(...r)]; }
    const [lo, hi] = range;
    const mode = opts.mode === 'double' || opts.mode === 'linear' ? opts.mode : hi > lo ? 'double' : 'linear';
    const planned = Math.max(1, opts.planned || sets.length);
    const at = (arr, i) => arr[Math.min(i, arr.length - 1)];
    const lastW = sets.map((s) => s.weight || 0); const lastR = sets.map((s) => s.reps);
    const out = (w, r, kind, reason) => ({ w: Array.from({ length: planned }, (_, i) => at(w, i)), r: Array.from({ length: planned }, (_, i) => at(r, i)), kind, reason, mode, lo, hi });
    // timed holds and pure bodyweight: progress the reps/seconds
    if (opts.time || (opts.bw && lastW.every((w) => !w))) {
      const step = opts.time ? 5 : 1;
      if (sets.every((s) => s.reps >= hi)) return out(lastW, lastR.map((r) => r + step), 'reps', `Hit ${hi}${opts.time ? ' s' : ''} on every set → +${step}${opts.time ? ' s' : ' rep'}`);
      return out(lastW, lastR.map((r) => Math.min(Math.max(hi, r), r + step)), 'reps', `Beat last time by ${step}${opts.time ? ' s' : ' rep'}`);
    }
    const hitTop = sets.length >= Math.min(planned, sets.length) && sets.every((s) => s.reps >= hi);
    if (hitTop) {
      const easy = sets.every((s) => s.rpe != null && s.rpe <= 7);
      const step = easy ? inc * 2 : inc;
      return out(lastW.map((w) => w + step), [lo], 'up', `Hit ${hi}+ reps on all ${sets.length} sets${easy ? ' at RPE ≤ 7' : ''} → +${fmt(step)}`);
    }
    const missed = (ss) => mode === 'linear' ? ss.some((s) => s.reps < hi) : ss.some((s) => s.reps < lo);
    if (missed(sets)) {
      const top = Math.max(...lastW); let misses = 0;
      for (const s of sessions) { const ss = s.sets.filter((x) => x.reps != null); if (!ss.length) break; if (missed(ss) && Math.max(...ss.map((x) => x.weight || 0)) >= top - 1e-6) misses++; else break; }
      if (misses >= 3) {
        const st = inc >= 2.5 ? inc / 2 : inc;
        return out(lastW.map((w) => Math.max(0, roundTo(w * (1 - deload / 100), st))), [lo], 'deload', `Missed ${mode === 'linear' ? hi : lo} reps ${misses} sessions in a row → deload ${deload}%`);
      }
      return out(lastW, mode === 'linear' ? [hi] : lastR.map((r) => Math.max(lo, r)), 'same', `Missed ${mode === 'linear' ? hi : lo} reps last time → repeat the weight (${misses}/3 before a deload)`);
    }
    return out(lastW, lastR.map((r) => Math.min(hi, r + 1)), 'reps', `In range (${lo}–${hi}) → same weight, +1 rep; hit ${hi} on all sets to add ${fmt(inc)}`);
  }

  /* ---------- 2. plate calculator ---------- */
  const DEFAULT_PLATES = { lb: { bar: 45, plates: { 45: 6, 35: 1, 25: 1, 10: 2, 5: 1, 2.5: 1 } }, kg: { bar: 20, plates: { 25: 4, 20: 2, 15: 1, 10: 1, 5: 1, 2.5: 1, 1.25: 1 } } };
  // avail: { size: countPerSide }. Returns { perSide:[sizes], total, exact, lower, upper, belowBar }
  const INF = 1e9;
  function plates(total, bar, avail) {
    const sizes = Object.keys(avail).map(Number).filter((s) => s > 0 && avail[s] > 0).sort((a, b) => b - a);
    const U = 0.25; const toU = (x) => Math.round(x / U);
    const side = (total - bar) / 2;
    if (!(total > 0) || side < 0) return { perSide: [], total: bar, exact: Math.abs(total - bar) < 1e-9, belowBar: total < bar, lower: null, upper: null };
    // bounded knapsack over 0.25-unit sums: best[sum] = fewest plates; ties → bigger plates first (25+15 over 20+20)
    const maxSum = sizes.reduce((a, s) => a + toU(s) * avail[s], 0);
    const better = (x, y) => { if (!y) return true; if (x.length !== y.length) return x.length < y.length; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
    const best = new Array(maxSum + 1).fill(null); best[0] = [];
    sizes.forEach((s) => {
      const u = toU(s);
      for (let k = 0; k < avail[s]; k++) {
        for (let t = maxSum; t >= u; t--) { const p = best[t - u]; if (!p) continue; const cand = [...p, s].sort((a, b) => b - a); if (better(cand, best[t])) best[t] = cand; }
      }
    });
    const cnt = best.map((x) => (x ? x.length : INF)); const listFor = (t) => best[t].slice();
    const target = toU(side);
    const mk = (t) => ({ perSide: listFor(t), total: bar + 2 * t * U });
    if (target <= maxSum && cnt[target] < INF) return { perSide: listFor(target), total: bar + 2 * side, exact: true, lower: null, upper: null };
    let lo = Math.min(target, maxSum); while (lo > 0 && cnt[lo] >= INF) lo--;
    let hi = target + 1; while (hi <= maxSum && cnt[hi] >= INF) hi++;
    return { perSide: [], total, exact: false, lower: mk(lo), upper: hi <= maxSum ? mk(hi) : null };
  }
  const PLATE_COLORS = { kg: { 25: '#dc2626', 20: '#2563eb', 15: '#eab308', 10: '#16a34a', 5: '#e5e7eb', 2.5: '#111827', 1.25: '#9ca3af' }, lb: { 45: '#2563eb', 35: '#eab308', 25: '#16a34a', 10: '#e5e7eb', 5: '#dc2626', 2.5: '#111827' } };
  function plateSVG(perSide, unit) {
    const maxS = unit === 'kg' ? 25 : 45; const W = 300, H = 110, cy = H / 2;
    let x = 56; let rects = '';
    perSide.forEach((p) => {
      const h = 34 + 66 * Math.min(1, p / maxS); const w = p >= maxS * 0.5 ? 14 : 10;
      const col = (PLATE_COLORS[unit] || {})[p] || '#64748b';
      rects += `<rect x="${x}" y="${cy - h / 2}" width="${w}" height="${h}" rx="3" fill="${col}" stroke="#0d0f12" stroke-width="1.5"/>`;
      if (perSide.length <= 9) rects += `<text x="${x + w / 2}" y="${cy + h / 2 + 11}" font-size="9" text-anchor="middle" fill="#8d96a3">${fmt(p)}</text>`;
      x += w + 2;
    });
    return `<svg class="plates-svg" viewBox="0 0 ${W} ${H + 6}" width="100%" height="${H + 6}" role="img" aria-label="plates per side: ${esc(perSide.join(', ') || 'none')}">
      <rect x="0" y="${cy - 5}" width="${Math.max(x + 30, 200)}" height="10" rx="4" fill="#8d96a3"/><rect x="40" y="${cy - 14}" width="14" height="28" rx="3" fill="#cbd5e1"/>${rects}</svg>`;
  }

  /* ---------- 3. warm-up calculator ---------- */
  const DEFAULT_RAMP = [{ pct: 0, reps: 10 }, { pct: 40, reps: 5 }, { pct: 60, reps: 5 }, { pct: 80, reps: 3 }];
  function parseRamp(text) {
    const out = [];
    String(text || '').split(/[,;\n]+/).forEach((part) => {
      const p = part.trim().toLowerCase(); if (!p) return;
      let m = p.match(/^(bar|empty|empty bar)\s*[x×*]\s*(\d+)$/); if (m) { out.push({ pct: 0, reps: +m[2] }); return; }
      m = p.match(/^(\d+(?:\.\d+)?)\s*%\s*[x×*]\s*(\d+)$/); if (m && +m[1] > 0 && +m[1] < 100) { out.push({ pct: +m[1], reps: +m[2] }); return; }
      throw new Error(`Can't read "${part.trim()}" — use e.g. bar×10, 40%×5, 60%×5, 80%×3`);
    });
    if (!out.length) throw new Error('Add at least one warm-up step');
    return out;
  }
  const rampText = (ramp) => (ramp || DEFAULT_RAMP).map((r) => (r.pct ? `${r.pct}%` : 'bar') + '×' + r.reps).join(', ');
  // returns [{weight, reps}] rounded to loadable weights (bar + pairs of the smallest plate), ascending, without duplicates
  function warmups(work, ramp, opts) {
    const bar = opts.bar || 0; const step = opts.step || 5; const out = [];
    if (!(work > 0)) return out;
    (ramp || DEFAULT_RAMP).forEach((r) => {
      let w;
      if (!r.pct) { if (!bar) return; w = bar; } else { w = work * r.pct / 100; w = bar ? bar + roundTo(Math.max(0, w - bar), step) : roundTo(w, step); if (bar && w < bar) w = bar; }
      if (w >= work - 1e-9) return;
      if (out.length && Math.abs(out[out.length - 1].weight - w) < 1e-9) { out[out.length - 1].reps = Math.min(out[out.length - 1].reps, r.reps); return; }
      if (out.length && w < out[out.length - 1].weight) return;
      out.push({ weight: Math.round(w * 100) / 100, reps: r.reps });
    });
    return out;
  }

  /* ---------- 7. calendar & streak ---------- */
  function weekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; } // Monday
  const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  function streak(dates, now) {
    const weeks = new Set(dates.map((d) => weekStart(d).getTime()));
    let w = weekStart(now || new Date()); let n = 0;
    const thisWeek = weeks.has(w.getTime());
    if (!thisWeek) w.setDate(w.getDate() - 7); // current week not over yet: streak stays alive
    while (weeks.has(w.getTime())) { n++; w.setDate(w.getDate() - 7); }
    const thisCount = dates.filter((d) => weekStart(d).getTime() === weekStart(now || new Date()).getTime()).length;
    return { weeks: n, thisWeek: thisCount };
  }
  function monthGrid(year, month) { // 6x7 grid starting Monday, entries Date or null
    const first = new Date(year, month, 1); const off = (first.getDay() + 6) % 7; const days = new Date(year, month + 1, 0).getDate();
    const cells = []; for (let i = 0; i < off; i++) cells.push(null); for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7) cells.push(null); return cells;
  }

  /* ---------- 8. muscle heatmap ---------- */
  const MUSCLES = ['chest', 'shoulders', 'triceps', 'biceps', 'forearms', 'lats', 'middle back', 'lower back', 'traps', 'neck', 'abdominals', 'glutes', 'quadriceps', 'hamstrings', 'adductors', 'abductors', 'calves'];
  // counts hard sets: done working sets (warm-ups excluded); primary muscle 1 set, secondary 0.5
  function muscleSets(workouts, lookup, sinceMs) {
    const c = Object.fromEntries(MUSCLES.map((m) => [m, 0])); let unmapped = 0; let total = 0;
    workouts.forEach((w) => {
      if (sinceMs && new Date(w.startedAt).getTime() < sinceMs) return;
      w.exercises.forEach((e) => {
        const n = e.sets.filter((s) => s.done !== false && s.type !== 'warmup').length; if (!n) return;
        total += n; const l = lookup(e); if (!l) { unmapped += n; return; }
        (l.primary || []).forEach((m) => { if (m in c) c[m] += n; });
        (l.secondary || []).forEach((m) => { if (m in c) c[m] += n * 0.5; });
      });
    });
    return { counts: c, unmapped, total };
  }
  // stylised front/back body; regions are drawn for the left side and mirrored around x=80
  const FRONT = [
    ['neck', 'rect', 'x="73" y="40" width="7" height="10" rx="2"'],
    ['traps', 'path', 'd="M80,50 L66,52 L60,58 L80,57 Z"'],
    ['shoulders', 'ellipse', 'cx="51" cy="67" rx="12" ry="10"'],
    ['chest', 'path', 'd="M80,60 L80,92 Q67,97 57,89 Q52,74 60,63 Z"'],
    ['biceps', 'ellipse', 'cx="43" cy="97" rx="7.5" ry="16"'],
    ['forearms', 'path', 'd="M36,116 Q30,136 32,156 L40,156 Q46,136 47,118 Z"'],
    ['abdominals', 'path', 'd="M80,96 L80,150 Q72,150 69,142 L68,98 Z"'],
    ['abductors', 'ellipse', 'cx="56" cy="160" rx="6" ry="11"'],
    ['quadriceps', 'path', 'd="M60,168 Q52,200 57,238 L71,238 Q77,204 74,172 Z"'],
    ['adductors', 'path', 'd="M79,166 L75,206 Q70,190 70,170 Z"'],
    ['calves', 'ellipse', 'cx="63" cy="276" rx="6.5" ry="21"']
  ];
  const BACK = [
    ['neck', 'rect', 'x="73" y="40" width="7" height="8" rx="2"'],
    ['traps', 'path', 'd="M80,46 L64,56 L68,64 L80,70 Z"'],
    ['shoulders', 'ellipse', 'cx="51" cy="67" rx="12" ry="10"'],
    ['middle back', 'path', 'd="M80,72 L68,66 L64,78 L70,98 L80,100 Z"'],
    ['lats', 'path', 'd="M62,80 Q56,104 69,128 L77,122 L70,100 Z"'],
    ['lower back', 'path', 'd="M80,104 L72,104 L71,142 L80,144 Z"'],
    ['triceps', 'ellipse', 'cx="43" cy="97" rx="7.5" ry="16"'],
    ['forearms', 'path', 'd="M36,116 Q30,136 32,156 L40,156 Q46,136 47,118 Z"'],
    ['glutes', 'ellipse', 'cx="68" cy="158" rx="12" ry="13"'],
    ['abductors', 'ellipse', 'cx="54" cy="150" rx="4.5" ry="9"'],
    ['hamstrings', 'path', 'd="M59,176 Q54,206 59,236 L72,236 Q77,206 75,176 Z"'],
    ['calves', 'ellipse', 'cx="64" cy="268" rx="8" ry="19"']
  ];
  const SILHOUETTE = `<circle cx="80" cy="22" r="15"/><path d="M58,52 Q80,44 102,52 L112,62 Q118,90 116,118 L124,160 L114,162 L106,120 L104,150 Q106,160 104,170 L100,240 L98,300 L86,302 L84,240 L80,180 L76,240 L74,302 L62,300 L60,240 L56,170 Q54,160 56,150 L54,120 L46,162 L36,160 L44,118 Q42,90 48,62 Z"/>`;
  function bodySVG(counts, max, side) {
    const regions = side === 'back' ? BACK : FRONT;
    const fill = (m) => { const v = counts[m] || 0; if (!v) return 'fill:var(--line)'; const a = 0.25 + 0.75 * Math.min(1, v / (max || 1)); return `fill:var(--accent);fill-opacity:${a.toFixed(2)}`; };
    const shape = (m, tag, attrs) => `<${tag} ${attrs} data-m="${m}" style="${fill(m)}"><title>${m}: ${fmt(counts[m] || 0)} sets</title></${tag}>`;
    return `<svg class="body-svg" viewBox="0 0 160 310" width="100%" role="img" aria-label="${side} muscle heatmap">
      <g style="fill:var(--card2)">${SILHOUETTE}</g>
      <g>${regions.map(([m, t, a]) => shape(m, t, a)).join('')}</g>
      <g transform="translate(160,0) scale(-1,1)">${regions.map(([m, t, a]) => shape(m, t, a)).join('')}</g>
      <text x="80" y="308" text-anchor="middle" font-size="10" style="fill:var(--mute)">${side === 'back' ? 'BACK' : 'FRONT'}</text></svg>`;
  }

  /* ---------- 9. charts ---------- */
  // points: [{t: ms, v: number}] ascending; returns inline SVG line chart
  function lineChart(points, opts = {}) {
    if (!points.length) return '<div class="mute small" style="padding:20px 0;text-align:center">No data in this range yet.</div>';
    const W = 340, H = opts.h || 180, L = 40, R = 10, T = 12, B = 24;
    const vs = points.map((p) => p.v); let min = Math.min(...vs), max = Math.max(...vs);
    if (min === max) { min = min * 0.9; max = max * 1.1 || 1; } const pad = (max - min) * 0.1; min = Math.max(0, min - pad); max += pad;
    const t0 = points[0].t, t1 = points[points.length - 1].t || t0 + 1;
    const X = (t) => points.length === 1 ? (L + W - R) / 2 : L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
    const Y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
    let g = '';
    for (let i = 0; i <= 3; i++) { const v = min + ((max - min) * i) / 3; const y = Y(v); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" style="stroke:var(--line)"/><text x="${L - 4}" y="${y + 3}" font-size="9" text-anchor="end" style="fill:var(--mute)">${Math.round(v)}</text>`; }
    const d = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    g += `<text x="${L}" y="${H - 6}" font-size="9" style="fill:var(--mute)">${d(t0)}</text>`;
    if (points.length > 1) g += `<text x="${W - R}" y="${H - 6}" font-size="9" text-anchor="end" style="fill:var(--mute)">${d(t1)}</text>`;
    const xy = points.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
    const best = points.reduce((a, p) => (p.v > a.v ? p : a), points[0]);
    const dots = points.map((p) => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${p === best ? 4.5 : 3}" style="fill:${p === best ? 'var(--warn)' : 'var(--accent)'}"><title>${d(p.t)}: ${fmt(p.v)}</title></circle>`).join('');
    const area = points.length > 1 ? `<polygon points="${X(t0)},${Y(min)} ${xy} ${X(t1)},${Y(min)}" style="fill:var(--accent);fill-opacity:.12"/>` : '';
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opts.label || 'chart')}" data-n="${points.length}">${g}${area}<polyline fill="none" points="${xy}" style="stroke:var(--accent);stroke-width:2.5;stroke-linejoin:round"/>${dots}</svg>`;
  }
  function barChart(bars, opts = {}) { // bars: [{label, v}]
    const W = 340, H = opts.h || 150, L = 34, B = 20, T = 10; const max = Math.max(1, ...bars.map((b) => b.v)); const bw = (W - L - 6) / Math.max(1, bars.length);
    let g = ''; for (let i = 0; i <= 2; i++) { const v = (max * i) / 2; const y = T + (1 - v / max) * (H - T - B); g += `<line x1="${L}" x2="${W - 4}" y1="${y}" y2="${y}" style="stroke:var(--line)"/><text x="${L - 4}" y="${y + 3}" font-size="9" text-anchor="end" style="fill:var(--mute)">${v >= 1000 ? Math.round(v / 100) / 10 + 'k' : Math.round(v)}</text>`; }
    bars.forEach((b, i) => { const h = (b.v / max) * (H - T - B); const x = L + i * bw + 2; g += `<rect x="${x.toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="3" style="fill:var(--accent);fill-opacity:${i === bars.length - 1 ? 1 : 0.6}"><title>${esc(b.label)}: ${Math.round(b.v)}</title></rect>`; if (i % Math.ceil(bars.length / 6) === 0 || i === bars.length - 1) g += `<text x="${(x + (bw - 4) / 2).toFixed(1)}" y="${H - 6}" font-size="9" text-anchor="middle" style="fill:var(--mute)">${esc(b.label)}</text>`; });
    return `<svg class="chart bars" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opts.label || 'bar chart')}">${g}</svg>`;
  }

  /* ---------- 15. CSV history import / export ---------- */
  function splitCSV(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/)[0] || ''; const count = (ch) => firstLine.split('"').filter((_, i) => i % 2 === 0).join('').split(ch).length - 1;
    const delim = count(';') > count(',') ? ';' : count('\t') > count(',') ? '\t' : ',';
    const rows = []; let row = []; let f = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parseDate(s) {
    s = String(s || '').trim(); if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/); // Strong, local time
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    m = s.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4}),? (\d{1,2}):(\d{2})/); // Hevy "28 Mar 2025, 17:29"
    if (m && MONTHS[m[2].toLowerCase()] != null) return new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5]);
    m = s.match(/^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})\s*(am|pm)?/i); // "Mar 28, 2025, 5:29 PM"
    if (m && MONTHS[m[1].toLowerCase()] != null) { let h = +m[4]; if (m[6]) h = (h % 12) + (/pm/i.test(m[6]) ? 12 : 0); return new Date(+m[3], MONTHS[m[1].toLowerCase()], +m[2], h, +m[5]); }
    const d = new Date(s); return isNaN(d) ? null : d;
  }
  function parseDuration(s) {
    s = String(s || '').trim(); if (!s) return null; if (/^\d+(\.\d+)?$/.test(s)) return Math.round(+s);
    let t = 0; let ok = false; s.replace(/(\d+)\s*(h|m|s)/gi, (_, n, u) => { ok = true; t += +n * ({ h: 3600, m: 60, s: 1 }[u.toLowerCase()]); });
    const c = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/); if (c) return c[3] ? +c[1] * 3600 + +c[2] * 60 + +c[3] : +c[1] * 60 + +c[2];
    return ok ? t : null;
  }
  // returns { format, unit, unitKnown, workouts:[...lift tracker workout objects (without ids)] , sets, skipped }
  function parseHistoryCSV(text, opts = {}) {
    const rows = splitCSV(text); if (rows.length < 2) throw new Error('The CSV file is empty');
    const head = rows[0].map((h) => h.trim().toLowerCase()); const col = (...names) => { for (const n of names) { const i = head.findIndex((h) => h === n || h.startsWith(n + ' (')); if (i >= 0) return i; } return -1; };
    let format; let unit = opts.unit || 'lb'; let unitKnown = false;
    const C = {};
    if (head.includes('exercise_title')) {
      format = 'hevy';
      Object.assign(C, { title: col('title'), start: col('start_time'), end: col('end_time'), desc: col('description'), ex: col('exercise_title'), exNotes: col('exercise_notes'), idx: col('set_index'), type: col('set_type'), reps: col('reps'), secs: col('duration_seconds'), rpe: col('rpe'), ss: col('superset_id') });
      C.w = head.indexOf('weight_lbs'); if (C.w >= 0) { unit = 'lb'; unitKnown = true; } else { C.w = head.indexOf('weight_kg'); if (C.w >= 0) { unit = 'kg'; unitKnown = true; } }
    } else if (head.includes('exercise name') || head.some((h) => h.startsWith('exercise name'))) {
      format = 'strong';
      Object.assign(C, { title: col('workout name'), start: col('date'), dur: col('duration', 'workout duration'), ex: col('exercise name'), idx: col('set order'), w: col('weight'), reps: col('reps'), secs: col('seconds'), exNotes: col('notes'), wNotes: col('workout notes'), rpe: col('rpe') });
      const wh = head[C.w] || ''; if (/\(kg/.test(wh)) { unit = 'kg'; unitKnown = true; } else if (/\(lb/.test(wh)) { unit = 'lb'; unitKnown = true; }
      if (/\(sec/.test(head[C.dur] || '')) C.durSec = true;
    } else if (head.includes('exercise') && head.includes('set_type') && head.includes('unit')) {
      format = 'lift-tracker';
      Object.assign(C, { title: col('workout'), start: col('start'), end: col('end'), dur: col('duration_sec'), prog: col('program'), ex: col('exercise'), idx: col('set'), type: col('set_type'), w: col('weight'), unitC: col('unit'), reps: col('reps'), secs: col('seconds'), rpe: col('rpe'), exNotes: col('exercise_notes'), wNotes: col('workout_notes'), tr: col('tracking'), bw: col('bodyweight') });
      unitKnown = true;
    } else throw new Error('Not a Strong, Hevy or Lift Tracker history CSV (unknown columns: ' + rows[0].slice(0, 5).join(', ') + '…)');
    const get = (r, i) => (i >= 0 && i < r.length ? String(r[i]).trim() : '');
    const byKey = new Map(); let sets = 0; let skipped = 0;
    rows.slice(1).forEach((r) => {
      const exName = get(r, C.ex); const start = parseDate(get(r, C.start));
      if (!exName || !start || /^rest timer$/i.test(exName) || /^rest timer$/i.test(get(r, C.idx))) { skipped++; return; }
      const title = get(r, C.title) || 'Workout'; const key = start.getTime() + '|' + title;
      if (!byKey.has(key)) {
        let dur = null; const end = C.end >= 0 ? parseDate(get(r, C.end)) : null;
        if (end) dur = Math.max(0, Math.round((end - start) / 1000)); else if (C.dur >= 0) dur = parseDuration(get(r, C.dur));
        byKey.set(key, { dayName: title, programName: get(r, C.prog) || (format === 'lift-tracker' ? '' : `Imported from ${format === 'hevy' ? 'Hevy' : 'Strong'}`), startedAt: start.toISOString(), durationSec: dur || 0,
          finishedAt: new Date(start.getTime() + (dur || 0) * 1000).toISOString(), unit: format === 'lift-tracker' ? (get(r, C.unitC) || unit) : unit, notes: get(r, C.wNotes >= 0 ? C.wNotes : C.desc), exercises: [], imported: format, prs: [] });
      }
      const w = byKey.get(key);
      let ex = w.exercises[w.exercises.length - 1];
      if (!ex || ex.name !== exName) { ex = { name: exName, origName: exName, notes: get(r, C.exNotes), target: {}, sets: [] }; w.exercises.push(ex); }
      else if (!ex.notes && get(r, C.exNotes)) ex.notes = get(r, C.exNotes);
      const reps = num(get(r, C.reps)); const secs = num(get(r, C.secs)); const weight = num(get(r, C.w)); const rpe = num(get(r, C.rpe));
      const s = { type: 'working', weight: weight ?? 0, reps: null, done: true };
      const tRaw = (format === 'strong' ? get(r, C.idx) : get(r, C.type)).toLowerCase();
      if (/^w|warm/.test(tRaw)) s.type = 'warmup'; else if (/^d$|drop/.test(tRaw)) s.tag = 'drop'; else if (/^f$|fail/.test(tRaw)) s.tag = 'failure';
      if (format === 'lift-tracker' && get(r, C.tr) === 'time') ex.tracking = 'time';
      if (format === 'lift-tracker' && get(r, C.bw) === '1') ex.bodyweight = true;
      if ((reps == null || reps === 0) && secs > 0) { s.reps = Math.round(secs); ex.tracking = 'time'; }
      else if (ex.tracking === 'time' && secs > 0) s.reps = Math.round(secs);
      else s.reps = reps == null ? null : Math.round(reps);
      if (s.reps == null && !(weight > 0)) { skipped++; return; } // cardio / distance-only rows
      if (rpe != null && rpe > 0) s.rpe = rpe;
      ex.sets.push(s); sets++;
    });
    const workouts = [...byKey.values()].map((w) => ({ ...w, exercises: w.exercises.filter((e) => e.sets.length) })).filter((w) => w.exercises.length);
    workouts.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    return { format, unit, unitKnown, workouts, sets, skipped };
  }
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const HIST_COLS = ['start', 'end', 'duration_sec', 'workout', 'program', 'exercise', 'set', 'set_type', 'weight', 'unit', 'reps', 'seconds', 'rpe', 'tracking', 'bodyweight', 'exercise_notes', 'workout_notes'];
  function historyCSV(workouts, isTime, isBW) {
    const lines = [HIST_COLS.join(',')];
    workouts.slice().sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)).forEach((w) => w.exercises.forEach((e) => {
      let n = 0; const t = isTime(e);
      e.sets.filter((s) => s.done !== false).forEach((s) => {
        const type = s.type === 'warmup' ? 'warmup' : s.tag === 'drop' ? 'dropset' : s.tag === 'failure' ? 'failure' : 'normal'; n++;
        lines.push([w.startedAt, w.finishedAt || '', w.durationSec || 0, w.dayName, w.programName || '', e.name, n, type, s.weight ?? '', w.unit, t ? '' : s.reps ?? '', t ? s.reps ?? '' : '', s.rpe ?? '', t ? 'time' : 'reps', isBW(e) ? 1 : 0, n === 1 ? e.notes || '' : '', w.notes || ''].map(csvCell).join(','));
      });
    }));
    return lines.join('\r\n') + '\r\n';
  }

  /* ---------- 11. program share links ---------- */
  const b64u = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64u = (str) => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  async function encodeProgram(p) {
    const clean = JSON.parse(JSON.stringify(p)); ['builtIn', 'edited', 'createdAt', 'custom'].forEach((k) => delete clean[k]);
    const bytes = new TextEncoder().encode(JSON.stringify(clean));
    if (typeof CompressionStream !== 'undefined') { try { return 'z' + b64u(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch (e) { /* fall through */ } }
    return 'j' + b64u(bytes);
  }
  async function decodeProgram(code) {
    code = decodeURIComponent(String(code || '').trim()); const kind = code[0]; const body = unb64u(code.slice(1));
    const bytes = kind === 'z' ? await pipe(body, new DecompressionStream('deflate-raw')) : body;
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /* ---------- 11. shareable workout image ---------- */
  function drawShareCard(canvas, d) { // d: {title, sub, stats:[[value,label]], lines:[[name, detail, pr]], prs:[text], unit}
    const W = 1080, H = 1350; canvas.width = W; canvas.height = H; const g = canvas.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#111827'); bg.addColorStop(1, '#0d0f12'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3b82f6'; g.fillRect(0, 0, W, 14);
    const font = (w, s) => `${w} ${s}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    g.fillStyle = '#93c5fd'; g.font = font(700, 34); g.fillText('🏋️ LIFT TRACKER', 70, 100);
    g.fillStyle = '#eef1f5'; g.font = font(800, 76); g.fillText(String(d.title).slice(0, 22), 70, 200);
    g.fillStyle = '#8d96a3'; g.font = font(500, 34); g.fillText(String(d.sub || '').slice(0, 52), 70, 252);
    const sw = (W - 140 - 40) / 3;
    (d.stats || []).slice(0, 3).forEach(([v, l], i) => {
      const x = 70 + i * (sw + 20); g.fillStyle = '#181b20'; roundRect(g, x, 300, sw, 170, 28); g.fill();
      g.fillStyle = '#eef1f5'; g.font = font(800, 58); g.textAlign = 'center'; g.fillText(String(v), x + sw / 2, 390); g.fillStyle = '#8d96a3'; g.font = font(500, 28); g.fillText(l, x + sw / 2, 440); g.textAlign = 'left';
    });
    let y = 540; g.font = font(700, 30); g.fillStyle = '#8d96a3'; g.fillText('EXERCISES', 70, y); y += 20;
    (d.lines || []).slice(0, 9).forEach(([n, det, pr]) => {
      y += 70; g.fillStyle = '#eef1f5'; g.font = font(700, 38); g.fillText(fit(g, (pr ? '🏆 ' : '') + n, 560), 70, y);
      g.fillStyle = pr ? '#fcd34d' : '#93c5fd'; g.font = font(600, 34); g.textAlign = 'right'; g.fillText(fit(g, det, 360), W - 70, y); g.textAlign = 'left';
    });
    if ((d.lines || []).length > 9) { y += 56; g.fillStyle = '#8d96a3'; g.font = font(500, 30); g.fillText(`+ ${d.lines.length - 9} more`, 70, y); }
    if ((d.prs || []).length) { g.fillStyle = '#fcd34d'; g.font = font(700, 34); g.fillText(`🏆 ${d.prs.length} personal record${d.prs.length > 1 ? 's' : ''}`, 70, H - 120); }
    g.fillStyle = '#8d96a3'; g.font = font(500, 26); g.fillText('Free · no account · data stays on my phone', 70, H - 60);
    return canvas;
    function fit(ctx, t, max) { t = String(t); while (t.length > 3 && ctx.measureText(t).width > max) t = t.slice(0, -2) + '…'; return t.replace(/……$/, '…'); }
    function roundRect(ctx, x, yy, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, yy); ctx.arcTo(x + w, yy, x + w, yy + h, r); ctx.arcTo(x + w, yy + h, x, yy + h, r); ctx.arcTo(x, yy + h, x, yy, r); ctx.arcTo(x, yy, x + w, yy, r); ctx.closePath(); }
  }

  const api = { parseRange, defaultIncrement, suggest, DEFAULT_PLATES, plates, plateSVG, DEFAULT_RAMP, parseRamp, rampText, warmups, weekStart, dayKey, streak, monthGrid,
    MUSCLES, muscleSets, bodySVG, lineChart, barChart, splitCSV, parseDate, parseDuration, parseHistoryCSV, historyCSV, encodeProgram, decodeProgram, drawShareCard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LTX = api;
})(typeof window !== 'undefined' ? window : globalThis);
