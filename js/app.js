/* Lift Tracker app (vanilla JS). Views are rendered from in-memory state (LTStore.data). */
(function () {
  'use strict';
  const S = window.LTStore; const D = S.data; const L = window.LTImport; const LIB = window.LTLib; const X = window.LTX;
  const $ = (sel, el = document) => el.querySelector(sel);
  const view = $('#view'); const topbar = $('#topbar-inner');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = L.uid;
  const APP_VERSION = '1.6.2';
  const BUILTIN_VERSION = 4; // bump when a bundled program definition changes
  let pendingImport = null; // { results:[{program,warnings,ignored}], kind, pasteText }
  let pasteDraft = { text: '', name: '', repeat: 1 };
  let selectedWeek = null; let deferredInstall = null;
  let pickCtx = null; // { mode:'session' } | { mode:'program', programId, wi, di } while adding exercises from the library
  let lib = { q: '', eq: '', mus: '', limit: 120 }; let scrollToEx = null; let addSheetProg = null;
  let rpeCtx = null; let restTypeCtx = null; let calMonth = null; let histDay = null; let statsRange = 7; let reportMonth = null;
  let chartState = { metric: 'e1rm', range: 0 }; let pendingHist = null; let detailHist = null;

  /* ---------- helpers ---------- */
  const unit = () => D.settings.units;
  const KG = 0.45359237;
  function conv(w, from, to) { if (w == null || from === to) return w; return from === 'lb' ? w * KG : w / KG; }
  function round(w) { return w == null ? w : Math.round(w * 4) / 4; }
  function fmtNum(n) { if (n == null || n === '') return ''; const r = Math.round(n * 100) / 100; return String(r); }
  function fmtW(w, from) { if (w == null) return '–'; return fmtNum(round(conv(w, from || unit(), unit()))); }
  function e1rm(w, r) { if (!w || !r) return 0; return r === 1 ? w : w * (1 + r / 30); }
  function fmtDur(sec) { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`; }
  function fmtClock(sec) { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }
  function fmtDate(iso, withTime) { const d = new Date(iso); const o = { weekday: 'short', month: 'short', day: 'numeric' }; if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric'; let s = d.toLocaleDateString(undefined, o); if (withTime) s += ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); return s; }
  function repsLow(reps) { const m = String(reps || '').match(/\d+/); return m ? parseInt(m[0], 10) : null; }
  const norm = (n) => String(n || '').trim().toLowerCase();
  function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms); }
  function download(name, text, type = 'application/json') {
    const blob = text instanceof Blob ? text : new Blob([text], { type }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'program';
  const activeProgram = () => D.programs.find((p) => p.id === D.settings.activeProgramId) || D.programs[0] || null;
  // effective rest for an exercise target: Settings default overrides when "Use default rest for all exercises" is on
  // per-exercise preferences (progression, pinned note, rest overrides), keyed by normalized exercise name
  const pref = (name) => (D.exprefs && D.exprefs[norm(name)]) || {};
  function setPref(name, patch) {
    const k = norm(name); const v = { ...(D.exprefs[k] || {}), ...patch };
    Object.keys(v).forEach((x) => { if (v[x] === null || v[x] === undefined || v[x] === '') delete v[x]; });
    if (Object.keys(v).length) D.exprefs[k] = v; else delete D.exprefs[k];
    return S.saveNow('exprefs');
  }
  // working-set rest: exercise override > Settings default (when "use default for all") > program rest > default
  function restFor(t, name) { const o = name ? pref(name).restWork : null; if (o != null) return o; const d = D.settings.defaultRest || 90; return D.settings.useDefaultRestAll ? d : (t.restSeconds || d); }
  // warm-up rest: exercise override > program warm-up rest > Settings warm-up rest (never longer than the working rest)
  function warmRestFor(t, name) { const o = name ? pref(name).restWarm : null; if (o != null) return o; if (!D.settings.useDefaultRestAll && t.restWarmupSeconds) return t.restWarmupSeconds; return Math.min(D.settings.restWarmup ?? 60, restFor(t, name)); }
  function parseRestInput(v) { v = String(v ?? '').trim(); if (v === '') return null; if (/^0+(:00)?$/.test(v)) return 0; const n = L.parseRest(v); return n == null ? NaN : Math.min(1800, n); }
  function targetLine(t, name) {
    const bits = [];
    if (t.superset) bits.push(`<span class="pill ss">Superset ${esc(t.superset)}</span>`);
    if (t.warmupSets) bits.push(`<span class="pill warn">${t.warmupSets} warm-up</span>`);
    bits.push(`<span class="pill acc">${t.workingSets} × ${esc(t.reps || '?')}</span>`);
    if (t.rpe) bits.push(`<span class="pill">RPE ${esc(t.rpe)}</span>`);
    if (t.rir) bits.push(`<span class="pill">RIR ${esc(t.rir)}</span>`);
    if (t.load) bits.push(`<span class="pill">${esc(t.load)}</span>`);
    if (t.tracking === 'time') bits.push('<span class="pill">timed</span>');
    const ov = name && pref(name).restWork != null; bits.push(`<span class="pill ${name ? 'tap' : ''}" ${name ? 'data-act="ex-rest"' : ''}>⏱ ${fmtClock(restFor(t, name))}${ov ? ' ✎' : ''}</span>`);
    if (t.technique) bits.push(`<span class="pill good">${esc(t.technique)}</span>`);
    return bits.join('');
  }

  /* bodyweight / timed-hold helpers */
  const isTime = (ex) => (ex.tracking || (ex.target && ex.target.tracking)) === 'time';
  const isBW = (ex) => !!(ex.bodyweight || (ex.target && ex.target.bodyweight));
  function libFor(ex) { if (!ex) return null; return LIB.find(ex.name, ex.libraryId || (ex.target && ex.target.libraryId)); }
  function trackingFor(t, l) {
    if (t.tracking === 'time' || t.tracking === 'reps') return t.tracking;
    if (/^\s*~?\d+(\s*[-–]\s*\d+)?\s*(s|sec|secs|seconds)\b/i.test(t.reps || '')) return 'time';
    if (/\d/.test(t.reps || '')) return 'reps';
    return l && l.tracking === 'time' ? 'time' : 'reps';
  }
  function applyLib(ex) { // (re)derive library link, tracking and bodyweight for a session exercise
    const l = LIB.find(ex.name, ex.name === ex.origName ? ex.target.libraryId : null);
    ex.libraryId = l ? l.id : null;
    ex.tracking = ex.name === ex.origName ? trackingFor(ex.target, l) : (l && l.tracking === 'time' ? 'time' : 'reps');
    ex.bodyweight = ex.name === ex.origName && ex.target.bodyweight != null ? !!ex.target.bodyweight : !!(l && l.equipment === 'bodyweight');
    return ex;
  }
  function wTxt(ex, w) { if (isBW(ex)) return w ? `BW+${fmtNum(w)}` : 'BW'; return fmtNum(w) || '0'; }
  function setTxt(ex, s, w) { return isTime(ex) ? `${isBW(ex) && !w ? '' : wTxt(ex, w) + ' · '}${s.reps ?? '–'} s` : `${wTxt(ex, w)}×${s.reps ?? '–'}`; }
  function histSetTxt(ex, s, from) { // with units, for history views
    const w = s.weight == null ? null : round(conv(s.weight, from, unit()));
    const wt = isBW(ex) ? (w ? `BW+${fmtNum(w)} ${unit()}` : 'BW') : `${fmtNum(w) || 0} ${unit()}`;
    return (isTime(ex) ? `${wt} · ${s.reps ?? '–'} s` : `${wt} × ${s.reps ?? '–'}`) + rpeSuffix(s);
  }
  const rpeTxt = (v) => (D.settings.effortScale === 'rir' ? fmtNum(10 - v) : fmtNum(v));
  function rpeSuffix(s) { if (s.rpe == null) return ''; return D.settings.effortScale === 'rir' ? ` · RIR ${fmtNum(10 - s.rpe)}` : ` @${fmtNum(s.rpe)}`; }
  function tagPill(e, s, i) {
    if (s.type === 'warmup') return '<span class="pill warn">W</span>';
    if (s.tag === 'failure') return '<span class="pill bad" title="to failure">F</span>';
    if (s.tag === 'drop') return '<span class="pill ss" title="drop set">D</span>';
    return `<span class="pill">${e.sets.slice(0, i + 1).filter((x) => x.type === 'working').length}</span>`;
  }
  function equipOf(ex) {
    const l = libFor(ex); if (l && l.equipment) return l.equipment; const n = norm(ex.name);
    if (/dumbbell|\bdb\b/.test(n)) return 'dumbbell'; if (/machine|cable|smith|goblet|kettlebell/.test(n)) return 'other';
    if (/barbell|squat|deadlift|bench press|overhead press|\bohp\b|\brdl\b|row/.test(n)) return 'barbell'; return 'other';
  }
  const usesBar = (ex) => !isBW(ex) && !isTime(ex) && ['barbell', 'ez bar'].includes(equipOf(ex));
  const plateCfg = (u) => (u === 'kg' ? { bar: D.settings.barKg ?? 20, plates: D.settings.platesKg } : { bar: D.settings.barLb ?? 45, plates: D.settings.platesLb });
  function platesHTML(total, u) {
    const cfg = plateCfg(u); total = parseFloat(String(total ?? '').replace(',', '.'));
    if (!(total > 0)) return `<div class="plates mute small">Enter a weight to see the plates (bar ${fmtNum(cfg.bar)} ${u}).</div>`;
    const r = X.plates(total, cfg.bar, cfg.plates);
    if (r.belowBar) return `<div class="plates small mute" data-exact="0">Less than the empty bar (${fmtNum(cfg.bar)} ${u}).</div>`;
    if (r.exact) return `<div class="plates" data-exact="1"><div class="row"><b class="grow" id="plate-line">Per side: ${r.perSide.length ? r.perSide.map(fmtNum).join(' + ') : 'empty bar'}</b><span class="tiny mute">${fmtNum(cfg.bar)} ${u} bar</span></div>${X.plateSVG(r.perSide, u)}</div>`;
    return `<div class="plates" data-exact="0"><div class="warnbox" id="plate-line">Can't load ${fmtNum(total)} ${u} exactly with your plates. Closest:</div>
      <div class="row wrap" style="margin-top:6px">${[r.lower, r.upper].filter(Boolean).map((o) => `<button class="btn sm" data-act="plate-use" data-v="${o.total}">${fmtNum(o.total)} ${u} <span class="tiny mute">(${o.perSide.map(fmtNum).join('+') || 'bar'})</span></button>`).join('')}</div></div>`;
  }

  function linkify(text) {
    return esc(text).replace(/https?:\/\/[^\s;),]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</a>`);
  }
  function scheduleHTML(p) {
    if (!p.schedule || !p.schedule.length) return '';
    return `<div class="sched">${p.schedule.map((d, i) => `<span class="pill ${/^rest|^off/i.test(d) ? 'dim' : ''}">${i + 1}. ${esc(d)}</span>`).join('')}</div>`;
  }
  function sourcesHTML(p) {
    const urls = String(p.source || '').split(/;\s*|\s+(?=https?:)/).map((x) => x.trim()).filter((x) => /^https?:/.test(x));
    if (!urls.length) return '';
    return `<div class="sources"><div class="mute tiny">SOURCES</div>${urls.map((u) => `<div class="small">${linkify(u)}</div>`).join('')}</div>`;
  }

  /* ---------- history lookups ---------- */
  function finished() { return D.workouts; } // newest first
  function lastPerformance(name, excludeId) {
    const n = norm(name);
    for (const w of finished()) {
      if (w.id === excludeId) continue;
      const ex = w.exercises.find((e) => norm(e.name) === n);
      if (ex && ex.sets.some((s) => s.done)) return { workout: w, ex };
    }
    return null;
  }
  function flatDays(p) { const out = []; p.weeks.forEach((w, wi) => w.days.forEach((d, di) => out.push([wi, di]))); return out; }
  function nextDay(p) {
    const flat = flatDays(p); if (!flat.length) return null;
    const last = finished().find((w) => w.programId === p.id);
    if (!last) return flat[0];
    const i = flat.findIndex(([a, b]) => a === last.weekIdx && b === last.dayIdx);
    return flat[(i + 1) % flat.length] || flat[0];
  }
  function doneDays(p) { const s = new Set(); finished().forEach((w) => { if (w.programId === p.id) s.add(`${w.weekIdx}-${w.dayIdx}`); }); return s; }

  /* ---------- workout session ---------- */
  function makeExercise(t) {
    const target = { warmupSets: 0, workingSets: 3, reps: '', rpe: '', rir: '', technique: '', load: '', rest: '', restSeconds: null, notes: '', substitutions: [], ...t };
    const sets = [];
    for (let i = 0; i < target.warmupSets; i++) sets.push({ type: 'warmup', weight: null, reps: null, done: false });
    for (let i = 0; i < target.workingSets; i++) sets.push({ type: 'working', weight: null, reps: null, done: false });
    return applyLib({ uid: uid(), exId: t.id || null, name: t.name, origName: t.name, target, notes: '', sets });
  }
  function startWorkout(p, wi, di, opts = {}) {
    if (D.current && !confirm('A workout is already in progress. Discard it and start a new one?')) return;
    const day = p ? p.weeks[wi].days[di] : null;
    D.current = {
      id: uid(), programId: p ? p.id : null, programName: p ? p.name : '', weekIdx: p ? wi : null, dayIdx: p ? di : null,
      weekName: p ? p.weeks[wi].name : '', dayName: day ? day.name : 'Workout', dayNotes: day ? day.notes : '',
      startedAt: new Date().toISOString(), unit: unit(), notes: '', rest: null,
      exercises: day ? day.exercises.map(makeExercise) : []
    };
    if (opts.backdate) { const [y, m, d] = opts.backdate.split('-').map(Number); D.current.startedAt = new Date(y, m - 1, d, 12, 0).toISOString(); D.current.backdated = true; D.current.realStart = new Date().toISOString(); }
    sessionScroll = 0; S.saveNow('current'); go('#/session');
  }
  function placeholders(ex, si, last) {
    const set = ex.sets[si];
    const lastSets = last ? last.ex.sets.filter((s) => s.done && s.type === set.type) : [];
    const idx = ex.sets.slice(0, si).filter((s) => s.type === set.type).length;
    const prev = lastSets[idx] || null;
    let w = prev ? round(conv(prev.weight, last.workout.unit, D.current.unit)) : null;
    let r = prev ? prev.reps : null;
    for (let j = si - 1; j >= 0 && w == null; j--) if (ex.sets[j].type === set.type && ex.sets[j].weight != null) w = ex.sets[j].weight;
    if (r == null && set.type === 'working') r = repsLow(ex.target.reps);
    let sugg = false;
    if (set.type === 'working' && set.tag === 'drop') { // drop set: ~20% lighter than the set before it
      const before = ex.sets[si - 1]; const bw = before ? (before.weight ?? placeholders(ex, si - 1, last).w) : null;
      if (bw) { const st = D.current.unit === 'kg' ? 2.5 : 5; w = Math.max(0, Math.round((bw * 0.8) / st) * st); }
    } else if (set.type === 'working' && D.settings.autoFillSuggestion) {
      const sg = suggestionFor(ex);
      if (sg) { const k = ex.sets.slice(0, si).filter((x) => x.type === 'working' && x.tag !== 'drop').length; const j = Math.min(k, sg.w.length - 1); w = sg.w[j]; r = sg.r[j]; sugg = true; }
    }
    return { w, r, prev, prevUnit: last ? last.workout.unit : null, sugg };
  }
  /* progressive overload: suggestion for the next session from recent history (see LTX.suggest) */
  function progSessions(ex, u) {
    const n = norm(ex.name); const out = [];
    for (const w of finished()) {
      const e = w.exercises.find((x) => norm(x.name) === n); if (!e) continue;
      const sets = e.sets.filter((x) => x.done !== false && x.type === 'working' && x.tag !== 'drop' && x.reps != null).map((x) => ({ weight: round(conv(x.weight || 0, w.unit, u)), reps: x.reps, rpe: x.rpe ?? null }));
      if (sets.length) out.push({ sets, at: w.startedAt }); if (out.length >= 6) break;
    }
    return out;
  }
  const suggCache = new Map();
  function suggestionFor(ex, u) {
    if (!D.settings.progression) return null;
    u = u || (D.current ? D.current.unit : unit()); const pr = pref(ex.name); if (pr.mode === 'off') return null;
    const planned = ex.sets ? ex.sets.filter((x) => x.type === 'working' && x.tag !== 'drop').length : (ex.target && ex.target.workingSets);
    const key = [ex.name, u, D.workouts.length, D.workouts[0] && D.workouts[0].id, JSON.stringify(pr), ex.target && ex.target.reps, planned].join('|');
    if (suggCache.has(key)) return suggCache.get(key);
    const inc = pr.inc ? round(conv(pr.inc, pr.incUnit || u, u)) : X.defaultIncrement(u, equipOf(ex));
    const sg = X.suggest(progSessions(ex, u), { reps: ex.target ? ex.target.reps : '', planned: planned || 3, inc, mode: pr.mode || 'auto', deload: pr.deload ?? 10, bw: isBW(ex), time: isTime(ex) });
    if (sg) sg.inc = inc;
    if (suggCache.size > 300) suggCache.clear(); suggCache.set(key, sg); return sg;
  }
  function suggTxt(ex, sg, u) {
    const one = (w, r) => (isTime(ex) ? `${isBW(ex) && !w ? '' : wTxt(ex, w) + ' · '}${r} s` : `${isBW(ex) ? wTxt(ex, w) : fmtNum(w) + ' ' + u} × ${r}`);
    const same = sg.w.every((w) => w === sg.w[0]) && sg.r.every((r) => r === sg.r[0]);
    return same ? `${sg.w.length} × ${one(sg.w[0], sg.r[0])}` : sg.w.map((w, i) => one(w, sg.r[i])).join(', ');
  }
  function renderSetRow(ex, ei, si, last) {
    const s = ex.sets[si]; const ph = placeholders(ex, si, last);
    const n = s.type === 'warmup' ? 'W' : ex.sets.slice(0, si + 1).filter((x) => x.type === 'working').length;
    const prevTxt = ph.prev ? setTxt(ex, ph.prev, round(conv(ph.prev.weight, ph.prevUnit, D.current.unit))) : '–';
    const bw = isBW(ex); const wLabel = s.weight == null ? (ph.w != null ? (bw ? wTxt(ex, ph.w) : fmtNum(ph.w)) : (bw ? 'BW' : '—')) : (bw ? wTxt(ex, s.weight) : fmtNum(s.weight));
    const tag = s.type === 'warmup' ? 'w' : s.tag === 'failure' ? 'f' : s.tag === 'drop' ? 'd' : '';
    const label = s.type === 'warmup' ? 'W' : s.tag === 'failure' ? 'F' : s.tag === 'drop' ? 'D' : n;
    const sugW = s.weight == null && ph.sugg && ph.w != null; const sugR = s.reps == null && ph.sugg && ph.r != null;
    const rpeCell = D.settings.logRpe ? `<td class="rpe-td"><button class="rpebtn ${s.rpe == null ? 'ph' : ''}" data-act="rpe" aria-label="${D.settings.effortScale === 'rir' ? 'RIR' : 'RPE'}">${s.rpe == null ? '–' : rpeTxt(s.rpe)}</button></td>` : '';
    return `<tr class="set ${s.done ? 'done' : ''} ${tag ? 'tag-' + tag : ''}" data-e="${ei}" data-s="${si}">
      <td class="setno ${tag}"><button data-act="set-type" aria-label="set type (tap to change)" title="Tap: normal → warm-up → failure → drop set">${label}</button></td>
      <td class="prev"><button data-act="use-prev" ${ph.prev ? '' : 'disabled'}>${esc(prevTxt)}</button></td>
      <td><button class="wbtn ${s.weight == null ? 'ph' : ''} ${sugW ? 'sug' : ''}" data-act="weight">${esc(wLabel)}</button></td>
      <td><div class="reps"><button data-act="rep-" aria-label="minus rep">−</button><input inputmode="numeric" pattern="[0-9]*" data-act="reps" value="${s.reps ?? ''}" placeholder="${ph.r ?? ''}" class="${sugR ? 'sug' : ''}" aria-label="${isTime(ex) ? 'seconds' : 'reps'}"><button data-act="rep+" aria-label="plus rep">+</button></div></td>
      ${rpeCell}<td><button class="done-btn" data-act="done" aria-label="complete set">✓</button></td></tr>`;
  }
  function renderExercise(ex, ei) {
    const last = lastPerformance(ex.name);
    const t = ex.target;
    const lastTxt = last ? `Last time (${fmtDate(last.workout.startedAt)}): ` + last.ex.sets.filter((s) => s.done && s.type === 'working').map((s) => setTxt(ex, s, round(conv(s.weight, last.workout.unit, D.current.unit)))).join(', ') + (isTime(ex) && isBW(ex) ? '' : ` ${D.current.unit}`) : 'No history yet for this exercise';
    const l = libFor(ex);
    return `<section class="ex ${t.superset ? 'in-ss' : ''}" id="ex-${ei}" data-e="${ei}">
      <div class="ex-head"><div class="grow"><div class="ex-name">${esc(ex.name)}</div>${ex.name !== ex.origName ? `<div class="ex-orig">Swapped from ${esc(ex.origName)}</div>` : ''}</div>
        ${l ? '<button class="btn sm" data-act="ex-info" aria-label="exercise info">ⓘ</button>' : ''}<button class="btn sm" data-act="ex-menu" aria-label="exercise options">⋯</button></div>
      <div class="targets">${targetLine(t, ex.name)}</div>
      ${pref(ex.name).pin ? `<div class="pin-note" data-act="pin-edit" role="button" title="Pinned note (tap to edit)">📌 ${esc(pref(ex.name).pin)}</div>` : ''}
      ${t.notes ? `<div class="ex-notes">${esc(t.notes)}</div>` : ''}
      ${t.substitutions && t.substitutions.length ? `<div class="last">Subs: ${t.substitutions.map(esc).join(' · ')}</div>` : ''}
      <div class="last lasttime">${esc(lastTxt)}</div>
      ${suggLine(ex)}
      <table class="sets"><thead><tr><th>Set</th><th>Prev</th><th>${isBW(ex) ? '+' + esc(D.current.unit) : esc(D.current.unit)}</th><th>${isTime(ex) ? 'Secs' : 'Reps'}</th>${D.settings.logRpe ? `<th>${D.settings.effortScale === 'rir' ? 'RIR' : 'RPE'}</th>` : ''}<th>✓</th></tr></thead>
      <tbody>${ex.sets.map((_, si) => renderSetRow(ex, ei, si, last)).join('')}</tbody></table>
      <div class="ex-actions"><button class="btn sm" data-act="add-set">+ Add set</button><button class="btn sm" data-act="rm-set" ${ex.sets.length ? '' : 'disabled'}>− Remove set</button></div>
      <textarea rows="2" data-act="ex-notes" placeholder="Notes for ${esc(ex.name)}…">${esc(ex.notes)}</textarea>
    </section>`;
  }
  function suggLine(ex) {
    const sg = suggestionFor(ex); if (!sg) return '';
    const auto = D.settings.autoFillSuggestion; const icon = { up: '⬆️', deload: '⬇️', same: '↔️', reps: '➕' }[sg.kind] || '💡';
    return `<div class="sugg-line" data-kind="${sg.kind}"><div class="grow">${icon} <b>Suggested: ${esc(suggTxt(ex, sg, D.current.unit))}</b>
      <div class="tiny">${esc(sg.reason)}${auto ? ' · pre-filled as a <span class="sug-key">suggestion</span> — tap to change' : ''}</div></div>
      ${auto ? '' : '<button class="btn sm" data-act="sugg-use">Use</button>'}</div>`;
  }
  function rerenderEx(ei) { const el = $(`#ex-${ei}`); if (el) el.outerHTML = renderExercise(D.current.exercises[ei], ei); }
  function workoutStats(w) {
    let sets = 0, vol = 0;
    w.exercises.forEach((e) => e.sets.forEach((s) => { if (s.done) { sets++; if (s.type === 'working' && !isTime(e)) vol += (s.weight || 0) * (s.reps || 0); } }));
    return { sets, vol };
  }
  function viewSession() {
    const c = D.current;
    if (!c) { navReplace('#/workout'); route(); return; }
    setTop(`<button class="btn sm" data-act="go" data-to="#/workout">‹</button><h1>${esc(c.dayName)}<div class="sub"><span id="elapsed"></span>${c.weekName ? ' · ' + esc(c.weekName) : ''}<span id="wake-ind"></span></div></h1><button class="btn sm good" data-act="finish">Finish</button>`);
    view.innerHTML = `
      ${c.dayNotes ? `<div class="card small">${esc(c.dayNotes)}</div>` : ''}
      ${c.exercises.map(renderExercise).join('')}
      <button class="btn block" data-act="add-ex">+ Add exercise</button>
      <div class="card" style="margin-top:12px"><h3>Workout notes</h3><textarea rows="3" data-act="w-notes" placeholder="How did it go? Sleep, energy, pain…">${esc(c.notes)}</textarea></div>
      <button class="btn block danger" data-act="discard">Discard workout</button>`;
    tickElapsed();
    if (scrollToEx != null) { const el = $(`#ex-${scrollToEx}`); scrollToEx = null; if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30); }
  }
  function tickElapsed() { const el = $('#elapsed'); if (el && D.current) el.textContent = D.current.backdated ? 'Logging ' + fmtDate(D.current.startedAt) : fmtDur((Date.now() - new Date(D.current.startedAt)) / 1000); }

  function completeSet(ei, si) {
    const ex = D.current.exercises[ei]; const s = ex.sets[si];
    if (s.done) { s.done = false; S.save('current'); rerenderEx(ei); return; }
    const ph = placeholders(ex, si, lastPerformance(ex.name));
    if (s.weight == null && ph.w != null) s.weight = ph.w;
    if (s.reps == null && ph.r != null) s.reps = ph.r;
    if (s.weight == null && isBW(ex)) s.weight = 0;
    if (s.reps == null) { toast(isTime(ex) ? 'Enter seconds first' : 'Enter reps first'); return; }
    s.done = true; s.doneAt = new Date().toISOString();
    const nextEx = D.current.exercises[ei + 1];
    const midSuperset = ex.target.superset && nextEx && nextEx.target.superset === ex.target.superset;
    const nextSet = ex.sets.slice(si + 1).find((x) => !x.done); const dropNext = !!(nextSet && nextSet.tag === 'drop');
    if (midSuperset) toast(`Superset ${ex.target.superset}: go to ${nextEx.name}`);
    else if (dropNext) toast('Drop set next — no rest, strip the weight and go');
    if (D.settings.autoRest && !midSuperset && !dropNext) {
      const sec = s.type === 'warmup' ? warmRestFor(ex.target, ex.name) : restFor(ex.target, ex.name);
      if (sec > 0) startRest(sec, ex.name);
    }
    if (dropNext && D.current.rest) { D.current.rest = null; tickRest(); }
    const pr = setPR(ex, s);
    S.save('current'); rerenderEx(ei);
    if (pr) celebratePR(pr); else window.LTSound.play(ex.sets.every((x) => x.done) ? 'exercise' : 'set');
  }

  /* ---------- live PR detection (per completed working set) ----------
     A weighted working set is a PR only when its weight is STRICTLY heavier than the heaviest weight ever logged for that
     lift in any saved workout (all completed sets, unit-converted) and than this session's earlier working sets. A lift
     never logged with weight: its first weighted working set counts. More reps at the same/lower weight never triggers.
     Timed lifts: longer hold than any saved hold (needs history). Warm-ups never count. */
  function historyBests(name, u) {
    const n = norm(name); const b = { w: 0, hold: 0, had: false };
    D.workouts.forEach((o) => o.exercises.forEach((e) => { if (norm(e.name) !== n) return; e.sets.forEach((x) => { if (!x.done) return; b.w = Math.max(b.w, conv(x.weight, o.unit, u) || 0); if (x.type === 'working') { b.had = true; b.hold = Math.max(b.hold, x.reps || 0); } }); }));
    return b;
  }
  function setPR(ex, s) {
    if (!s.done || s.type !== 'working' || !D.current) return null;
    const u = D.current.unit; const b = historyBests(ex.name, u);
    const others = ex.sets.filter((x) => x !== s && x.done && x.type === 'working');
    if (isTime(ex)) {
      if (!b.had || !b.hold) return null;
      const best = Math.max(b.hold, ...others.map((x) => x.reps || 0));
      return (s.reps || 0) > best ? { exercise: ex.name, type: 'Longest hold', value: `${s.reps} s` } : null;
    }
    if (!s.weight || !s.reps) return null;
    const best = Math.max(b.w, ...others.map((x) => x.weight || 0));
    return s.weight > best + 1e-6 ? { exercise: ex.name, type: 'Heaviest weight', value: `${fmtNum(s.weight)} ${u} × ${s.reps}`, first: !b.w && !others.some((x) => x.weight), prev: best } : null;
  }
  function celebratePR(pr) {
    window.LTSound.play('pr');
    if (D.current) D.current.livePRs = (D.current.livePRs || 0) + 1;
    window.LTApp && (window.LTApp.lastPR = { ...pr, at: Date.now() });
    let el = $('#pr-badge'); if (!el) { el = document.createElement('div'); el.id = 'pr-badge'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    el.innerHTML = `<div class="prb-title">🏆 New PR!</div><div class="prb-lift">${esc(pr.exercise)}</div><div class="prb-val">${esc(pr.type)} · ${esc(pr.value)}${pr.set ? ` <span>(${esc(pr.set)})</span>` : ''}</div>`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(celebratePR.t); celebratePR.t = setTimeout(() => el.classList.remove('show'), 2800);
    confetti();
  }
  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cv = $('#confetti'); if (!cv) { cv = document.createElement('canvas'); cv.id = 'confetti'; document.body.appendChild(cv); }
    const dpr = window.devicePixelRatio || 1; const W = window.innerWidth; const H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); if (!g) return; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = ['#facc15', '#22c55e', '#3b82f6', '#f472b6', '#f97316', '#a855f7'];
    const P = Array.from({ length: 90 }, () => { const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9; const v = 7 + Math.random() * 8; return { x: W / 2, y: H * 0.42, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 5, h: 3 + Math.random() * 4, c: cols[(Math.random() * cols.length) | 0] }; });
    const t0 = performance.now(); cv.classList.add('on'); cancelAnimationFrame(confetti.raf);
    const step = (now) => {
      const k = (now - t0) / 1600; g.clearRect(0, 0, W, H);
      if (k >= 1) { cv.classList.remove('on'); return; }
      P.forEach((p) => { p.vy += 0.32; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; g.save(); g.globalAlpha = Math.min(1, (1 - k) * 2); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); });
      confetti.raf = requestAnimationFrame(step);
    };
    confetti.raf = requestAnimationFrame(step);
  }

  /* ---------- rest timer ---------- */
  let restAlerted = false;
  function startRest(sec, label) { D.current.rest = { endAt: Date.now() + sec * 1000, total: sec, label }; restAlerted = false; S.save('current'); tickRest(); }
  function tickRest() {
    const el = $('#rest-timer'); const r = D.current && D.current.rest;
    if (!r) { el.classList.add('hidden'); el.innerHTML = ''; document.body.classList.remove('has-timer'); return; }
    const left = (r.endAt - Date.now()) / 1000;
    if (left <= 0 && !restAlerted) { restAlerted = true; window.LTSound.play('rest'); }
    if (left < -8) { D.current.rest = null; S.save('current'); return tickRest(); }
    el.classList.remove('hidden'); document.body.classList.add('has-timer');
    el.classList.toggle('over', left <= 0);
    const html = `<div class="rt-time" data-act="rest-type" data-k="timer" role="button" title="Tap to type a rest time">${left > 0 ? fmtClock(left) : 'Go!'}</div><div class="grow small">${left > 0 ? 'Rest' : 'Rest over'}<div class="tiny mute" style="color:#c7d2fe">${esc(r.label || '')}</div></div>
      <button class="btn" data-act="rest-adj" data-d="-15">−15</button><button class="btn" data-act="rest-adj" data-d="15">+15</button><button class="btn" data-act="rest-skip">Skip</button>
      <div class="rt-bar" style="width:${Math.max(0, Math.min(100, (left / r.total) * 100))}%"></div>`;
    el.innerHTML = html;
  }

  /* ---------- finish ---------- */
  function computePRs(w) {
    const prs = [];
    w.exercises.forEach((ex) => {
      if (isTime(ex)) {
        const top = Math.max(0, ...ex.sets.filter((s) => s.done && s.type === 'working').map((s) => s.reps || 0)); if (!top) return;
        let best = 0; const n = norm(ex.name);
        D.workouts.forEach((o) => o.exercises.forEach((e) => { if (norm(e.name) === n) e.sets.forEach((s) => { if (s.done && s.type === 'working') best = Math.max(best, s.reps || 0); }); }));
        if (best && top > best) prs.push({ exercise: ex.name, type: 'Longest hold', value: `${top} s` });
        return;
      }
      const done = ex.sets.filter((s) => s.done && s.type === 'working' && s.weight && s.reps);
      if (!done.length) return;
      const bestW = historyBests(ex.name, w.unit).w; // same rule as the live celebration: strictly heavier than any saved workout
      const topW = Math.max(...done.map((s) => s.weight));
      if (topW > bestW + 1e-6) prs.push({ exercise: ex.name, type: 'Heaviest weight', value: `${fmtNum(topW)} ${w.unit}` });
    });
    return prs;
  }
  function finishWorkout(force) {
    const c = D.current; const undone = c.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
    const doneCount = c.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
    if (!force) {
      const diff = dayDiff(c);
      openSheet(`<h3>Finish workout?</h3><p class="mute">${doneCount} set${doneCount === 1 ? '' : 's'} completed.${undone ? ` ${undone} unchecked set${undone === 1 ? '' : 's'} will be discarded.` : ''}</p>
        ${diff ? `<label class="toggle" for="upd-prog"><span>Update “${esc(diff.d.name)}” in ${esc(diff.p.name)} with today's changes<div class="tiny mute">${esc(diff.summary)}</div></span><input id="upd-prog" type="checkbox" style="width:24px;height:24px;flex:0 0 auto"></label>` : ''}
        <div class="stack"><button class="btn primary block" data-act="finish-confirm">Save workout</button><button class="btn block" data-act="sheet-close">Keep going</button></div>`);
      return;
    }
    const upd = $('#upd-prog') && $('#upd-prog').checked ? dayDiff(c) : null;
    const w = JSON.parse(JSON.stringify(c));
    if (w.backdated) { const real = Math.round((Date.now() - new Date(w.realStart || Date.now())) / 1000); w.durationSec = real >= 15 * 60 && real <= 4 * 3600 ? real : 3600; w.finishedAt = new Date(new Date(w.startedAt).getTime() + w.durationSec * 1000).toISOString(); delete w.realStart; }
    else { w.finishedAt = new Date().toISOString(); w.durationSec = Math.round((new Date(w.finishedAt) - new Date(w.startedAt)) / 1000); }
    w.exercises = w.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) })).filter((e) => e.sets.length || e.notes);
    delete w.rest; delete w.livePRs;
    w.prs = computePRs(w);
    if (upd) applyDayChanges(upd, c);
    D.workouts.unshift(w); D.workouts.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)); D.current = null;
    Promise.all([S.saveNow('workouts'), S.saveNow('current'), upd ? S.saveNow('programs') : null]).then(() => {
      closeSheet(); tickRest(); syncWake(); go('#/history/' + w.id + '/summary');
      window.LTSound.play('finish'); if (w.prs.length && !c.livePRs) setTimeout(() => window.LTSound.play('pr'), 1500); // already celebrated live -> don't repeat
      toast(w.prs.length ? `Workout saved · ${w.prs.length} PR${w.prs.length > 1 ? 's' : ''} 🏆` : 'Workout saved 💪');
    });
  }

  // mid-workout structure changes vs the program day (exercise names/order and working-set counts)
  function dayDiff(c) {
    if (!c || !c.programId) return null; const p = D.programs.find((x) => x.id === c.programId);
    const d = p && p.weeks[c.weekIdx] && p.weeks[c.weekIdx].days[c.dayIdx]; if (!d) return null;
    const now = c.exercises.filter((e) => e.sets.length).map((e) => `${norm(e.name)}|${e.sets.filter((x) => x.type === 'working').length}`);
    const was = d.exercises.map((e) => `${norm(e.name)}|${e.workingSets}`);
    if (now.join('/') === was.join('/')) return null;
    const names = new Set(d.exercises.map((e) => norm(e.name))); const nowNames = new Set(c.exercises.filter((e) => e.sets.length).map((e) => norm(e.name)));
    const added = c.exercises.filter((e) => e.sets.length && !names.has(norm(e.name))).length; const removed = d.exercises.filter((e) => !nowNames.has(norm(e.name))).length;
    const bits = []; if (added) bits.push(`${added} added/swapped`); if (removed) bits.push(`${removed} removed/replaced`); if (!added && !removed) bits.push('set counts or order changed');
    return { p, d, summary: bits.join(', ') };
  }
  function applyDayChanges({ p, d }, c) {
    d.exercises = c.exercises.filter((e) => e.sets.length).map((e) => {
      const orig = d.exercises.find((x) => x.id && x.id === e.exId); const t = JSON.parse(JSON.stringify(orig || e.target));
      if (!t.id) t.id = uid();
      if (norm(t.name) !== norm(e.name)) { t.name = e.name; if (e.libraryId) t.libraryId = e.libraryId; else delete t.libraryId; if (e.tracking === 'time') t.tracking = 'time'; else delete t.tracking; if (e.bodyweight) t.bodyweight = true; else delete t.bodyweight; }
      t.workingSets = Math.max(1, e.sets.filter((x) => x.type === 'working').length);
      return t;
    });
    p.edited = true;
  }

  /* ---------- sheets ---------- */
  /* Sheets are history layers: opening one pushes a same-URL history entry, so the system back button/gesture (Android back,
     iOS edge swipe, browser back) closes the sheet instead of leaving the page underneath (see nav* below). */
  const sheetOpen = () => !$('#sheet').classList.contains('hidden');
  /* overlays (welcome tour, coach-mark tips) are layers too: back closes them. If shown without a recent tap, the
     history entry is added on the next tap (Chrome skips entries added without a user gesture). */
  let overlay = null; let layerPushPending = false;
  const layerOpen = () => sheetOpen() || !!overlay;
  function pushLayerState() { const st = navState(); if (st.lt === 'page') history.pushState({ ...st, lt: 'sheet', idx: st.idx + 1 }, '', location.href); else if (st.lt === 'dead') history.replaceState({ ...st, lt: 'sheet' }, '', location.href); navSync(); }
  function openOverlay(o) {
    if (overlay) closeOverlay(); overlay = o;
    const ua = navigator.userActivation; if (!ua || ua.isActive) pushLayerState(); else layerPushPending = true;
  }
  function closeOverlay() { // closed in-app
    if (!overlay) return; const o = overlay; overlay = null; o.remove();
    if (layerPushPending) { layerPushPending = false; return; }
    const st = navState(); if (st.lt === 'sheet' && !sheetOpen()) { history.replaceState({ ...st, lt: 'dead' }, '', location.href); navSync(); }
  }
  function hideLayer() { if (overlay) { const o = overlay; overlay = null; layerPushPending = false; o.remove(); } if (sheetOpen()) hideSheet(); } // closed by back
  function hideSheet() { $('#sheet').classList.add('hidden'); $('#sheet-backdrop').classList.add('hidden'); $('#sheet').innerHTML = ''; }
  function openSheet(html) {
    if (overlay) closeOverlay();
    $('#sheet').innerHTML = html; $('#sheet').classList.remove('hidden'); $('#sheet-backdrop').classList.remove('hidden');
    const st = navState(); if (st.lt === 'page') history.pushState({ ...st, lt: 'sheet', idx: st.idx + 1 }, '', location.href); else if (st.lt === 'dead') history.replaceState({ ...st, lt: 'sheet' }, '', location.href);
    navSync();
  }
  function closeSheet() { // closed in-app (✕, Cancel, backdrop, Escape, an action): the sheet's history entry becomes a no-op entry
    if (sheetOpen()) hideSheet();
    const st = navState(); if (st.lt === 'sheet' && !overlay) { history.replaceState({ ...st, lt: 'dead' }, '', location.href); navSync(); }
  }
  let weightCtx = null;
  function openWeightSheet(ei, si) {
    const ex = D.current.exercises[ei]; const s = ex.sets[si]; const ph = placeholders(ex, si, lastPerformance(ex.name));
    weightCtx = { ei, si };
    const steps = D.current.unit === 'kg' ? [-5, -2.5, -1.25, 1.25, 2.5, 5, 10, 20] : [-10, -5, -2.5, 2.5, 5, 10, 25, 45];
    const v = s.weight ?? ph.w ?? '';
    const bw = isBW(ex);
    openSheet(`<h3>${esc(ex.name)} · set ${si + 1}${bw ? ' · added weight' : ''}</h3>
      <input id="wval" class="bigval" inputmode="decimal" value="${v === '' ? '' : fmtNum(v)}" placeholder="0" aria-label="weight">
      <div class="tiny mute" style="text-align:center;margin-top:4px">${bw ? 'bodyweight + ' : ''}${esc(D.current.unit)}${ph.prev ? ` · last time ${esc(setTxt(ex, ph.prev, round(conv(ph.prev.weight, ph.prevUnit, D.current.unit))))}` : ''}</div>
      ${ph.sugg && ph.w != null ? `<div class="tiny" style="text-align:center;margin-top:4px;color:#93c5fd">💡 Suggested ${esc(bw ? wTxt(ex, ph.w) : fmtNum(ph.w) + ' ' + D.current.unit)}${ph.r != null ? ' × ' + ph.r : ''}</div>` : ''}
      <div class="chips">${steps.map((d) => `<button data-act="wstep" data-d="${d}">${d > 0 ? '+' : ''}${d}</button>`).join('')}</div>
      ${usesBar(ex) ? `<div id="plates-box">${platesHTML(v, D.current.unit)}</div>` : `<button class="btn sm ghost" data-act="plates-show" style="margin-bottom:8px">🏋️ Plate calculator</button><div id="plates-box"></div>`}
      <div class="stack"><button class="btn primary block" data-act="wsave">Done</button>
      <button class="btn block" data-act="wsave" data-fill="1">Done &amp; use for remaining sets</button>
      <button class="btn block" data-act="wsave" data-bw="1">${bw ? 'Bodyweight only (BW)' : 'Bodyweight (0)'}</button></div>`);
    setTimeout(() => { const i = $('#wval'); if (i) { i.focus(); i.select(); } }, 50);
  }
  function exMenu(ei) {
    const ex = D.current.exercises[ei]; const subs = ex.target.substitutions || [];
    const opts = [ex.origName, ...subs].filter((n, i, a) => n && n !== ex.name && a.indexOf(n) === i);
    openSheet(`<h3>${esc(ex.name)}</h3>
      ${opts.length ? `<div class="mute small">Swap exercise</div>${opts.map((n) => `<button class="list-item" data-act="swap" data-e="${ei}" data-name="${esc(n)}">🔁 ${esc(n)}</button>`).join('')}` : ''}
      <button class="list-item" data-act="ex-replace" data-e="${ei}">📚 Replace with a library exercise <span class="tiny mute">(keeps logged sets)</span></button>
      <button class="list-item" data-act="swap-custom" data-e="${ei}">✏️ Swap to another exercise (type a name)…</button>
      ${isBW(ex) || isTime(ex) ? '' : `<button class="list-item" data-act="ex-warmup" data-e="${ei}">🔥 Add warm-up sets <span class="tiny mute">(${esc(X.rampText(D.settings.warmupRamp))})</span></button>`}
      <button class="list-item" data-act="pin-edit" data-e="${ei}" data-name="${esc(ex.name)}">📌 ${pref(ex.name).pin ? 'Edit pinned note' : 'Pin a note (shows every session)'}</button>
      <button class="list-item" data-act="ex-prefs" data-e="${ei}" data-name="${esc(ex.name)}">⚙️ Progression &amp; rest for this exercise</button>
      <button class="list-item" data-act="ex-history" data-name="${esc(ex.name)}">📈 View history &amp; exercise info</button>
      <div class="row"><button class="btn grow" data-act="ex-move" data-e="${ei}" data-d="-1">↑ Move up</button><button class="btn grow" data-act="ex-move" data-e="${ei}" data-d="1">↓ Move down</button></div>
      <button class="btn block danger" style="margin-top:10px" data-act="ex-remove" data-e="${ei}">Remove exercise</button>`);
  }

  /* ---------- views ---------- */
  function setTop(html) { topbar.innerHTML = html; }
  function viewWorkout() {
    const p = activeProgram(); const c = D.current;
    setTop(`<h1>Workout</h1>`);
    let html = '';
    if (c) html += `<div class="card" style="border:1px solid var(--accent)"><div class="row"><div class="grow"><h3>In progress: ${esc(c.dayName)}</h3><div class="mute small">${esc(c.programName)} ${c.weekName ? '· ' + esc(c.weekName) : ''} · started ${fmtDate(c.startedAt, true)}</div></div></div><button class="btn primary block" style="margin-top:10px" data-act="go" data-to="#/session">Resume workout</button></div>`;
    if (!p) {
      html += `<div class="card empty"><h2>No program yet</h2><p>Import your program or load the sample to get started.</p>
        <div class="stack"><button class="btn primary block" data-act="load-sample">Load "Example PPL (sample)"</button><button class="btn block" data-act="go" data-to="#/programs">Import a program</button><button class="btn block" data-act="start-empty">Start empty workout</button></div></div>`;
      view.innerHTML = html; return;
    }
    const nd = nextDay(p); const done = doneDays(p);
    if (selectedWeek == null || selectedWeek >= p.weeks.length) selectedWeek = nd ? nd[0] : 0;
    const nday = nd ? p.weeks[nd[0]].days[nd[1]] : null;
    html += `<div class="card"><div class="row"><div class="grow"><div class="mute tiny">ACTIVE PROGRAM</div><h3 style="margin:0">${esc(p.name)}</h3></div>
      ${D.programs.length > 1 ? `<select data-act="pick-program" style="width:auto;max-width:45%">${D.programs.map((x) => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}</div>
      ${p.schedule && p.schedule.length ? `<div class="mute tiny" style="margin-top:10px">WEEKLY ORDER</div>${scheduleHTML(p)}` : ''}
      ${nday ? `<div style="margin-top:12px" class="mute small">Up next</div><h2 style="margin:2px 0 4px">${esc(nday.name)} <span class="mute small">· ${esc(p.weeks[nd[0]].name)}</span></h2>
      <div class="mute small">${nday.exercises.length} exercises · ${nday.exercises.reduce((n, e) => n + e.workingSets, 0)} working sets</div>
      <button class="btn primary block" style="margin-top:12px" data-act="start" data-w="${nd[0]}" data-d="${nd[1]}">Start ${esc(nday.name)}</button>` : ''}</div>`;
    html += `<div class="card"><h3>Choose a day</h3><div class="seg">${p.weeks.map((w, i) => `<button class="${i === selectedWeek ? 'on' : ''}" data-act="week" data-w="${i}">${esc(w.name)}</button>`).join('')}</div>
      ${p.weeks[selectedWeek].notes ? `<div class="mute small" style="margin-top:8px">${esc(p.weeks[selectedWeek].notes)}</div>` : ''}
      <div class="daylist">${p.weeks[selectedWeek].days.map((d, di) => {
        const isNext = nd && nd[0] === selectedWeek && nd[1] === di; const isDone = done.has(`${selectedWeek}-${di}`);
        return `<button class="day ${isNext ? 'next' : ''}" data-act="day-preview" data-w="${selectedWeek}" data-d="${di}"><span class="check-dot ${isDone ? 'done' : ''}">${isDone ? '✓' : ''}</span><span class="grow"><span class="dn">${esc(d.name)}</span>${isNext ? ' <span class="pill acc">next</span>' : ''}<br><span class="mute small">${d.exercises.map((e) => esc(e.name)).slice(0, 3).join(', ')}${d.exercises.length > 3 ? ` +${d.exercises.length - 3}` : ''}</span></span><span class="mute">›</span></button>`;
      }).join('')}</div></div>
      <button class="btn block" data-act="start-empty">Start empty workout</button>`;
    view.innerHTML = html;
  }
  function dayPreview(wi, di) {
    const p = activeProgram(); const d = p.weeks[wi].days[di];
    openSheet(`<h3>${esc(d.name)} <span class="mute small">· ${esc(p.weeks[wi].name)}</span></h3>${d.notes ? `<p class="mute small">${esc(d.notes)}</p>` : ''}
      ${d.exercises.map((e) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(e.name)}</b>${LIB.find(e.name, e.libraryId) ? ` <button class="btn sm ghost" data-act="info-name" data-name="${esc(e.name)}" data-id="${esc(e.libraryId || '')}" aria-label="exercise info">ⓘ</button>` : ''}<div>${targetLine(e)}</div>${e.notes ? `<div class="small mute">${esc(e.notes)}</div>` : ''}</div>`).join('')}
      <button class="btn primary block" style="margin-top:12px" data-act="start" data-w="${wi}" data-d="${di}">Start workout</button>`);
  }

  function historyRow(w) {
    const st = workoutStats(w);
    return `<button class="list-item" data-act="go" data-to="#/history/${w.id}"><div class="grow"><b>${esc(w.dayName)}</b> ${w.prs && w.prs.length ? `<span class="pr">🏆 ${w.prs.length}</span>` : ''}${w.imported ? ` <span class="pill dim">${esc(w.imported)}</span>` : ''}<div class="mute small">${fmtDate(w.startedAt, true)}${w.programName ? ' · ' + esc(w.programName) : ''}${w.weekName ? ' · ' + esc(w.weekName) : ''}</div>
        <div class="small" style="margin-top:4px">${fmtDur(w.durationSec || 0)} · ${st.sets} sets · ${fmtNum(Math.round(conv(st.vol, w.unit, unit())))} ${unit()} volume</div></div><span class="mute">›</span></button>`;
  }
  function streakHTML() {
    const sk = X.streak(D.workouts.map((w) => new Date(w.startedAt)), new Date()); const goal = D.settings.weeklyGoal || 3;
    return `<div class="streak"><span class="flame">🔥</span><div class="grow"><b><span id="streak-weeks">${sk.weeks}</span>-week streak</b><div class="tiny mute">Weeks (Mon–Sun) with at least one workout</div></div>
      <div style="text-align:right"><b id="week-count">${sk.thisWeek}/${goal}</b><div class="tiny mute">this week</div></div></div>
      <div class="goalbar"><div style="width:${Math.min(100, (sk.thisWeek / goal) * 100)}%"></div></div>`;
  }
  function calendarHTML() {
    const now = new Date(); if (!calMonth) calMonth = { y: now.getFullYear(), m: now.getMonth() };
    const byDay = new Map(); D.workouts.forEach((w) => { const k = X.dayKey(w.startedAt); byDay.set(k, (byDay.get(k) || 0) + 1); });
    const today = X.dayKey(now); const cells = X.monthGrid(calMonth.y, calMonth.m);
    const title = new Date(calMonth.y, calMonth.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const inMonth = D.workouts.filter((w) => { const d = new Date(w.startedAt); return d.getFullYear() === calMonth.y && d.getMonth() === calMonth.m; }).length;
    return `<div class="cal"><div class="row"><button class="btn sm" data-act="cal-nav" data-d="-1" aria-label="previous month">‹</button><b class="grow" style="text-align:center" id="cal-title">${esc(title)} <span class="mute small">· ${inMonth} workout${inMonth === 1 ? '' : 's'}</span></b><button class="btn sm" data-act="cal-nav" data-d="1" aria-label="next month">›</button></div>
      <div class="cal-grid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<div class="cal-h">${d}</div>`).join('')}
      ${cells.map((d) => { if (!d) return '<div></div>'; const k = X.dayKey(d); const n = byDay.get(k) || 0;
        return `<button class="cal-day ${n ? 'has' : ''} ${k === today ? 'today' : ''} ${k > today ? 'future' : ''} ${histDay === k ? 'sel' : ''}" data-act="cal-day" data-k="${k}" ${k > today && !n ? 'disabled' : ''} aria-label="${k}${n ? ', ' + n + ' workout' + (n > 1 ? 's' : '') : ''}">${d.getDate()}${n ? `<i>${n > 1 ? n : ''}</i>` : ''}</button>`; }).join('')}</div>
      <div class="tiny mute" style="margin-top:6px">Tap a day to open it, or an empty past day to log a workout you forgot.</div></div>`;
  }
  function viewHistory() {
    setTop('<h1>History</h1><button class="btn sm" data-act="go" data-to="#/stats">📊 Stats</button>');
    let html = `<div class="card">${streakHTML()}${calendarHTML()}</div>`;
    if (!D.workouts.length) { view.innerHTML = html + `<div class="empty"><h2>No workouts yet</h2><p>Finished workouts show up here.</p><button class="btn" data-act="pick-file" data-kind="history">Import Strong / Hevy CSV</button></div>`; return; }
    const list = histDay ? D.workouts.filter((w) => X.dayKey(w.startedAt) === histDay) : D.workouts;
    if (histDay) html += `<div class="row" style="margin:0 2px 8px"><b class="grow">${fmtDate(histDay + 'T12:00')}</b><button class="btn sm ghost" data-act="cal-all">Show all</button></div>`;
    view.innerHTML = html + list.map(historyRow).join('');
  }
  function backdateSheet(k) {
    const p = activeProgram(); const opts = p ? flatDays(p).map(([wi, di]) => `<option value="${wi}/${di}">${esc(p.weeks[wi].days[di].name)}${p.weeks.length > 1 ? ' · ' + esc(p.weeks[wi].name) : ''}</option>`).join('') : '';
    openSheet(`<h3>Log a past workout</h3><p class="mute small">${esc(fmtDate(k + 'T12:00'))} — nothing logged that day. Log it now; it's saved on that date (duration 1 h unless you take longer).</p>
      <label class="lbl" for="bd-day">Workout</label><select id="bd-day">${opts}<option value="">Empty workout</option></select>
      <button class="btn primary block" style="margin-top:12px" data-act="backdate-start" data-k="${k}">Start logging</button><button class="btn block" style="margin-top:8px" data-act="sheet-close">Cancel</button>`);
  }
  function bestSetOf(e, u, from) { // best working set by e1RM (or longest hold / most reps)
    const ws = e.sets.filter((x) => x.done !== false && x.type === 'working'); if (!ws.length) return null;
    const val = (x) => (isTime(e) ? x.reps || 0 : x.weight ? e1rm(conv(x.weight, from, u), x.reps) : (x.reps || 0) / 1000);
    return ws.reduce((a, x) => (val(x) > val(a) ? x : a), ws[0]);
  }
  function exVolume(e, from, u) { return isTime(e) ? 0 : e.sets.filter((x) => x.done !== false && x.type === 'working').reduce((n, x) => n + conv(x.weight || 0, from, u) * (x.reps || 0), 0); }
  function prevSession(name, before) {
    const n = norm(name);
    for (const w of D.workouts) { if (w.startedAt >= before) continue; const e = w.exercises.find((x) => norm(x.name) === n); if (e && e.sets.some((x) => x.done !== false && x.type === 'working')) return { w, e }; }
    return null;
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const deltaHTML = (d) => (d == null ? '<span class="mute">new</span>' : `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'mute'}">${d > 0 ? '+' : ''}${d}%</span>`);
  function summaryHTML(w) {
    const u = unit(); const sk = X.streak(D.workouts.map((x) => new Date(x.startedAt)), new Date()); const goal = D.settings.weeklyGoal || 3;
    const prevVol = D.workouts.filter((x) => x.id !== w.id && x.dayName === w.dayName && x.startedAt < w.startedAt)[0];
    const rows = w.exercises.filter((e) => e.sets.some((x) => x.type === 'working')).map((e) => {
      const best = bestSetOf(e, u, w.unit); const prev = prevSession(e.name, w.startedAt);
      const vol = exVolume(e, w.unit, u); const pvol = prev ? exVolume(prev.e, prev.w.unit, u) : null;
      let d; if (isTime(e) || isBW(e)) { const pb = prev && bestSetOf(prev.e, u, prev.w.unit); d = pb ? pct(best.reps || 0, pb.reps || 0) : null; } else d = prev ? pct(vol, pvol) : null;
      const sg = suggestionFor({ ...e, sets: e.sets, target: e.target || {} }, u);
      return `<tr><td><b>${esc(e.name)}</b>${(w.prs || []).some((p) => p.exercise === e.name) ? ' 🏆' : ''}<div class="tiny mute">${plural(e.sets.filter((x) => x.type === 'working').length, 'set')} · best ${esc(histSetTxt(e, best, w.unit))}</div>${sg ? `<div class="tiny" style="color:#93c5fd">Next: ${esc(suggTxt(e, sg, u))}</div>` : ''}</td><td class="num">${deltaHTML(d)}</td></tr>`;
    }).join('');
    const st = workoutStats(w); const pst = prevVol ? workoutStats(prevVol) : null;
    return `<div class="card summary" id="summary"><div class="celebrate">🎉</div><h2 style="text-align:center;margin:0">Workout complete!</h2>
      <p class="mute small" style="text-align:center;margin:4px 0 10px">${esc(w.dayName)} · ${fmtDate(w.startedAt)}${pst ? ` · volume ${deltaHTML(pct(conv(st.vol, w.unit, u), conv(pst.vol, prevVol.unit, u)))} vs last ${esc(w.dayName)}` : ''}</p>
      ${streakHTML()}
      <table class="sumtab"><thead><tr><th>Exercise</th><th class="num">vs last</th></tr></thead><tbody>${rows || '<tr><td class="mute">No working sets</td></tr>'}</tbody></table>
      <div class="row" style="margin-top:12px"><button class="btn primary grow" data-act="share-img" data-id="${w.id}">📤 Share image</button><button class="btn grow" data-act="go" data-to="#/workout">Done</button></div></div>`;
  }
  function viewWorkoutDetail(id, summary) {
    const w = D.workouts.find((x) => x.id === id);
    if (!w) { go('#/history'); return; }
    const st = workoutStats(w);
    setTop(`<button class="btn sm" data-act="go" data-to="#/history">‹</button><h1>${esc(w.dayName)}</h1><button class="btn sm" data-act="share-img" data-id="${w.id}" aria-label="share workout image">📤</button>`);
    view.innerHTML = `${summary ? summaryHTML(w) : ''}<div class="card"><div class="mute small">${fmtDate(w.startedAt, true)}${w.programName ? ' · ' + esc(w.programName) : ''}${w.weekName ? ' · ' + esc(w.weekName) : ''}</div>
      <div class="stats"><div class="stat"><b>${fmtDur(w.durationSec || 0)}</b><span>Duration</span></div><div class="stat"><b>${st.sets}</b><span>Sets</span></div><div class="stat"><b>${fmtNum(Math.round(conv(st.vol, w.unit, unit())))}</b><span>Volume (${unit()})</span></div></div>
      ${w.prs && w.prs.length ? `<div style="margin-top:10px">${w.prs.map((p) => `<div class="pr">🏆 ${esc(p.exercise)}: ${esc(p.type)} ${esc(p.value)}</div>`).join('')}</div>` : ''}
      ${w.notes ? `<div class="ex-notes" style="margin:10px 0 0">${esc(w.notes)}</div>` : ''}</div>
      ${w.exercises.map((e) => `<div class="card"><button class="ex-name" style="text-align:left;padding:0" data-act="ex-history" data-name="${esc(e.name)}">${esc(e.name)}</button>
        <div class="hist-sets">${e.sets.map((s, i) => `<div>${tagPill(e, s, i)} ${esc(histSetTxt(e, s, w.unit))}</div>`).join('') || '<span class="mute">No sets</span>'}</div>
        ${e.notes ? `<div class="ex-notes" style="margin:0">${esc(e.notes)}</div>` : ''}</div>`).join('')}
      <button class="btn block danger" data-act="del-workout" data-id="${w.id}">Delete workout</button>`;
  }
  /* shareable workout image (Web Share API with files, else download) */
  async function shareWorkout(id) {
    const w = D.workouts.find((x) => x.id === id); if (!w) return; const u = unit(); const st = workoutStats(w);
    const lines = w.exercises.filter((e) => e.sets.some((x) => x.type === 'working')).map((e) => { const b = bestSetOf(e, u, w.unit); return [e.name, `${e.sets.filter((x) => x.type === 'working').length} × ${histSetTxt(e, b, w.unit)}`, (w.prs || []).some((p) => p.exercise === e.name)]; });
    const canvas = document.createElement('canvas');
    X.drawShareCard(canvas, { title: w.dayName, sub: `${fmtDate(w.startedAt)}${w.programName ? ' · ' + w.programName : ''}`, stats: [[fmtDur(w.durationSec || 0).replace(/ \d+s$/, ''), 'Duration'], [st.sets, 'Sets'], [fmtNum(Math.round(conv(st.vol, w.unit, u))), `Volume (${u})`]], lines, prs: (w.prs || []).map((p) => p.exercise) });
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const name = `lift-tracker-${slug(w.dayName)}-${w.startedAt.slice(0, 10)}.png`;
    const file = typeof File !== 'undefined' ? new File([blob], name, { type: 'image/png' }) : null;
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `${w.dayName} — Lift Tracker`, text: `${w.dayName}: ${st.sets} sets, ${fmtNum(Math.round(conv(st.vol, w.unit, u)))} ${u}` }); window.LTApp.lastShare = 'share'; return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    download(name, blob, 'image/png'); window.LTApp.lastShare = 'download'; toast('Image saved to downloads');
  }

  function exerciseIndex() {
    const map = new Map();
    D.workouts.forEach((w) => w.exercises.forEach((e) => {
      const k = norm(e.name); if (!map.has(k)) map.set(k, { name: e.name, sessions: [], bestW: 0, bestE: 0, maxReps: 0, bestVol: 0, longest: 0, time: false });
      const m = map.get(k); const done = e.sets.filter((s) => s.done);
      if (!done.length) return;
      m.sessions.push({ w, e }); if (isTime(e)) m.time = true;
      done.filter((s) => s.type === 'working').forEach((s) => {
        if (isTime(e)) { m.longest = Math.max(m.longest, s.reps || 0); return; }
        const wt = conv(s.weight || 0, w.unit, unit());
        m.bestW = Math.max(m.bestW, wt); m.bestE = Math.max(m.bestE, e1rm(wt, s.reps)); m.maxReps = Math.max(m.maxReps, s.reps || 0); m.bestVol = Math.max(m.bestVol, wt * (s.reps || 0));
      });
    }));
    return [...map.values()].filter((m) => m.sessions.length);
  }
  function mergeHistory(list) {
    if (!list.length) return null; if (list.length === 1) return list[0];
    const m = { name: list[0].name, sessions: [], bestW: 0, bestE: 0, maxReps: 0, bestVol: 0, longest: 0, time: false };
    list.forEach((x) => { m.sessions.push(...x.sessions); ['bestW', 'bestE', 'maxReps', 'bestVol', 'longest'].forEach((k) => { m[k] = Math.max(m[k], x[k]); }); m.time = m.time || x.time; });
    m.sessions.sort((a, b) => (a.w.startedAt < b.w.startedAt ? 1 : -1)); return m;
  }

  /* ---------- exercise library ---------- */
  const cap = (s) => String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const ytURL = (name) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name + ' proper form');
  function pickTarget() {
    if (!pickCtx) return null;
    if (pickCtx.mode === 'session') return D.current ? { label: D.current.dayName } : null;
    if (pickCtx.mode === 'replace') { const ex = D.current && D.current.exercises[pickCtx.ei]; return ex ? { label: ex.name, replace: true } : null; }
    const p = D.programs.find((x) => x.id === pickCtx.programId); const d = p && p.weeks[pickCtx.wi] && p.weeks[pickCtx.wi].days[pickCtx.di];
    return d ? { p, d, label: `${d.name} · ${p.name}` } : null;
  }
  function defaultTarget(l) {
    const time = l.tracking === 'time'; const bw = l.equipment === 'bodyweight';
    const t = { id: uid(), name: l.name, libraryId: l.id, warmupSets: 0, workingSets: 3, reps: time ? '30 s' : bw ? '8-15' : '8-12', rpe: '', rir: '', technique: '', load: '', rest: '1:30', restSeconds: 90, notes: '', substitutions: [], superset: '' };
    if (time) t.tracking = 'time'; if (bw) t.bodyweight = true; return t;
  }
  async function addToDay(p, wi, di, l) {
    const d = p.weeks[wi].days[di]; d.exercises.push(defaultTarget(l)); p.edited = true;
    await S.saveNow('programs'); toast(`Added ${l.name} to ${d.name}`);
  }
  async function addFromLibrary(l, stay) {
    const tgt = pickTarget(); if (!tgt) { pickCtx = null; return; }
    if (pickCtx.mode === 'replace') {
      const ei = pickCtx.ei; const ex = D.current.exercises[ei]; const kept = ex.sets.filter((x) => x.done).length; const from = ex.name;
      ex.name = l.name; applyLib(ex); ex.libraryId = l.id; scrollToEx = ei; pickCtx = null;
      await S.saveNow('current'); toast(`Replaced ${from} → ${l.name}${kept ? ` · ${kept} logged set${kept > 1 ? 's' : ''} kept` : ''}`); go('#/session'); return;
    }
    if (pickCtx.mode === 'session') {
      D.current.exercises.push(makeExercise(defaultTarget(l))); scrollToEx = D.current.exercises.length - 1; pickCtx = null;
      await S.saveNow('current'); toast(`Added ${l.name}`); go('#/session'); return;
    }
    await addToDay(tgt.p, pickCtx.wi, pickCtx.di, l);
    if (stay) renderLibResults(); else go('#/exercises');
  }
  function chip(act, val, cur, label) { return `<button class="chip ${val === cur ? 'on' : ''}" data-act="${act}" data-v="${esc(val)}">${esc(label)}</button>`; }
  function viewExercises() {
    const tgt = pickTarget(); if (pickCtx && !tgt) pickCtx = null;
    setTop(pickCtx ? `<button class="btn sm" data-act="pick-done" aria-label="close">✕</button><h1>${tgt.replace ? 'Replace exercise' : 'Add exercise'}<div class="sub">${tgt.replace ? 'replacing' : 'to'} ${esc(tgt.label)}</div></h1>${pickCtx.mode === 'program' ? '<button class="btn sm primary" data-act="pick-done">Done</button>' : ''}` : '<h1>Exercises</h1>');
    view.innerHTML = `<div class="libsearch"><input type="search" id="lib-q" data-act="lib-q" placeholder="Search ${LIB.all.length} exercises — e.g. dumbbell chest" value="${esc(lib.q)}" autocomplete="off" autocapitalize="off" enterkeyhint="search">
      <div class="chiprow" id="eq-chips">${chip('lib-eq', '', lib.eq, 'All equipment')}${LIB.EQUIPMENT.map((e) => chip('lib-eq', e, lib.eq, cap(e))).join('')}</div>
      <div class="chiprow" id="mus-chips">${chip('lib-mus', '', lib.mus, 'All muscles')}${LIB.MUSCLES.map((m) => chip('lib-mus', m, lib.mus, cap(m))).join('')}</div></div>
      <div id="lib-results"></div>`;
    renderLibResults();
  }
  function libRow(e, m) {
    return `<div class="list-item lib-row" role="button" tabindex="0" data-act="lib-open" data-id="${esc(e.id)}"><div class="grow"><b>${esc(e.name)}</b>
      <div class="mute small">${esc(cap(e.equipment || 'other'))} · ${esc((e.primary || []).join(', ') || e.category || '')}${e.tracking === 'time' ? ' · timed' : ''}${e.source === 'custom' ? ' · custom' : ''}</div></div>
      ${m ? `<span class="pill good" title="sessions logged">✓ ${m.sessions.length}</span>` : ''}
      ${pickCtx ? `<button class="btn sm primary" data-act="lib-add" data-id="${esc(e.id)}" aria-label="${pickCtx.mode === 'replace' ? 'replace with' : 'add'} ${esc(e.name)}">${pickCtx.mode === 'replace' ? '⇄' : '+'}</button>` : '<span class="mute">›</span>'}</div>`;
  }
  function renderLibResults() {
    const box = $('#lib-results'); if (!box) return;
    const hist = exerciseIndex(); const histByLib = new Map();
    hist.forEach((m) => { const l = LIB.find(m.name); m.lib = l; if (l) histByLib.set(l.id, mergeHistory([histByLib.get(l.id), m].filter(Boolean))); });
    const q = lib.q.trim(); const filtered = !!(q || lib.eq || lib.mus);
    const res = LIB.search(q, { equipment: lib.eq, muscle: lib.mus });
    let html = '';
    if (!filtered && hist.length) {
      html += `<div class="mute tiny sect">YOUR EXERCISES</div>` + hist.sort((a, b) => a.name.localeCompare(b.name)).map((m) => `<button class="list-item exi" data-act="${pickCtx && m.lib ? 'lib-open' : 'ex-history'}" data-id="${esc(m.lib ? m.lib.id : '')}" data-name="${esc(m.name)}" data-k="${esc(norm(m.name))}"><div class="grow"><b>${esc(m.name)}</b><div class="mute small">${m.sessions.length} session${m.sessions.length > 1 ? 's' : ''} · last ${fmtDate(m.sessions[0].w.startedAt)}</div></div><div style="text-align:right">${m.time ? `<div class="small">${m.longest} s</div><div class="tiny mute">longest</div>` : `<div class="small">${fmtNum(round(m.bestW))} ${unit()}</div><div class="tiny mute">e1RM ${fmtNum(Math.round(m.bestE))}</div>`}</div></button>`).join('') + `<div class="mute tiny sect">LIBRARY</div>`;
    }
    const orphan = q ? hist.filter((m) => !m.lib && norm(m.name).includes(norm(q))) : [];
    html += `<div class="mute small" id="lib-count" data-n="${res.length}">${res.length} exercise${res.length === 1 ? '' : 's'}${filtered ? '' : ' in the library'}</div>`;
    html += orphan.map((m) => `<button class="list-item exi" data-act="ex-history" data-name="${esc(m.name)}" data-k="${esc(norm(m.name))}"><div class="grow"><b>${esc(m.name)}</b><div class="mute small">from your history</div></div><span class="mute">›</span></button>`).join('');
    html += res.slice(0, lib.limit).map((e) => libRow(e, histByLib.get(e.id))).join('');
    if (res.length > lib.limit) html += `<button class="btn block" data-act="lib-more">Show all ${res.length}</button>`;
    if (!res.length && !orphan.length) html += `<div class="empty" style="padding:24px 8px">No exercises match${q ? ` “${esc(q)}”` : ''}.</div>`;
    html += `<button class="btn block" style="margin-top:10px" data-act="custom-new">＋ Create custom exercise${q ? ` “${esc(q)}”` : ''}</button>`;
    box.innerHTML = html;
  }
  function demoHTML(l) {
    const imgs = LIB.images(l); if (!imgs.length) return '';
    return `<div class="demo" data-act="demo-toggle" role="button" aria-label="Form demonstration (tap to pause)">${imgs.map((u, i) => `<img src="${esc(u)}" class="${i ? '' : 'on'}" alt="${esc(l.name)}: ${i ? 'end' : 'start'} position" crossorigin="anonymous" decoding="async" onerror="window.LTDemoError&&window.LTDemoError(this)">`).join('')}<span class="demo-badge">❚❚ Paused · tap to play</span></div>`;
  }
  window.LTDemoError = (img) => { const d = img.closest('.demo'); if (d) d.remove(); };
  function musclesHTML(l) {
    return `<div class="musc"><span class="mute tiny">PRIMARY</span> ${(l.primary || []).map((m) => `<span class="pill acc">${esc(cap(m))}</span>`).join('') || '<span class="mute small">–</span>'}</div>
      ${(l.secondary || []).length ? `<div class="musc"><span class="mute tiny">SECONDARY</span> ${(l.secondary || []).map((m) => `<span class="pill">${esc(cap(m))}</span>`).join('')}</div>` : ''}
      <div class="musc"><span class="mute tiny">EQUIPMENT</span> <span class="pill">${esc(cap(l.equipment || 'other'))}</span>${l.category ? `<span class="pill dim">${esc(l.category)}</span>` : ''}${l.tracking === 'time' ? '<span class="pill warn">timed hold · logs seconds</span>' : ''}${l.equipment === 'bodyweight' ? '<span class="pill good">BW · optional added weight</span>' : ''}</div>`;
  }
  function libInfoHTML(l) {
    const credit = l.source === 'fedb' ? `Photos &amp; data: <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener">free-exercise-db</a> (public domain)` : l.source === 'custom' ? 'Your custom exercise' : 'Description written for Lift Tracker';
    return `${demoHTML(l)}<div class="ex-desc">${esc(l.desc || 'No description.')}</div>${musclesHTML(l)}
      <div class="row wrap" style="margin-top:10px"><a class="btn sm" href="${ytURL(l.name)}" target="_blank" rel="noopener" data-yt="1">▶ Watch on YouTube</a></div>
      <div class="tiny mute credit">${credit}</div>`;
  }
  function openInfo(l) { if (!l) return; openSheet(`<h3>${esc(l.name)}</h3>${libInfoHTML(l)}<button class="btn block" style="margin-top:12px" data-act="sheet-close">Close</button>`); }
  function viewExerciseDetail(name) {
    const l = LIB.byId(name) || LIB.find(name);
    const title = l ? l.name : name;
    const ms = exerciseIndex().filter((x) => norm(x.name) === norm(name) || (l && LIB.find(x.name) === l));
    const m = mergeHistory(ms);
    setTop(`<button class="btn sm" data-act="back">‹</button><h1>${esc(title)}</h1>`);
    let html = '';
    if (l) {
      const tgt = pickTarget();
      html += `<div class="card libcard">${libInfoHTML(l)}
        <div class="stack" style="margin-top:12px">${tgt ? `<button class="btn primary block" data-act="lib-add" data-id="${esc(l.id)}">${tgt.replace ? '⇄ Replace ' : '＋ Add to '}${esc(tgt.label)}</button>`
          : `<button class="btn primary block" data-act="add-menu" data-id="${esc(l.id)}">＋ Add to workout or program…</button>`}
        ${l.source === 'custom' ? `<button class="btn block danger" data-act="custom-del" data-id="${esc(l.id)}">Delete custom exercise</button>` : ''}</div></div>`;
    }
    const pn = LIB.byId(name) ? (ms[0] ? ms[0].name : title) : name; const pr = pref(pn); // prefs are keyed by the name you log
    html += `<div class="card"><div class="row"><h3 class="grow" style="margin:0">Your settings</h3><button class="btn sm" data-act="ex-prefs" data-name="${esc(pn)}">⚙️ Progression &amp; rest</button></div>
      ${pr.pin ? `<div class="pin-note" data-act="pin-edit" data-name="${esc(pn)}" role="button">📌 ${esc(pr.pin)}</div>` : `<button class="btn sm ghost" data-act="pin-edit" data-name="${esc(pn)}" style="padding-left:0">📌 Pin a note (shows every session)</button>`}
      <div class="tiny mute" style="margin-top:6px">${esc(prefSummary(pn))}</div></div>`;
    if (!m) {
      html += l ? `<div class="card mute small">No logged sets for this exercise yet.</div>` : `<div class="empty">No completed sets for this exercise yet.<br><br><button class="btn" data-act="custom-new" data-name="${esc(name)}">＋ Create custom exercise</button></div>`;
      view.innerHTML = html; return;
    }
    detailHist = m;
    if (m.time) {
      html += `<div class="card"><h3>Personal records</h3><div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b>${m.longest} s</b><span>Longest hold</span></div><div class="stat"><b>${m.sessions.length}</b><span>Sessions</span></div></div></div>`;
      html += `<div class="card" id="pchart">${chartHTML(m)}</div>`;
    } else {
      html += `<div class="card"><h3>Personal records</h3><div class="stats">
      <div class="stat"><b>${fmtNum(round(m.bestW))}</b><span>Heaviest (${unit()})</span></div><div class="stat"><b>${fmtNum(Math.round(m.bestE))}</b><span>Best e1RM</span></div><div class="stat"><b>${m.maxReps}</b><span>Most reps</span></div></div>
      <div class="stats" style="grid-template-columns:1fr 1fr"><div class="stat"><b>${fmtNum(Math.round(m.bestVol))}</b><span>Best set volume</span></div><div class="stat"><b>${m.sessions.length}</b><span>Sessions</span></div></div></div>
      <div class="card" id="pchart">${chartHTML(m)}</div>`;
    }
    html += m.sessions.map(({ w, e }) => `<div class="card"><div class="row"><b class="grow">${fmtDate(w.startedAt)}</b><button class="btn sm ghost" data-act="go" data-to="#/history/${w.id}">${esc(w.dayName)} ›</button></div>
        <div class="hist-sets">${e.sets.filter((s) => s.done).map((s) => `${s.type === 'warmup' ? 'W ' : s.tag === 'failure' ? 'F ' : s.tag === 'drop' ? 'D ' : ''}${esc(histSetTxt(e, s, w.unit))}`).join(' · ')}</div>${e.notes ? `<div class="ex-notes" style="margin:0">${esc(e.notes)}</div>` : ''}</div>`).join('');
    view.innerHTML = html;
  }
  const METRICS = { e1rm: ['Est. 1RM', 'Estimated 1RM trend'], top: ['Top weight', 'Heaviest set trend'], setvol: ['Best set', 'Best set volume (weight × reps)'], vol: ['Volume', 'Session volume (working sets)'], reps: ['Reps', 'Most reps in a set'], hold: ['Hold', 'Longest hold (seconds)'] };
  function chartHTML(m) {
    const u = unit(); const keys = m.time ? ['hold'] : ['e1rm', 'top', 'setvol', 'vol', 'reps'];
    if (!keys.includes(chartState.metric)) chartState.metric = keys[0];
    const since = chartState.range ? Date.now() - chartState.range * 86400000 : 0;
    const pts = m.sessions.slice().reverse().filter(({ w }) => new Date(w.startedAt).getTime() >= since).map(({ w, e }) => {
      const ws = e.sets.filter((x) => x.done && x.type === 'working'); const W = (x) => conv(x.weight || 0, w.unit, u); let v = 0;
      switch (chartState.metric) {
        case 'e1rm': v = Math.max(0, ...ws.map((x) => e1rm(W(x), x.reps))); break;
        case 'top': v = Math.max(0, ...ws.map(W)); break;
        case 'setvol': v = Math.max(0, ...ws.map((x) => W(x) * (x.reps || 0))); break;
        case 'vol': v = ws.reduce((n, x) => n + W(x) * (x.reps || 0), 0); break;
        default: v = Math.max(0, ...ws.map((x) => x.reps || 0));
      }
      return { t: new Date(w.startedAt).getTime(), v: Math.round(v * 10) / 10 };
    }).filter((p) => p.v > 0);
    const first = pts[0]; const last = pts[pts.length - 1]; const unitLbl = ['reps', 'hold'].includes(chartState.metric) ? (chartState.metric === 'hold' ? 's' : 'reps') : u;
    return `<div class="row"><h3 class="grow" style="margin:0">Progress</h3><span class="tiny mute">${pts.length} session${pts.length === 1 ? '' : 's'}</span></div>
      ${keys.length > 1 ? `<div class="seg sm" style="margin-top:8px">${keys.map((k) => `<button class="${k === chartState.metric ? 'on' : ''}" data-act="chart-metric" data-k="${k}">${METRICS[k][0]}</button>`).join('')}</div>` : ''}
      <div class="mute tiny" style="margin-top:10px">${METRICS[chartState.metric][1]}</div>
      ${X.lineChart(pts, { label: METRICS[chartState.metric][1] })}
      <div class="seg sm">${[[30, '1M'], [90, '3M'], [365, '1Y'], [0, 'All']].map(([d, l]) => `<button class="${d === chartState.range ? 'on' : ''}" data-act="chart-range" data-d="${d}">${l}</button>`).join('')}</div>
      ${pts.length > 1 ? `<div class="small" style="margin-top:8px">${fmtNum(first.v)} → <b>${fmtNum(last.v)}</b> ${unitLbl} ${deltaHTML(pct(last.v, first.v))} · best ${fmtNum(Math.max(...pts.map((p) => p.v)))} ${unitLbl} <span class="tiny mute">(gold dot)</span></div>` : ''}`;
  }
  function prefSummary(name) {
    const p = pref(name); const bits = [];
    bits.push(`Progression: ${{ double: 'double (reps, then weight)', linear: 'linear (add weight)', off: 'off' }[p.mode] || 'auto'}`);
    if (p.inc) bits.push(`+${fmtNum(p.inc)} ${p.incUnit || unit()} steps`);
    if (p.restWork != null) bits.push(`rest ${fmtClock(p.restWork)}`); if (p.restWarm != null) bits.push(`warm-up rest ${fmtClock(p.restWarm)}`);
    return bits.join(' · ');
  }
  function addMenu(l) {
    const p = addSheetProg ? D.programs.find((x) => x.id === addSheetProg) : null;
    if (p) {
      openSheet(`<h3>Add ${esc(l.name)} to…</h3><div class="mute small">${esc(p.name)}</div>${p.weeks.map((w, wi) => `${p.weeks.length > 1 ? `<div class="mute tiny sect">${esc(w.name)}</div>` : ''}${w.days.map((d, di) => `<button class="list-item" data-act="add-to-day" data-id="${esc(l.id)}" data-w="${wi}" data-d="${di}">📅 ${esc(d.name)} <span class="mute small">(${d.exercises.length})</span></button>`).join('')}`).join('')}
        <button class="btn block" data-act="add-menu" data-id="${esc(l.id)}" data-back="1">‹ Back</button>`);
      return;
    }
    openSheet(`<h3>Add ${esc(l.name)} to…</h3>
      ${D.current ? `<button class="list-item" data-act="add-to-current" data-id="${esc(l.id)}">🏋️ Current workout: ${esc(D.current.dayName)}</button>` : ''}
      <div class="mute tiny sect">A PROGRAM DAY</div>
      ${D.programs.map((x) => `<button class="list-item" data-act="add-pick-prog" data-pid="${esc(x.id)}" data-id="${esc(l.id)}">📋 ${esc(x.name)} <span class="mute">›</span></button>`).join('') || '<div class="mute small">No programs yet.</div>'}
      <button class="btn block" data-act="sheet-close">Cancel</button>`);
  }
  const MUSCLE_CAT = { chest: 'push', shoulders: 'push', triceps: 'push', lats: 'pull', 'middle back': 'pull', 'lower back': 'pull', biceps: 'pull', traps: 'pull', forearms: 'pull', abdominals: 'core', neck: 'other' };
  function customSheet(name) {
    openSheet(`<h3>Custom exercise</h3>
      <label class="lbl" for="cx-name">Name</label><input id="cx-name" value="${esc(name || '')}" placeholder="e.g. Landmine Squat">
      <label class="lbl" for="cx-eq">Equipment</label><select id="cx-eq">${LIB.EQUIPMENT.map((e) => `<option value="${esc(e)}">${esc(cap(e))}</option>`).join('')}</select>
      <label class="lbl" for="cx-mus">Primary muscle</label><select id="cx-mus">${LIB.MUSCLES.map((m) => `<option value="${esc(m)}">${esc(cap(m))}</option>`).join('')}</select>
      <label class="lbl" for="cx-tr">Log as</label><select id="cx-tr"><option value="reps">Reps</option><option value="time">Seconds (timed hold)</option></select>
      <label class="lbl" for="cx-desc">Description (optional)</label><textarea id="cx-desc" rows="2" placeholder="Cues, setup…"></textarea>
      <button class="btn primary block" style="margin-top:12px" data-act="custom-save">Save exercise</button>`);
  }

  /* ---------- program day editor ---------- */
  function viewDayEditor(pid, wi, di) {
    const p = D.programs.find((x) => x.id === pid); const d = p && p.weeks[wi] && p.weeks[wi].days[di];
    if (!d) { go('#/programs'); return; }
    setTop(`<button class="btn sm" data-act="go" data-to="#/programs/${esc(p.id)}">‹</button><h1>${esc(d.name)}<div class="sub">${esc(p.name)}${p.weeks.length > 1 ? ' · ' + esc(p.weeks[wi].name) : ''}</div></h1>`);
    view.innerHTML = `<div class="card"><label class="lbl" for="day-name" style="margin-top:0">Day name</label><input id="day-name" data-act="day-name" value="${esc(d.name)}">
      <label class="lbl" for="day-notes">Day notes</label><textarea id="day-notes" data-act="day-notes" rows="2" placeholder="Optional">${esc(d.notes)}</textarea></div>
      <div id="ed-list">${d.exercises.map((e, i) => `<div class="card ed-ex" data-i="${i}"><div class="row"><b class="grow ex-name" style="font-size:16px">${esc(e.name)}</b>${LIB.find(e.name, e.libraryId) ? `<button class="btn sm" data-act="info-name" data-name="${esc(e.name)}" data-id="${esc(e.libraryId || '')}" aria-label="info">ⓘ</button>` : ''}</div>
        <div class="targets" style="padding:4px 0 0">${targetLine(e)}${e.bodyweight ? '<span class="pill good">BW</span>' : ''}</div>${e.notes ? `<div class="small mute" style="margin-top:4px">${esc(e.notes)}</div>` : ''}
        <div class="row ed-ctl"><button class="btn sm" data-act="ed-move" data-i="${i}" data-d="-1" ${i ? '' : 'disabled'} aria-label="move up">↑</button><button class="btn sm" data-act="ed-move" data-i="${i}" data-d="1" ${i < d.exercises.length - 1 ? '' : 'disabled'} aria-label="move down">↓</button><button class="btn sm grow" data-act="ed-edit" data-i="${i}">✎ Edit</button><button class="btn sm danger" data-act="ed-rm" data-i="${i}" aria-label="remove">✕</button></div></div>`).join('') || '<div class="empty" style="padding:24px">No exercises yet.</div>'}</div>
      <div class="stack"><button class="btn primary block" data-act="ed-add">＋ Add exercises from library</button>
      ${d.exercises.length ? `<button class="btn good block" data-act="ed-start">Start this workout</button>` : ''}
      <button class="btn block danger" data-act="ed-del-day" ${p.weeks[wi].days.length > 1 ? '' : 'disabled'}>Delete day</button></div>`;
  }
  const REST_OPTS = [0, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240, 300];
  function editExSheet(e, i) {
    const r = e.restSeconds || 90;
    openSheet(`<h3>Edit exercise</h3>
      <label class="lbl" for="ee-name">Exercise</label><input id="ee-name" value="${esc(e.name)}">
      <div class="row"><div class="grow"><label class="lbl" for="ee-wu">Warm-up sets</label><input id="ee-wu" type="number" min="0" max="10" inputmode="numeric" value="${e.warmupSets || 0}"></div>
        <div class="grow"><label class="lbl" for="ee-sets">Working sets</label><input id="ee-sets" type="number" min="1" max="20" inputmode="numeric" value="${e.workingSets || 3}"></div></div>
      <div class="row"><div class="grow"><label class="lbl" for="ee-reps">${e.tracking === 'time' ? 'Seconds' : 'Reps'}</label><input id="ee-reps" value="${esc(e.reps)}" placeholder="8-12"></div>
        <div class="grow"><label class="lbl" for="ee-rpe">RPE</label><input id="ee-rpe" value="${esc(e.rpe)}" placeholder="e.g. 8"></div></div>
      <div class="row"><div class="grow"><label class="lbl" for="ee-rest">Rest</label><select id="ee-rest">${REST_OPTS.concat(REST_OPTS.includes(r) ? [] : [r]).sort((a, b) => a - b).map((s) => `<option value="${s}" ${s === r ? 'selected' : ''}>${s ? fmtClock(s) : 'None'}</option>`).join('')}</select></div>
        <div class="grow"><label class="lbl" for="ee-tr">Log as</label><select id="ee-tr"><option value="reps">Reps</option><option value="time" ${e.tracking === 'time' ? 'selected' : ''}>Seconds</option></select></div></div>
      <div class="row"><div class="grow"><label class="lbl" for="ee-rest-txt">…or type a rest</label><input id="ee-rest-txt" placeholder="e.g. 2:15 or 135" inputmode="text"></div>
        <div class="grow"><label class="lbl" for="ee-rest-wu">Warm-up rest</label><input id="ee-rest-wu" value="${e.restWarmupSeconds ? fmtClock(e.restWarmupSeconds) : ''}" placeholder="default ${fmtClock(D.settings.restWarmup ?? 60)}"></div></div>
      <div class="toggle"><span>Bodyweight exercise<div class="tiny mute">Weight shows as BW (+ added)</div></span><input id="ee-bw" type="checkbox" style="width:24px;height:24px;flex:0 0 auto" ${e.bodyweight ? 'checked' : ''}></div>
      <label class="lbl" for="ee-notes">Notes</label><textarea id="ee-notes" rows="2">${esc(e.notes)}</textarea>
      <button class="btn primary block" style="margin-top:12px" data-act="ed-save" data-i="${i}">Save</button>`);
  }
  function newProgramSheet() {
    openSheet(`<h3>New program</h3>
      <label class="lbl" for="np-name">Program name</label><input id="np-name" placeholder="My program">
      <label class="lbl" for="np-days">Days (comma separated)</label><input id="np-days" value="Day 1, Day 2, Day 3">
      <div class="toggle"><span>Make it my active program</span><input id="np-active" type="checkbox" style="width:24px;height:24px" checked></div>
      <button class="btn primary block" style="margin-top:12px" data-act="np-create">Create &amp; add exercises</button>`);
  }
  function viewPrograms() {
    setTop('<h1>Programs</h1>');
    const act = activeProgram();
    view.innerHTML = `${D.programs.map((p) => `<button class="list-item" data-act="go" data-to="#/programs/${p.id}"><span class="check-dot ${act && act.id === p.id ? 'done' : ''}">${act && act.id === p.id ? '✓' : ''}</span><div class="grow"><b>${esc(p.name)}</b><div class="mute small">${p.weeks.length} week${p.weeks.length > 1 ? 's' : ''} · ${p.weeks[0].days.length} days/week${act && act.id === p.id ? ' · active' : ''}</div></div><span class="mute">›</span></button>`).join('') || '<div class="empty">No programs yet.</div>'}
      <div class="card stack"><h3>Add a program</h3>
        <button class="btn block primary" data-act="new-program">＋ Create a program from scratch</button>
        <button class="btn block" data-act="pick-file" data-kind="program">Import program file (JSON or CSV)</button>
        <button class="btn block" data-act="go" data-to="#/import/paste">Paste text from PDF / spreadsheet</button>
        <button class="btn block" data-act="load-sample">Load "Example PPL (sample)"</button>
        <button class="btn block" data-act="restore-builtins">Restore built-in programs</button>
        <p class="tiny mute">Formats are documented in PROGRAM_SCHEMA.md. CSV columns: week, day, exercise, warmup_sets, working_sets, reps, rpe, rir, technique, rest, notes, substitutions.</p></div>`;
  }
  function viewProgramDetail(id) {
    const p = D.programs.find((x) => x.id === id);
    if (!p) { go('#/programs'); return; }
    const isActive = activeProgram() && activeProgram().id === p.id;
    setTop(`<button class="btn sm" data-act="go" data-to="#/programs">‹</button><h1>${esc(p.name)}</h1>`);
    view.innerHTML = `<div class="card"><h3>${esc(p.name)}</h3>${p.author ? `<div class="small mute">${esc(p.author)}</div>` : ''}${p.description ? `<p class="small mute">${linkify(p.description)}</p>` : ''}
      ${p.schedule && p.schedule.length ? `<div class="mute tiny">WEEKLY ORDER</div>${scheduleHTML(p)}` : ''}${sourcesHTML(p)}
      <div class="row wrap">${isActive ? '<span class="pill good">Active program</span>' : `<button class="btn sm primary" data-act="set-active" data-id="${p.id}">Make active</button>`}
      <button class="btn sm primary" data-act="share-program" data-id="${p.id}">📤 Share</button><button class="btn sm" data-act="export-program" data-id="${p.id}">Export JSON</button><button class="btn sm" data-act="edit-program" data-id="${p.id}">Edit JSON</button><button class="btn sm danger" data-act="del-program" data-id="${p.id}">Delete</button></div></div>
      <div class="card"><h3>Edit days</h3><p class="tiny mute" style="margin:0 0 6px">Add library exercises, set sets / reps / RPE / rest, reorder or remove.</p>
        ${p.weeks.map((w, wi) => `${p.weeks.length > 1 ? `<div class="mute tiny sect">${esc(w.name)}</div>` : ''}${w.days.map((d, di) => `<button class="list-item day-edit" data-act="go" data-to="#/programs/${esc(p.id)}/day/${wi}/${di}"><div class="grow"><b>✎ ${esc(d.name)}</b><div class="mute small">${d.exercises.length} exercise${d.exercises.length === 1 ? '' : 's'}</div></div><span class="mute">›</span></button>`).join('')}
        <button class="btn sm" data-act="add-day" data-id="${esc(p.id)}" data-w="${wi}">＋ Add day${p.weeks.length > 1 ? ' to ' + esc(w.name) : ''}</button>`).join('')}
        ${p.builtIn ? '<p class="tiny mute">Editing a built-in program keeps your changes; app updates won’t overwrite it (use “Restore built-in programs” to reset).</p>' : ''}</div>
      ${programPreviewHTML(p)}`;
  }
  function programPreviewHTML(p) {
    return p.weeks.map((w) => `<div class="card preview"><h3>${esc(w.name)}</h3>${w.notes ? `<div class="small mute">${esc(w.notes)}</div>` : ''}
      ${w.days.map((d) => `<div style="margin-top:10px"><b>${esc(d.name)}</b> <span class="mute small">(${d.exercises.length})</span>${d.notes ? `<div class="tiny mute">${esc(d.notes)}</div>` : ''}
      <div class="scroll-x"><table><thead><tr><th>Exercise</th><th>WU</th><th>Sets</th><th>Reps</th><th>RPE/RIR</th><th>Rest</th><th>Notes / subs</th></tr></thead><tbody>
      ${d.exercises.map((e) => `<tr><td>${e.superset ? `<span class="pill ss">SS ${esc(e.superset)}</span> ` : ''}${esc(e.name)}${e.load ? `<div class="tiny" style="color:#93c5fd">${esc(e.load)}</div>` : ''}${e.technique ? `<div class="tiny" style="color:#86efac">${esc(e.technique)}</div>` : ''}</td><td>${e.warmupSets}</td><td>${e.workingSets}</td><td>${esc(e.reps)}</td><td>${esc([e.rpe && 'RPE ' + e.rpe, e.rir && 'RIR ' + e.rir].filter(Boolean).join(' '))}</td><td>${e.restSeconds ? fmtClock(e.restSeconds) : ''}</td><td class="tiny">${esc(e.notes)}${e.substitutions.length ? `<div class="mute">Subs: ${e.substitutions.map(esc).join(', ')}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>`).join('')}</div>`).join('');
  }
  function viewPaste() {
    setTop(`<button class="btn sm" data-act="go" data-to="#/programs">‹</button><h1>Paste program text</h1>`);
    view.innerHTML = `<div class="card stack"><p class="small mute" style="margin:0">Copy a program table from a PDF, Google Sheet, Excel or notes and paste it below. Put headings like <code>Week 1</code> and <code>Push</code> / <code>Day 2 - Pull</code> on their own lines. Rows can be tab/comma/pipe separated with a header row (Exercise, Warm-up Sets, Working Sets, Reps, RPE, Rest, Notes, Substitution…) or lines like <code>Bench Press 3x8-10 RPE 8 2-3 min</code>.</p>
      <label class="lbl" for="p-name">Program name</label><input id="p-name" value="${esc(pasteDraft.name)}" placeholder="My program">
      <label class="lbl" for="p-text">Program text</label><textarea id="p-text" rows="12" placeholder="Week 1&#10;Push&#10;Exercise&#9;Sets&#9;Reps&#9;RPE&#9;Rest&#10;Bench Press&#9;3&#9;6-8&#9;8&#9;3 min">${esc(pasteDraft.text)}</textarea>
      <label class="lbl" for="p-rep">If the text has only one week, repeat it for how many weeks?</label><input id="p-rep" type="number" min="1" max="52" inputmode="numeric" value="${pasteDraft.repeat}">
      <button class="btn primary block" data-act="paste-parse">Preview</button></div>`;
  }
  function viewImportPreview() {
    if (!pendingImport) { go('#/programs'); return; }
    setTop(`<button class="btn sm" data-act="import-cancel">‹</button><h1>Confirm import</h1>`);
    const r = pendingImport.results;
    view.innerHTML = r.map((res, i) => {
      const p = res.program; const nEx = p.weeks.reduce((n, w) => n + w.days.reduce((m, d) => m + d.exercises.length, 0), 0);
      return `<div class="card"><label class="lbl" style="margin-top:0">Program name</label><input data-act="imp-name" data-i="${i}" value="${esc(p.name)}">
        <p class="small">${p.weeks.length} week(s) · ${p.weeks.reduce((n, w) => n + w.days.length, 0)} day(s) · ${nEx} exercises${pendingImport.kind === 'paste' ? ` · parsed as ${res.usedHeader ? 'table with header' : 'free text'} (${esc(res.delimiter)})` : ''}</p>
        ${res.warnings.length ? `<div class="warnbox"><b>Check these:</b><br>${res.warnings.slice(0, 30).map(esc).join('<br>')}</div>` : ''}
        ${res.ignored && res.ignored.length ? `<div class="warnbox" style="margin-top:8px"><b>Ignored lines:</b><br>${res.ignored.slice(0, 30).map(esc).join('<br>')}</div>` : ''}</div>
        ${programPreviewHTML(p)}`;
    }).join('') + `<div class="row" style="gap:10px"><button class="btn grow" data-act="import-cancel">${pendingImport.kind === 'paste' ? 'Back to edit' : 'Cancel'}</button><button class="btn primary grow" data-act="import-save">Save program</button></div>`;
  }
  /* ---------- stats: muscle heatmap, weekly volume, monthly report ---------- */
  const libCache = new Map();
  function libOfHist(e) { const k = e.name + '|' + (e.libraryId || ''); if (!libCache.has(k)) libCache.set(k, LIB.find(e.name, e.libraryId) || null); return libCache.get(k); }
  function heatmapHTML(days) {
    const since = Date.now() - days * 86400000; const r = X.muscleSets(D.workouts, libOfHist, since);
    const max = Math.max(1, ...Object.values(r.counts)); const perWeek = days > 7 ? 7 / days : 1;
    const list = X.MUSCLES.map((m) => [m, r.counts[m]]).sort((a, b) => b[1] - a[1]);
    return `<div class="bodies">${X.bodySVG(r.counts, max, 'front')}${X.bodySVG(r.counts, max, 'back')}</div>
      <div class="legend tiny mute"><span>0</span><i style="opacity:.25"></i><i style="opacity:.5"></i><i style="opacity:.75"></i><i></i><span>${fmtNum(Math.round(max * 10) / 10)} sets</span></div>
      <div class="mlist" id="muscle-list">${list.map(([m, v]) => `<div class="mrow" data-m="${m}"><span class="mname">${esc(cap(m))}</span><span class="mbar"><i style="width:${(v / max) * 100}%"></i></span><b>${fmtNum(Math.round(v * 10) / 10)}</b>${days > 7 ? `<span class="tiny mute">${fmtNum(Math.round(v * perWeek * 10) / 10)}/wk</span>` : ''}</div>`).join('')}</div>
      <p class="tiny mute">Hard sets = completed working sets (warm-ups excluded). Primary muscle counts 1 set, secondary ½ — from the exercise library's muscle data. Many coaches aim for roughly 10–20 hard sets per muscle per week.${r.unmapped ? ` ${fmtNum(r.unmapped)} sets from exercises not in the library aren't counted.` : ''}</p>`;
  }
  function weeklyBars() {
    const u = unit(); const now = X.weekStart(new Date()); const bars = [];
    for (let i = 11; i >= 0; i--) { const s0 = new Date(now); s0.setDate(s0.getDate() - i * 7); const s1 = new Date(s0); s1.setDate(s1.getDate() + 7);
      const ws = D.workouts.filter((w) => { const t = new Date(w.startedAt); return t >= s0 && t < s1; });
      bars.push({ label: s0.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }), v: ws.reduce((n, w) => n + conv(workoutStats(w).vol, w.unit, u), 0), n: ws.length }); }
    return bars;
  }
  function monthReportHTML() {
    const now = new Date(); if (!reportMonth) reportMonth = { y: now.getFullYear(), m: now.getMonth() };
    const { y, m } = reportMonth; const u = unit();
    const inM = (w, yy, mm) => { const d = new Date(w.startedAt); return d.getFullYear() === yy && d.getMonth() === mm; };
    const ws = D.workouts.filter((w) => inM(w, y, m)); const py = m ? y : y - 1; const pm = m ? m - 1 : 11; const pws = D.workouts.filter((w) => inM(w, py, pm));
    const agg = (list) => list.reduce((a, w) => { const st = workoutStats(w); a.sets += st.sets; a.vol += conv(st.vol, w.unit, u); a.time += w.durationSec || 0; a.prs += (w.prs || []).length; return a; }, { sets: 0, vol: 0, time: 0, prs: 0 });
    const A = agg(ws); const P = agg(pws);
    const exCount = new Map(); ws.forEach((w) => w.exercises.forEach((e) => { const n = e.sets.filter((x) => x.type === 'working').length; if (n) exCount.set(e.name, (exCount.get(e.name) || 0) + n); }));
    const top = [...exCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const ms = X.muscleSets(ws, libOfHist, 0); const topM = Object.entries(ms.counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const prs = ws.flatMap((w) => (w.prs || []).map((p) => ({ ...p, at: w.startedAt })));
    const title = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const stat = (v, l, d) => `<div class="stat"><b>${v}</b><span>${l}</span>${d !== undefined ? `<div class="tiny">${deltaHTML(d)}</div>` : ''}</div>`;
    return `<div class="row"><button class="btn sm" data-act="rep-nav" data-d="-1" aria-label="previous month">‹</button><h3 class="grow" style="text-align:center;margin:0" id="report-title">${esc(title)}</h3><button class="btn sm" data-act="rep-nav" data-d="1" aria-label="next month" ${y === now.getFullYear() && m === now.getMonth() ? 'disabled' : ''}>›</button></div>
      ${ws.length ? `<div class="stats">${stat(ws.length, 'Workouts', pws.length ? pct(ws.length, pws.length) : undefined)}${stat(fmtDur(A.time).replace(/ \d+s$/, ''), 'Time')}${stat(A.sets, 'Sets', pws.length ? pct(A.sets, P.sets) : undefined)}</div>
      <div class="stats">${stat(fmtNum(Math.round(A.vol)), `Volume (${u})`, pws.length ? pct(A.vol, P.vol) : undefined)}${stat(A.prs, 'PRs')}${stat(fmtNum(Math.round((ws.length / (new Date(y, m + 1, 0).getDate() / 7)) * 10) / 10), 'Per week')}</div>
      ${pws.length ? '<div class="tiny mute" style="margin-top:4px">% vs the month before</div>' : ''}
      ${top.length ? `<div class="mute tiny sect">MOST TRAINED EXERCISES (sets)</div>${top.map(([n, c]) => `<div class="row small"><span class="grow">${esc(n)}</span><b>${c}</b></div>`).join('')}` : ''}
      ${topM.length ? `<div class="mute tiny sect">MUSCLE SPLIT (hard sets)</div><div>${topM.map(([mm, v]) => `<span class="pill acc">${esc(cap(mm))} ${fmtNum(Math.round(v * 10) / 10)}</span>`).join('')}</div>` : ''}
      ${prs.length ? `<div class="mute tiny sect">PERSONAL RECORDS</div>${prs.slice(0, 8).map((p) => `<div class="pr">🏆 ${esc(p.exercise)}: ${esc(p.type)} ${esc(p.value)} <span class="mute">· ${fmtDate(p.at)}</span></div>`).join('')}` : ''}`
      : '<div class="empty" style="padding:20px">No workouts this month.</div>'}`;
  }
  function viewStats() {
    setTop('<button class="btn sm" data-act="go" data-to="#/history">‹</button><h1>Stats</h1>');
    const bars = weeklyBars();
    view.innerHTML = `<div class="card" id="heatmap"><div class="row"><h3 class="grow" style="margin:0">Muscles trained</h3></div>
        <div class="seg sm" style="margin:8px 0">${[[7, 'Last 7 days'], [30, 'Last 30 days']].map(([d, l]) => `<button class="${statsRange === d ? 'on' : ''}" data-act="stats-range" data-d="${d}">${l}</button>`).join('')}</div>
        <div id="heat-body">${heatmapHTML(statsRange)}</div></div>
      <div class="card"><h3>Weekly volume (${unit()})</h3>${X.barChart(bars, { label: 'weekly volume' })}<div class="tiny mute">Last 12 weeks · ${bars.reduce((n, b) => n + b.n, 0)} workouts</div></div>
      <div class="card" id="report"><div class="mute tiny" style="margin-bottom:6px">MONTHLY REPORT</div>${monthReportHTML()}</div>
      <button class="btn block" data-act="export-csv">Export history (CSV)</button>`;
  }

  function viewHelp() {
    setTop('<button class="btn sm" data-act="back" aria-label="back">‹</button><h1>How-to guide</h1>');
    view.innerHTML = `<div class="card help-list">${window.LTOnboard.HELP.map(([q, a]) => `<details><summary>${esc(q)}</summary><p class="small">${esc(a)}</p></details>`).join('')}</div>
      <div class="row wrap"><button class="btn" data-act="tour-replay">▶ Replay welcome tour</button><button class="btn" data-act="tips-reset">↺ Show tips again</button></div>`;
  }
  function viewSettings() {
    setTop(`${D.current ? '<button class="btn sm" data-act="go" data-to="#/session" aria-label="back to workout">‹</button>' : ''}<h1>Settings<div class="sub">Version ${APP_VERSION}</div></h1>${D.current ? '<button class="btn sm primary" data-act="go" data-to="#/session">Workout</button>' : ''}`);
    const st = D.settings;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent); const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    view.innerHTML = `<div class="card"><h3>Units</h3><div class="seg"><button class="${st.units === 'lb' ? 'on' : ''}" data-act="units" data-u="lb">lb</button><button class="${st.units === 'kg' ? 'on' : ''}" data-act="units" data-u="kg">kg</button></div>
      <p class="tiny mute">Applies to new workouts; history is converted for display.</p></div>
      <div class="card"><h3>Rest timer</h3>
        <div class="toggle"><span>Auto-start after each set</span><input type="checkbox" style="width:24px;height:24px" data-act="set-bool" data-k="autoRest" ${st.autoRest ? 'checked' : ''}></div>
        <div class="toggle"><span>Default rest time<div class="tiny mute">Working sets · tap the time to type it</div></span><div class="row"><button class="btn sm" data-act="def-rest-adj" data-d="-15">−15s</button><b id="def-rest-val" class="tapval" data-act="rest-type" data-k="defaultRest" role="button" style="min-width:48px;text-align:center">${fmtClock(st.defaultRest)}</b><button class="btn sm" data-act="def-rest-adj" data-d="15">+15s</button></div></div>
        <div class="toggle"><span>Warm-up set rest<div class="tiny mute">Never longer than the working rest</div></span><div class="row"><button class="btn sm" data-act="def-rest-adj" data-k="restWarmup" data-d="-15">−15s</button><b id="wu-rest-val" class="tapval" data-act="rest-type" data-k="restWarmup" role="button" style="min-width:48px;text-align:center">${fmtClock(st.restWarmup ?? 60)}</b><button class="btn sm" data-act="def-rest-adj" data-k="restWarmup" data-d="15">+15s</button></div></div>
        <div class="toggle"><span>Use default rest for all exercises<div class="tiny mute">Off = use each exercise's program rest when it has one</div></span><input type="checkbox" style="width:24px;height:24px;flex:0 0 auto" data-act="set-bool" data-k="useDefaultRestAll" ${st.useDefaultRestAll ? 'checked' : ''}></div>
        <p class="tiny mute">During rest, use −15 / +15 on the timer bar, or tap the time to type one. Per-exercise rest: ⋯ → Progression &amp; rest. Drop sets skip the timer.</p></div>
      <div class="card"><h3>Progression</h3>
        <div class="toggle"><span>Suggest the next weight/reps<div class="tiny mute">Double progression for rep ranges (add reps, then weight), linear for fixed reps; 3 misses in a row → 10% deload</div></span><input type="checkbox" style="width:24px;height:24px;flex:0 0 auto" data-act="set-bool" data-k="progression" ${st.progression ? 'checked' : ''}></div>
        <div class="toggle"><span>Pre-fill suggestions<div class="tiny mute">Off = show the suggestion with a Use button</div></span><input type="checkbox" style="width:24px;height:24px;flex:0 0 auto" data-act="set-bool" data-k="autoFillSuggestion" ${st.autoFillSuggestion ? 'checked' : ''}></div>
        <label class="lbl" for="ramp-in">Warm-up ramp (⋯ → Add warm-up sets)</label><input id="ramp-in" data-act="ramp" value="${esc(X.rampText(st.warmupRamp))}" placeholder="bar×10, 40%×5, 60%×5, 80%×3"></div>
      <div class="card"><h3>Effort (RPE / RIR)</h3>
        <div class="toggle"><span>Log effort per set<div class="tiny mute">Adds an optional column; tap it to pick. Never required.</div></span><input type="checkbox" style="width:24px;height:24px;flex:0 0 auto" data-act="set-bool" data-k="logRpe" ${st.logRpe ? 'checked' : ''}></div>
        <div class="seg" style="margin-top:8px"><button class="${st.effortScale !== 'rir' ? 'on' : ''}" data-act="effort-scale" data-v="rpe">RPE (6–10)</button><button class="${st.effortScale === 'rir' ? 'on' : ''}" data-act="effort-scale" data-v="rir">RIR (reps left)</button></div></div>
      <div class="card" id="plates-card"><h3>Plates &amp; bar (${esc(st.units)})</h3>
        <div class="row"><div class="grow"><label class="lbl" for="bar-in">Bar weight</label><input id="bar-in" data-act="bar" inputmode="decimal" value="${fmtNum(plateCfg(st.units).bar)}"></div>
        <div style="flex:2"><label class="lbl" for="plates-in">Plates per side (size×count)</label><input id="plates-in" data-act="plates" value="${esc(Object.entries(plateCfg(st.units).plates).filter(([, n]) => n > 0).sort((a, b) => b[0] - a[0]).map(([k, n]) => `${fmtNum(+k)}×${n}`).join(', '))}"></div></div>
        <label class="lbl" for="pc-total">Plate calculator</label><input id="pc-total" data-act="pc-total" inputmode="decimal" placeholder="Total weight, e.g. ${st.units === 'kg' ? '100' : '225'}">
        <div id="pc-out" style="margin-top:8px"></div></div>
      <div class="card"><h3>Workouts</h3>
        <div class="toggle"><span>Keep screen awake during workouts<div class="tiny mute">Uses the Wake Lock API while a workout is open${'wakeLock' in navigator ? '' : ' (not supported in this browser)'}</div></span><input type="checkbox" style="width:24px;height:24px;flex:0 0 auto" data-act="set-bool" data-k="wakeLock" ${st.wakeLock ? 'checked' : ''}></div>
        <div class="toggle"><span>Weekly goal<div class="tiny mute">Workouts per week for the streak card</div></span><div class="row"><button class="btn sm" data-act="goal-adj" data-d="-1">−</button><b id="goal-val" style="min-width:28px;text-align:center">${st.weeklyGoal || 3}</b><button class="btn sm" data-act="goal-adj" data-d="1">+</button></div></div></div>
      <div class="card"><h3>Sounds &amp; haptics</h3>
        <div class="toggle"><span>Sounds</span><input type="checkbox" style="width:24px;height:24px" data-act="set-bool" data-k="sound" ${st.sound ? 'checked' : ''}></div>
        <div class="toggle"><span>Volume</span><input type="range" min="0" max="100" step="5" style="width:55%;padding:0" data-act="volume" value="${st.volume ?? 70}"></div>
        <div class="toggle"><span>Haptics (vibrate)<div class="tiny mute">Tick on each set, buzz when rest is over, rumble on a new PR${typeof navigator.vibrate === 'function' ? '' : ' (not supported in this browser, e.g. iPhone)'}</div></span><input type="checkbox" style="width:24px;height:24px" data-act="set-bool" data-k="vibrate" ${st.vibrate ? 'checked' : ''}></div>
        <div class="row wrap" style="margin-top:8px">${['set', 'exercise', 'finish', 'pr', 'rest'].map((n) => `<button class="btn sm" data-act="test-sound" data-n="${n}">▶ ${{ set: 'Set done', exercise: 'Exercise done', finish: 'Workout done', pr: 'New PR', rest: 'Rest over' }[n]}</button>`).join('')}</div>
        <p class="tiny mute">iPhone: the silent/ring switch mutes web app sounds.</p></div>
      <div class="card stack"><h3>Backup</h3><p class="small mute" style="margin:0">Your data lives only on this device. Export a backup regularly.</p>
        <button class="btn block primary" data-act="export-backup">Export backup (JSON)</button>
        <button class="btn block" data-act="pick-file" data-kind="backup">Import backup…</button>
        <button class="btn block" data-act="pick-file" data-kind="history">Import Strong / Hevy CSV…</button>
        <button class="btn block" data-act="export-csv">Export history (CSV)</button>
        <button class="btn block danger" data-act="wipe">Erase all data</button></div>
      <div class="card" id="help-card"><h3>Tips &amp; Help</h3><p class="tiny mute" style="margin:0 0 8px">Short tips appear once, next to the button they explain.</p>
        <div class="row wrap"><button class="btn sm" data-act="tour-replay">▶ Replay welcome tour</button><button class="btn sm" data-act="tips-reset">↺ Show tips again</button><button class="btn sm" data-act="go" data-to="#/help">How-to guide ›</button></div></div>
      <div class="card"><h3>Install</h3>${standalone ? '<p class="small">Installed ✓</p>' : deferredInstall ? '<button class="btn block primary" data-act="install">Add to home screen</button>' : `<p class="small mute">${ios ? 'In Safari tap Share → <b>Add to Home Screen</b>.' : 'Use your browser menu → <b>Install app</b> / <b>Add to Home screen</b>.'}</p>`}
      <p class="small" id="app-version"><b>Version ${APP_VERSION}</b> ${updateReady ? '· <button class="btn sm primary" data-act="apply-update">Update ready — reload</button>' : '<button class="btn sm" data-act="check-update">Check for update</button>'}</p>
      <p class="tiny mute">Lift Tracker v${APP_VERSION} · ${D.programs.length} programs · ${D.workouts.length} workouts</p></div>
      <div class="card" id="credits"><h3>About &amp; credits</h3>
        <p class="small" style="margin:0 0 6px">Exercise library: ${LIB.all.length} exercises. Exercise data and start/end form photos come from <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener">free-exercise-db</a> by yuhonas, released into the public domain (Unlicense). Photos load from the jsDelivr CDN only when you open an exercise and are then cached for offline use.</p>
        <p class="tiny mute" style="margin:0">Short descriptions were condensed or written for Lift Tracker. “Watch on YouTube” opens a YouTube search, not a specific video. The bundled Starter PPL is a suggested routine to edit to fit you.</p></div>`;
  }

  /* ---------- routing ---------- */
  /* History model. Every entry carries state {lt, idx, chain}: lt 'page' = a screen, 'sheet' = an open sheet over the page
     below (same URL), 'dead' = a sheet that was closed in-app (skipped when travelling back/forward). chain = the page
     hashes from the first entry to this one, so go(x) to the page we came from is a real history.back() — the stack never
     grows into loops (session → picker → session) and back from the workout's sub-screens always lands on the workout. */
  let navIdx = 0; let navJump = false; let navPrev = null; let lastRouted = null; let sessionScroll = 0;
  const curHash = () => location.hash || '#/workout';
  function navState() { const st = history.state; return st && st.lt ? st : { lt: 'page', idx: navIdx, chain: [curHash()] }; }
  const trimChain = (c) => c.slice(-60);
  function navSync() { navPrev = navState(); navIdx = navPrev.idx; }
  function go(hash, opts = {}) {
    if (overlay) closeOverlay();
    if (sheetOpen()) hideSheet();
    const st = navState(); const below = st.lt === 'page' ? 0 : 1; const chain = st.chain || [curHash()];
    if (hash === curHash()) { if (st.lt !== 'page') history.replaceState({ ...st, lt: 'dead' }, '', location.href); route(); return; }
    const at = chain.lastIndexOf(hash, chain.length - 2); // back to where we came from (or, for the workout, to it from any of its sub-screens)
    if (!opts.push && at >= 0 && (at === chain.length - 2 || hash === '#/session')) { navJump = true; history.go(-(chain.length - 1 - at + below)); return; }
    if (below) history.replaceState({ lt: 'page', idx: st.idx, chain: trimChain([...chain, hash]) }, '', hash); // reuse the sheet's entry
    else history.pushState({ lt: 'page', idx: st.idx + 1, chain: trimChain([...chain, hash]) }, '', hash);
    navSync(); route();
  }
  function navReplace(hash) { const st = navState(); const chain = (st.chain || [curHash()]).slice(0, -1); history.replaceState({ lt: 'page', idx: st.idx, chain: [...chain, hash] }, '', hash); navSync(); }
  window.addEventListener('popstate', () => {
    const st = history.state && history.state.lt ? history.state : null; const prev = navPrev; const oldIdx = navIdx;
    if (!st) { navReplace(curHash()); } // entry made by a plain hash link
    const now = navState(); const dir = now.idx < oldIdx ? -1 : 1; navSync();
    const jump = navJump; navJump = false;
    if (now.lt === 'dead' || (now.lt === 'sheet' && !layerOpen())) { if (now.lt === 'sheet') { history.replaceState({ ...now, lt: 'dead' }, '', location.href); navSync(); } hideLayer(); history.go(dir); return; }
    if (layerOpen()) { hideLayer(); if (curHash() === lastRouted) return; } // back closes the top sheet; the page stays as it was
    else if (!jump && dir < 0 && prev && prev.lt === 'dead' && curHash() === lastRouted) { history.go(-1); return; } // left a closed-sheet entry: keep going
    if (curHash() !== lastRouted) route();
  });
  function route() {
    const h = location.hash || '#/workout'; const parts = h.slice(2).split('/').map(decodeURIComponent);
    if (lastRouted && lastRouted.startsWith('#/session') && !h.startsWith('#/session')) sessionScroll = window.scrollY; // remember where you were in the workout
    const backToSession = h.startsWith('#/session') && lastRouted !== null && !lastRouted.startsWith('#/session');
    lastRouted = h;
    if (parts[0] !== 'exercises' && pickCtx) pickCtx = null;
    const tab = { session: 'workout', help: 'settings', import: 'programs', stats: 'history', summary: 'history' }[parts[0]] || parts[0];
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    closeSheet(); if (overlay && overlay.kind === 'tip') closeOverlay();
    switch (parts[0]) {
      case 'session': viewSession(); break;
      case 'history': parts[1] ? viewWorkoutDetail(parts[1], parts[2] === 'summary') : viewHistory(); break;
      case 'stats': viewStats(); break;
      case 'exercises': parts[1] ? viewExerciseDetail(parts.slice(1).join('/')) : viewExercises(); break;
      case 'programs': parts[2] === 'day' ? viewDayEditor(parts[1], +parts[3], +parts[4]) : parts[1] ? viewProgramDetail(parts[1]) : viewPrograms(); break;
      case 'import': parts[1] === 'paste' ? viewPaste() : parts[1] === 'link' ? importLink(parts.slice(2).join('/')) : viewImportPreview(); break;
      case 'settings': viewSettings(); break;
      case 'help': viewHelp(); break;
      default: viewWorkout();
    }
    if (!h.startsWith('#/session')) window.scrollTo(0, 0);
    else if (backToSession && scrollToEx == null && D.current) { const y = sessionScroll; window.scrollTo(0, y); requestAnimationFrame(() => window.scrollTo(0, y)); }
    syncWake();
    if (ON) ON.onRoute();
  }
  /* ---------- keep the screen awake during a workout (Wake Lock API) ---------- */
  let wakeSentinel = null; let wakeBusy = false;
  async function syncWake() {
    if (wakeBusy) return; wakeBusy = true;
    try {
      const want = !!(D.settings.wakeLock && D.current && !D.current.backdated && document.visibilityState === 'visible' && navigator.wakeLock);
      if (want && !wakeSentinel) {
        try { const sn = await navigator.wakeLock.request('screen'); wakeSentinel = sn; sn.addEventListener('release', () => { if (wakeSentinel === sn) wakeSentinel = null; wakeInd(); }); } catch (e) { wakeSentinel = null; }
      } else if (!want && wakeSentinel) { const sn = wakeSentinel; wakeSentinel = null; try { await sn.release(); } catch (e) { /* already released */ } }
    } finally { wakeBusy = false; wakeInd(); }
  }
  function wakeInd() { const el = $('#wake-ind'); if (el) el.textContent = wakeSentinel ? ' · ☀︎ screen on' : ''; }
  /* ---------- program share links (#/import/link/<code>) ---------- */
  async function importLink(code) {
    view.innerHTML = '<div class="empty">Reading shared program…</div>'; setTop('<h1>Shared program</h1>');
    try {
      const raw = await X.decodeProgram(code); const res = L.normalizeProgram(raw); res.program.id = uid(); delete res.program.builtIn;
      pendingImport = { results: [{ ...res, ignored: [] }], kind: 'link' }; navReplace('#/import/preview'); lastRouted = '#/import/preview'; viewImportPreview();
    } catch (e) { view.innerHTML = `<div class="empty"><h2>Link couldn't be read</h2><p>${esc(e.message)}</p><button class="btn" data-act="go" data-to="#/programs">Programs</button></div>`; }
  }
  async function shareProgramSheet(p) {
    openSheet(`<h3>Share “${esc(p.name)}”</h3><p class="small mute">Send the program as a file, or as a link that opens Lift Tracker and imports it. Nothing is uploaded — the whole program is inside the link.</p>
      <button class="btn primary block" data-act="share-prog-file" data-id="${p.id}">📄 Share as file (.json)</button>
      <label class="lbl" for="share-link">Link</label><input id="share-link" readonly value="Building link…">
      <div class="row" style="margin-top:8px"><button class="btn grow" data-act="copy-link">📋 Copy link</button>${navigator.share ? '<button class="btn grow" data-act="share-link">📤 Share link</button>' : ''}</div>
      <p class="tiny mute" id="share-len"></p>`);
    const code = await X.encodeProgram(p); const url = location.href.split('#')[0] + '#/import/link/' + code;
    const i = $('#share-link'); if (i) { i.value = url; $('#share-len').textContent = `${url.length.toLocaleString()} characters${url.length > 8000 ? ' — long; the file option is more reliable for messaging apps' : ''}`; }
  }
  async function shareFile(name, text, type, title) {
    const file = typeof File !== 'undefined' ? new File([text], name, { type }) : null;
    if (file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title }); return 'share'; } catch (e) { if (e && e.name === 'AbortError') return 'abort'; } }
    download(name, text, type); return 'download';
  }
  /* ---------- small sheets ---------- */
  function rpeSheet(ei, si) {
    rpeCtx = { ei, si }; const rir = D.settings.effortScale === 'rir'; const vals = rir ? [5, 4, 3, 2, 1, 0] : [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
    openSheet(`<h3>${rir ? 'Reps in reserve' : 'RPE'} · set ${si + 1}</h3><p class="tiny mute" style="margin:0">${rir ? 'How many more reps could you have done?' : '10 = max effort · 9 = 1 rep left · 8 = 2 left · 7 = 3 left'}</p>
      <div class="chips rpe-chips">${vals.map((v) => `<button data-act="rpe-set" data-v="${rir ? 10 - v : v}">${v}</button>`).join('')}<button data-act="rpe-set" data-v="">Clear</button></div>`);
  }
  function pinSheet(name) {
    openSheet(`<h3>📌 Pinned note</h3><p class="tiny mute" style="margin:0 0 8px">Shows on ${esc(name)} every session (seat height, grip, cues…).</p>
      <textarea id="pin-text" rows="3" placeholder="e.g. Seat 4, pins at hole 6, elbows tucked">${esc(pref(name).pin || '')}</textarea>
      <div class="row" style="margin-top:10px"><button class="btn grow" data-act="pin-save" data-name="${esc(name)}" data-clear="1">Remove</button><button class="btn primary grow" data-act="pin-save" data-name="${esc(name)}">Save</button></div>`);
    setTimeout(() => { const t = $('#pin-text'); if (t) t.focus(); }, 50);
  }
  function prefsSheet(name) {
    const p = pref(name); const u = (D.current && D.current.unit) || unit();
    const ex = (D.current && D.current.exercises.find((e) => norm(e.name) === norm(name))) || { name, target: {} };
    const defInc = X.defaultIncrement(u, equipOf(ex));
    openSheet(`<h3>${esc(name)}</h3>
      <label class="lbl" for="pf-mode">Progression</label><select id="pf-mode">${[['auto', 'Auto — rep range: double · fixed reps: linear'], ['double', 'Double — add reps to the top, then weight'], ['linear', 'Linear — add weight after every success'], ['off', 'Off — no suggestions']].map(([v, l]) => `<option value="${v}" ${(p.mode || 'auto') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="row"><div class="grow"><label class="lbl" for="pf-inc">Weight step (${esc(u)})</label><input id="pf-inc" inputmode="decimal" value="${p.inc ? fmtNum(round(conv(p.inc, p.incUnit || u, u))) : ''}" placeholder="${fmtNum(defInc)}"></div>
        <div class="grow"><label class="lbl" for="pf-deload">Deload after 3 misses (%)</label><input id="pf-deload" inputmode="numeric" value="${p.deload ?? ''}" placeholder="10"></div></div>
      <div class="row"><div class="grow"><label class="lbl" for="pf-rest">Working rest</label><input id="pf-rest" value="${p.restWork != null ? fmtClock(p.restWork) : ''}" placeholder="${fmtClock(restFor(ex.target || {}))} (default)"></div>
        <div class="grow"><label class="lbl" for="pf-rest-wu">Warm-up rest</label><input id="pf-rest-wu" value="${p.restWarm != null ? fmtClock(p.restWarm) : ''}" placeholder="${fmtClock(Math.min(D.settings.restWarmup ?? 60, restFor(ex.target || {})))} (default)"></div></div>
      <p class="tiny mute">Type rest as 90, 1:30 or 2 min (0 = no timer). Leave empty for the defaults. Applies to this exercise in every workout.</p>
      <button class="btn primary block" data-act="pf-save" data-name="${esc(name)}">Save</button>`);
  }
  function restTypeSheet(ctx) {
    restTypeCtx = ctx; const cur = ctx.k === 'timer' ? (D.current && D.current.rest ? Math.max(0, Math.round((D.current.rest.endAt - Date.now()) / 1000)) : restFor({})) : D.settings[ctx.k] ?? 60;
    openSheet(`<h3>${ctx.k === 'timer' ? 'Set rest timer' : ctx.k === 'restWarmup' ? 'Warm-up set rest' : 'Default rest time'}</h3>
      <input id="rt-in" class="bigval" value="${fmtClock(cur)}" inputmode="text" aria-label="rest time" placeholder="1:30">
      <div class="tiny mute" style="text-align:center;margin-top:4px">Type 90, 1:30 or 2 min</div>
      <div class="chips">${[45, 60, 90, 120, 150, 180, 240, 300].map((v) => `<button data-act="rt-chip" data-v="${v}">${fmtClock(v)}</button>`).join('')}</div>
      <button class="btn primary block" data-act="rt-save">Set</button>`);
    setTimeout(() => { const i = $('#rt-in'); if (i) { i.focus(); i.select(); } }, 50);
  }
  function addWarmups(ei) {
    const ex = D.current.exercises[ei]; const u = D.current.unit;
    const wi = ex.sets.findIndex((x) => x.type === 'working'); if (wi < 0) { toast('Add a working set first'); return; }
    const ph = placeholders(ex, wi, lastPerformance(ex.name)); const work = ex.sets[wi].weight ?? ph.w;
    if (!(work > 0)) { toast('Set the working weight first'); openWeightSheet(ei, wi); return; }
    const cfg = plateCfg(u); const bar = usesBar(ex) ? cfg.bar : 0;
    const smallest = Math.min(...Object.keys(cfg.plates).filter((k) => cfg.plates[k] > 0).map(Number));
    const step = bar ? smallest * 2 : u === 'kg' ? 2 : 5;
    const list = X.warmups(work, D.settings.warmupRamp, { bar, step });
    if (!list.length) { toast('Working weight is too light for warm-ups'); return; }
    ex.sets = ex.sets.filter((x) => !(x.type === 'warmup' && !x.done));
    const at = ex.sets.findIndex((x) => x.type === 'working');
    ex.sets.splice(at < 0 ? 0 : at, 0, ...list.map((x) => ({ type: 'warmup', weight: x.weight, reps: x.reps, done: false })));
    S.save('current'); closeSheet(); rerenderEx(ei);
    toast(`Added ${list.length} warm-up sets: ${list.map((x) => `${fmtNum(x.weight)}×${x.reps}`).join(', ')}`, 3200);
  }
  /* ---------- Strong / Hevy CSV history import ---------- */
  function mapImportedName(raw, names) {
    const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/); const cands = [raw]; if (m) cands.push(`${m[2]} ${m[1]}`, m[1]);
    for (const c of cands) if (names.has(norm(c))) return { name: names.get(norm(c)) };
    for (const c of cands) {
      const l = LIB.find(c); if (!l) continue;
      for (const [, n] of names) if (LIB.find(n) === l) return { name: n, libraryId: l.id };
      return { name: raw, libraryId: l.id, equipment: l.equipment };
    }
    return { name: raw };
  }
  function histImportSheet() {
    const r = pendingHist.res; const ws = r.workouts; const u = pendingHist.unit;
    const keys = new Set(D.workouts.map((w) => Math.floor(new Date(w.startedAt).getTime() / 60000) + '|' + norm(w.dayName)));
    const dup = ws.filter((w) => keys.has(Math.floor(new Date(w.startedAt).getTime() / 60000) + '|' + norm(w.dayName))).length;
    const fmtName = { strong: 'Strong', hevy: 'Hevy', 'lift-tracker': 'Lift Tracker' }[r.format];
    openSheet(`<h3>Import workout history</h3>
      <p class="small" id="hist-info">Detected a <b>${fmtName}</b> export: <b>${ws.length}</b> workouts, ${r.sets} sets${ws.length ? `, ${esc(fmtDate(ws[ws.length - 1].startedAt))} – ${esc(fmtDate(ws[0].startedAt))}` : ''}.</p>
      ${dup ? `<div class="warnbox" id="hist-dup">${dup} already in your history — they'll be skipped.</div>` : ''}
      ${r.unitKnown ? `<p class="tiny mute">Weights are in ${esc(r.unit)}.</p>` : `<label class="lbl">Weights in this file are in</label><div class="seg"><button class="${u === 'lb' ? 'on' : ''}" data-act="hist-unit" data-u="lb">lb</button><button class="${u === 'kg' ? 'on' : ''}" data-act="hist-unit" data-u="kg">kg</button></div><p class="tiny mute">Strong doesn't say — it uses the unit set in its app.</p>`}
      <p class="tiny mute">Nothing is replaced — workouts are added to your history and exercise names are matched to the library where possible.</p>
      <button class="btn primary block" data-act="hist-import" ${ws.length - dup > 0 ? '' : 'disabled'}>Import ${ws.length - dup} workout${ws.length - dup === 1 ? '' : 's'}</button><button class="btn block" style="margin-top:8px" data-act="sheet-close">Cancel</button>`);
  }
  async function doHistImport() {
    const { res, unit: u } = pendingHist; const names = new Map();
    D.workouts.forEach((w) => w.exercises.forEach((e) => names.set(norm(e.name), e.name)));
    D.programs.forEach((p) => p.weeks.forEach((wk) => wk.days.forEach((d) => d.exercises.forEach((e) => { if (!names.has(norm(e.name))) names.set(norm(e.name), e.name); }))));
    const keys = new Set(D.workouts.map((w) => Math.floor(new Date(w.startedAt).getTime() / 60000) + '|' + norm(w.dayName)));
    const cache = new Map(); let added = 0;
    res.workouts.forEach((w) => {
      if (keys.has(Math.floor(new Date(w.startedAt).getTime() / 60000) + '|' + norm(w.dayName))) return;
      const nw = { ...w, id: uid(), unit: res.format === 'lift-tracker' ? w.unit : u, programId: null, weekIdx: null, dayIdx: null, weekName: '', dayNotes: '' };
      nw.exercises = w.exercises.map((e) => {
        if (!cache.has(e.name)) cache.set(e.name, mapImportedName(e.name, names)); const mp = cache.get(e.name);
        const ne = { ...e, uid: uid(), name: mp.name, origName: mp.name, libraryId: mp.libraryId || null };
        if (!ne.bodyweight && e.sets.every((x) => !x.weight) && mp.equipment === 'bodyweight') ne.bodyweight = true;
        return ne;
      });
      D.workouts.push(nw); added++;
    });
    D.workouts.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)); pendingHist = null;
    await S.saveNow('workouts'); closeSheet(); toast(`Imported ${added} workout${added === 1 ? '' : 's'}`); go('#/history');
  }

  /* ---------- program actions ---------- */
  async function loadSample() {
    if (D.programs.some((p) => p.id === 'sample-example-ppl')) { D.settings.activeProgramId = 'sample-example-ppl'; await S.saveNow('settings'); toast('Sample program is already loaded'); route(); return; }
    try {
      const res = await fetch('sample/example-ppl.json'); const raw = await res.json();
      const { program } = L.normalizeProgram(raw); program.id = 'sample-example-ppl';
      D.programs.push(program); if (!D.settings.activeProgramId) D.settings.activeProgramId = program.id;
      await Promise.all([S.saveNow('programs'), S.saveNow('settings')]); toast('Loaded Example PPL (sample)'); route();
    } catch (e) { toast('Could not load sample: ' + e.message, 4000); }
  }
  async function savePending() {
    for (const r of pendingImport.results) {
      const p = r.program;
      if (D.programs.some((x) => x.id === p.id)) p.id = uid();
      D.programs.push(p);
    }
    const last = pendingImport.results[pendingImport.results.length - 1].program;
    if (!D.settings.activeProgramId || confirm(`Make "${last.name}" your active program?`)) D.settings.activeProgramId = last.id;
    pendingImport = null; pasteDraft = { text: '', name: '', repeat: 1 };
    await Promise.all([S.saveNow('programs'), S.saveNow('settings')]); selectedWeek = null;
    toast('Program saved'); go('#/programs/' + last.id);
  }
  async function handleFile(file, kind) {
    const text = await file.text();
    try {
      if (kind === 'history') {
        const res = X.parseHistoryCSV(text, { unit: unit() }); if (!res.workouts.length) throw new Error('No workouts found in this file');
        pendingHist = { res, unit: res.unitKnown ? res.unit : unit() }; histImportSheet(); return;
      }
      if (kind === 'backup') {
        const obj = JSON.parse(text);
        const merge = confirm('Merge with existing data? (Cancel = replace everything on this device)');
        if (!merge && !confirm('Replace ALL data on this device with this backup?')) return;
        await S.restore(obj, merge ? 'merge' : 'replace'); await migrateStarterPPL(); toast('Backup restored'); route(); return;
      }
      let results;
      const base = file.name.replace(/\.[^.]+$/, '');
      if (/\.csv$|\.tsv$/i.test(file.name) || (!/^\s*[[{]/.test(text) && /,|\t/.test(text.split('\n')[0]))) {
        try { results = [L.parseCSV(text, base)]; } catch (e) { results = [L.parsePastedText(text, { name: base })]; }
      } else if (/^\s*[[{]/.test(text)) results = L.parseJSONProgram(text);
      else results = [L.parsePastedText(text, { name: base })];
      pendingImport = { results, kind: 'file' }; go('#/import/preview');
    } catch (e) { alert('Import failed: ' + e.message); }
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async (ev) => {
    const tab = ev.target.closest('.tab');
    if (tab) { go('#/' + tab.dataset.tab, { push: !!D.current }); return; } // with a workout open, tabs stack on top of it, so back returns to the workout
    if (ev.target.id === 'sheet-backdrop') { closeSheet(); return; }
    const b = ev.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'TEXTAREA' || b.tagName === 'SELECT') return;
    const a = b.dataset.act; const row = b.closest('tr.set'); const exEl = b.closest('.ex');
    const ei = row ? +row.dataset.e : exEl ? +exEl.dataset.e : +b.dataset.e; const si = row ? +row.dataset.s : null;
    const c = D.current;
    switch (a) {
      case 'go': go(b.dataset.to); break;
      case 'back': navState().idx > 0 ? history.back() : go('#/exercises'); break;
      case 'yt': break;
      case 'sheet-close': closeSheet(); break;
      case 'apply-update': applyUpdate(); break;
      case 'tour-replay': ON.replayTour(); break;
      case 'tips-reset': ON.resetTips(); toast('Tips will show again as you use the app'); break;
      case 'check-update': checkUpdate(true); break;
      case 'load-sample': loadSample(); break;
      case 'restore-builtins': D.meta.seeded = false; await seedBuiltIns(); toast('Built-in programs restored'); route(); break;
      case 'week': selectedWeek = +b.dataset.w; viewWorkout(); break;
      case 'day-preview': dayPreview(+b.dataset.w, +b.dataset.d); break;
      case 'start': closeSheet(); startWorkout(activeProgram(), +b.dataset.w, +b.dataset.d); break;
      case 'start-empty': startWorkout(null); break;
      case 'done': completeSet(ei, si); break;
      case 'rep+': case 'rep-': {
        const s = c.exercises[ei].sets[si]; const ph = placeholders(c.exercises[ei], si, lastPerformance(c.exercises[ei].name));
        const base = s.reps ?? ph.r ?? 0; const st = isTime(c.exercises[ei]) ? 5 : 1; s.reps = Math.max(0, a === 'rep+' ? (s.reps == null && ph.r != null ? base : base + st) : base - st);
        row.querySelector('input[data-act="reps"]').value = s.reps; S.save('current'); break;
      }
      case 'use-prev': { const ex = c.exercises[ei]; const ph = placeholders(ex, si, lastPerformance(ex.name)); if (ph.prev) { ex.sets[si].weight = round(conv(ph.prev.weight, ph.prevUnit, c.unit)); ex.sets[si].reps = ph.prev.reps; S.save('current'); rerenderEx(ei); } break; }
      case 'weight': openWeightSheet(ei, si); break;
      case 'wstep': { const i = $('#wval'); const v = parseFloat(i.value || i.placeholder || 0) || 0; i.value = fmtNum(Math.max(0, v + parseFloat(b.dataset.d))); updPlates(); break; }
      case 'plates-show': b.remove(); updPlates(true); break;
      case 'plate-use': { const i = $('#wval') || $('#pc-total'); i.value = fmtNum(+b.dataset.v); if (i.id === 'wval') updPlates(); else $('#pc-out').innerHTML = platesHTML(i.value, unit()); break; }
      case 'set-type': {
        const s = c.exercises[ei].sets[si]; const order = ['working', 'warmup', 'failure', 'drop']; const cur = s.type === 'warmup' ? 'warmup' : s.tag || 'working';
        const nx = order[(order.indexOf(cur) + 1) % order.length]; s.type = nx === 'warmup' ? 'warmup' : 'working'; if (nx === 'failure' || nx === 'drop') s.tag = nx; else delete s.tag;
        S.save('current'); rerenderEx(ei); toast({ working: 'Normal set', warmup: 'Warm-up set', failure: 'Set to failure', drop: 'Drop set — no rest before it' }[nx], 1400); break;
      }
      case 'rpe': rpeSheet(ei, si); break;
      case 'rpe-set': { const { ei: e, si: s2 } = rpeCtx; const set = c.exercises[e].sets[s2]; if (b.dataset.v === '') delete set.rpe; else set.rpe = +b.dataset.v; S.save('current'); closeSheet(); rerenderEx(e); break; }
      case 'sugg-use': {
        const ex = c.exercises[ei]; const sg = suggestionFor(ex); if (!sg) break; let k = 0;
        ex.sets.forEach((x) => { if (x.type !== 'working' || x.tag === 'drop') return; const j = Math.min(k++, sg.w.length - 1); if (!x.done) { if (x.weight == null) x.weight = sg.w[j]; if (x.reps == null) x.reps = sg.r[j]; } });
        S.save('current'); rerenderEx(ei); break;
      }
      case 'ex-warmup': addWarmups(ei); break;
      case 'ex-replace': closeSheet(); pickCtx = { mode: 'replace', ei }; lib.q = ''; lib.limit = 120; go('#/exercises'); break;
      case 'pin-edit': { const nm = b.dataset.name || (c && c.exercises[ei] && c.exercises[ei].name); if (nm) pinSheet(nm); break; }
      case 'pin-save': {
        const nm = b.dataset.name; await setPref(nm, { pin: b.dataset.clear ? null : $('#pin-text').value.trim() }); closeSheet();
        if (location.hash.startsWith('#/session')) viewSession(); else route(); toast(b.dataset.clear ? 'Pinned note removed' : 'Note pinned 📌'); break;
      }
      case 'ex-prefs': case 'ex-rest': { const nm = b.dataset.name || (c && c.exercises[ei] && c.exercises[ei].name); if (nm) prefsSheet(nm); break; }
      case 'pf-save': {
        const nm = b.dataset.name; const u = (c && c.unit) || unit();
        const inc = parseFloat(($('#pf-inc').value || '').replace(',', '.')); const dl = parseInt($('#pf-deload').value, 10);
        const rw = parseRestInput($('#pf-rest').value); const rwu = parseRestInput($('#pf-rest-wu').value);
        if (Number.isNaN(rw) || Number.isNaN(rwu)) { toast('Type rest like 90, 1:30 or 2 min'); break; }
        const mode = $('#pf-mode').value;
        await setPref(nm, { mode: mode === 'auto' ? null : mode, inc: inc > 0 ? inc : null, incUnit: inc > 0 ? u : null, deload: dl > 0 && dl < 90 ? dl : null, restWork: rw, restWarm: rwu });
        closeSheet(); if (location.hash.startsWith('#/session')) viewSession(); else route(); toast('Saved for ' + nm); break;
      }
      case 'rest-type': restTypeSheet({ k: b.dataset.k }); break;
      case 'rt-chip': $('#rt-in').value = fmtClock(+b.dataset.v); break;
      case 'rt-save': {
        const v = parseRestInput($('#rt-in').value); if (v == null || Number.isNaN(v)) { toast('Type rest like 90, 1:30 or 2 min'); break; }
        const k = restTypeCtx && restTypeCtx.k; closeSheet();
        if (k === 'timer') { if (c) { if (v > 0) startRest(v, c.rest ? c.rest.label : 'Rest'); else { c.rest = null; S.save('current'); tickRest(); } } }
        else if (k) { D.settings[k] = Math.max(k === 'restWarmup' ? 0 : 15, Math.min(1800, v)); viewSettings(); await S.saveNow('settings'); }
        break;
      }
      case 'cal-nav': { calMonth.m += +b.dataset.d; if (calMonth.m < 0) { calMonth.m = 11; calMonth.y--; } if (calMonth.m > 11) { calMonth.m = 0; calMonth.y++; } histDay = null; viewHistory(); break; }
      case 'cal-day': {
        const k = b.dataset.k; const ws = D.workouts.filter((w) => X.dayKey(w.startedAt) === k);
        if (ws.length === 1) go('#/history/' + ws[0].id); else if (ws.length) { histDay = k; viewHistory(); } else backdateSheet(k); break;
      }
      case 'cal-all': histDay = null; viewHistory(); break;
      case 'backdate-start': { const v = $('#bd-day').value; const p = activeProgram(); closeSheet(); if (v && p) { const [wi, di] = v.split('/').map(Number); startWorkout(p, wi, di, { backdate: b.dataset.k }); } else startWorkout(null, 0, 0, { backdate: b.dataset.k }); break; }
      case 'stats-range': statsRange = +b.dataset.d; b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); $('#heat-body').innerHTML = heatmapHTML(statsRange); break;
      case 'rep-nav': { reportMonth.m += +b.dataset.d; if (reportMonth.m < 0) { reportMonth.m = 11; reportMonth.y--; } if (reportMonth.m > 11) { reportMonth.m = 0; reportMonth.y++; } $('#report').innerHTML = '<div class="mute tiny" style="margin-bottom:6px">MONTHLY REPORT</div>' + monthReportHTML(); break; }
      case 'chart-metric': chartState.metric = b.dataset.k; if (detailHist) $('#pchart').innerHTML = chartHTML(detailHist); break;
      case 'chart-range': chartState.range = +b.dataset.d; if (detailHist) $('#pchart').innerHTML = chartHTML(detailHist); break;
      case 'share-img': shareWorkout(b.dataset.id); break;
      case 'share-program': shareProgramSheet(D.programs.find((x) => x.id === b.dataset.id)); break;
      case 'share-prog-file': { const p = D.programs.find((x) => x.id === b.dataset.id); const r = await shareFile(slug(p.name) + '.json', JSON.stringify(p, null, 2), 'application/json', p.name); if (r === 'download') toast('Program file saved'); break; }
      case 'copy-link': { const v = $('#share-link').value; try { await navigator.clipboard.writeText(v); toast('Link copied'); } catch (e) { $('#share-link').select(); toast('Select the link and copy it'); } break; }
      case 'share-link': { const v = $('#share-link').value; try { await navigator.share({ url: v, title: 'Lift Tracker program' }); } catch (e) { /* cancelled */ } break; }
      case 'export-csv': download(`lift-tracker-history-${new Date().toISOString().slice(0, 10)}.csv`, X.historyCSV(D.workouts, isTime, isBW), 'text/csv'); toast(`Exported ${D.workouts.length} workouts`); break;
      case 'hist-unit': pendingHist.unit = b.dataset.u; histImportSheet(); break;
      case 'hist-import': doHistImport(); break;
      case 'effort-scale': D.settings.effortScale = b.dataset.v; viewSettings(); await S.saveNow('settings'); break;
      case 'goal-adj': D.settings.weeklyGoal = Math.max(1, Math.min(14, (D.settings.weeklyGoal || 3) + +b.dataset.d)); $('#goal-val').textContent = D.settings.weeklyGoal; S.save('settings'); break;
      case 'wsave': {
        const { ei: e, si: s } = weightCtx; const ex = c.exercises[e];
        const raw = $('#wval').value.replace(',', '.'); const v = b.dataset.bw ? 0 : raw === '' ? null : Math.max(0, parseFloat(raw));
        ex.sets[s].weight = Number.isFinite(v) ? v : null;
        if (b.dataset.fill) for (let j = s + 1; j < ex.sets.length; j++) if (!ex.sets[j].done && ex.sets[j].type === ex.sets[s].type) ex.sets[j].weight = ex.sets[s].weight;
        S.save('current'); closeSheet(); rerenderEx(e); break;
      }
      case 'add-set': { const ex = c.exercises[ei]; const lastSet = ex.sets[ex.sets.length - 1]; ex.sets.push({ type: 'working', weight: lastSet ? lastSet.weight : null, reps: null, done: false }); S.save('current'); rerenderEx(ei); break; }
      case 'rm-set': { // removes the last unchecked set; logged sets only after a confirm
        const ex = c.exercises[ei]; let j = -1; for (let k = ex.sets.length - 1; k >= 0; k--) if (!ex.sets[k].done) { j = k; break; }
        if (j < 0) { if (!ex.sets.length || !confirm('All sets are logged. Remove the last logged set?')) break; j = ex.sets.length - 1; }
        ex.sets.splice(j, 1); S.save('current'); rerenderEx(ei); break;
      }
      case 'ex-menu': exMenu(ei); break;
      case 'swap': c.exercises[ei].name = b.dataset.name; applyLib(c.exercises[ei]); S.save('current'); closeSheet(); rerenderEx(ei); break;
      case 'swap-custom': { const n = prompt('Exercise name'); if (n && n.trim()) { c.exercises[ei].name = n.trim(); applyLib(c.exercises[ei]); S.save('current'); closeSheet(); rerenderEx(ei); } break; }
      case 'ex-info': openInfo(libFor(c.exercises[ei])); break;
      case 'info-name': openInfo(LIB.find(b.dataset.name, b.dataset.id)); break;
      case 'ex-move': { const d = +b.dataset.d; const j = ei + d; if (j >= 0 && j < c.exercises.length) { const arr = c.exercises; [arr[ei], arr[j]] = [arr[j], arr[ei]]; S.save('current'); closeSheet(); viewSession(); } break; }
      case 'ex-remove': if (confirm('Remove this exercise from today\'s workout?')) { c.exercises.splice(ei, 1); S.save('current'); closeSheet(); viewSession(); } break;
      case 'ex-history': closeSheet(); go('#/exercises/' + encodeURIComponent(b.dataset.name)); break;
      case 'add-ex': pickCtx = { mode: 'session' }; lib.q = ''; lib.limit = 120; go('#/exercises'); break;
      case 'lib-open': go('#/exercises/' + encodeURIComponent(b.dataset.id)); break;
      case 'lib-add': { const l = LIB.byId(b.dataset.id); if (l) await addFromLibrary(l, !!b.closest('.lib-row')); break; }
      case 'lib-more': lib.limit = 100000; renderLibResults(); break;
      case 'lib-eq': case 'lib-mus': {
        lib[a === 'lib-eq' ? 'eq' : 'mus'] = b.dataset.v; lib.limit = 120;
        b.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); renderLibResults(); break;
      }
      case 'pick-done': { const pc = pickCtx; pickCtx = null; go(pc && pc.mode === 'program' ? `#/programs/${pc.programId}/day/${pc.wi}/${pc.di}` : D.current ? '#/session' : '#/exercises'); break; }
      case 'demo-toggle': b.classList.toggle('paused'); break;
      case 'add-menu': addSheetProg = null; addMenu(LIB.byId(b.dataset.id)); break;
      case 'add-pick-prog': addSheetProg = b.dataset.pid; addMenu(LIB.byId(b.dataset.id)); break;
      case 'add-to-day': { const p = D.programs.find((x) => x.id === addSheetProg); const l = LIB.byId(b.dataset.id); if (p && l) { await addToDay(p, +b.dataset.w, +b.dataset.d, l); closeSheet(); } break; }
      case 'add-to-current': { const l = LIB.byId(b.dataset.id); if (l && c) { c.exercises.push(makeExercise(defaultTarget(l))); scrollToEx = c.exercises.length - 1; await S.saveNow('current'); toast(`Added ${l.name}`); go('#/session'); } break; }
      case 'custom-new': customSheet(b.dataset.name || lib.q.trim()); break;
      case 'custom-save': {
        const name = $('#cx-name').value.trim(); if (!name) { toast('Give it a name'); break; }
        const m = $('#cx-mus').value; const eq = $('#cx-eq').value;
        const e = { id: 'custom-' + uid(), name, equipment: eq, primary: [m], secondary: [], category: MUSCLE_CAT[m] || 'legs', desc: $('#cx-desc').value.trim() || 'Custom exercise.', images: [], source: 'custom' };
        if ($('#cx-tr').value === 'time') e.tracking = 'time';
        D.custom.push(e); await S.saveNow('custom'); LIB.setCustom(D.custom); closeSheet(); toast('Custom exercise saved');
        go('#/exercises/' + encodeURIComponent(e.id)); break;
      }
      case 'custom-del': if (confirm('Delete this custom exercise? Logged history is kept.')) { D.custom = D.custom.filter((x) => x.id !== b.dataset.id); S.data.custom = D.custom; await S.saveNow('custom'); LIB.setCustom(D.custom); go('#/exercises'); } break;
      case 'new-program': newProgramSheet(); break;
      case 'np-create': {
        const name = $('#np-name').value.trim() || 'My program';
        const days = $('#np-days').value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean); if (!days.length) days.push('Day 1');
        const p = { schema: 'lift-tracker/program@1', id: uid(), name, author: '', description: '', source: '', schedule: [], createdAt: new Date().toISOString(), custom: true,
          weeks: [{ id: uid(), name: 'Week 1', notes: '', days: days.map((n) => ({ id: uid(), name: n, notes: '', exercises: [] })) }] };
        D.programs.push(p); if ($('#np-active').checked || !D.settings.activeProgramId) D.settings.activeProgramId = p.id; selectedWeek = null;
        await Promise.all([S.saveNow('programs'), S.saveNow('settings')]); closeSheet(); toast('Program created'); go(`#/programs/${p.id}/day/0/0`); break;
      }
      case 'add-day': { const p = D.programs.find((x) => x.id === b.dataset.id); const w = p.weeks[+b.dataset.w]; const n = prompt('Day name', `Day ${w.days.length + 1}`); if (n && n.trim()) { w.days.push({ id: uid(), name: n.trim(), notes: '', exercises: [] }); p.edited = true; await S.saveNow('programs'); go(`#/programs/${p.id}/day/${b.dataset.w}/${w.days.length - 1}`); } break; }
      case 'ed-add': case 'ed-move': case 'ed-edit': case 'ed-rm': case 'ed-save': case 'ed-start': case 'ed-del-day': {
        const [, pid, , wi, di] = location.hash.slice(2).split('/').map(decodeURIComponent); const p = D.programs.find((x) => x.id === pid); if (!p) break;
        const d = p.weeks[+wi].days[+di]; const i = +b.dataset.i; const arr = d.exercises;
        if (a === 'ed-add') { pickCtx = { mode: 'program', programId: pid, wi: +wi, di: +di }; lib.q = ''; lib.limit = 120; go('#/exercises'); break; }
        if (a === 'ed-start') { startWorkout(p, +wi, +di); break; }
        if (a === 'ed-edit') { editExSheet(arr[i], i); break; }
        if (a === 'ed-move') { const j = i + +b.dataset.d; if (j < 0 || j >= arr.length) break; [arr[i], arr[j]] = [arr[j], arr[i]]; }
        if (a === 'ed-rm') { if (!confirm(`Remove ${arr[i].name} from ${d.name}?`)) break; arr.splice(i, 1); }
        if (a === 'ed-del-day') { if (!confirm(`Delete ${d.name}?`)) break; p.weeks[+wi].days.splice(+di, 1); p.edited = true; await S.saveNow('programs'); go('#/programs/' + p.id); break; }
        if (a === 'ed-save') {
          const e = arr[i]; const nm = $('#ee-name').value.trim() || e.name;
          if (nm !== e.name) { const l = LIB.find(nm); e.libraryId = l ? l.id : undefined; if (!l) delete e.libraryId; }
          e.name = nm; e.warmupSets = Math.max(0, parseInt($('#ee-wu').value, 10) || 0); e.workingSets = Math.max(1, parseInt($('#ee-sets').value, 10) || 1);
          e.reps = $('#ee-reps').value.trim(); e.rpe = $('#ee-rpe').value.trim(); e.notes = $('#ee-notes').value.trim();
          const typed = parseRestInput($('#ee-rest-txt').value); const wu = parseRestInput($('#ee-rest-wu').value);
          if (Number.isNaN(typed) || Number.isNaN(wu)) { toast('Type rest like 90, 1:30 or 2 min'); break; }
          const r = typed != null ? typed : parseInt($('#ee-rest').value, 10) || 0; e.restSeconds = r || null; e.rest = r ? fmtClock(r) : '';
          if (wu != null) e.restWarmupSeconds = wu; else delete e.restWarmupSeconds;
          if ($('#ee-tr').value === 'time') e.tracking = 'time'; else e.tracking = 'reps';
          if ($('#ee-bw').checked) e.bodyweight = true; else delete e.bodyweight;
          closeSheet();
        }
        p.edited = true; await S.saveNow('programs'); viewDayEditor(pid, +wi, +di); break;
      }
      case 'finish': finishWorkout(false); break;
      case 'finish-confirm': finishWorkout(true); break;
      case 'discard': if (confirm('Discard this workout? Nothing will be saved.')) { D.current = null; await S.saveNow('current'); tickRest(); syncWake(); go('#/workout'); } break;
      case 'rest-adj': if (c && c.rest) { c.rest.endAt = Math.max(Date.now() + 1000, c.rest.endAt + +b.dataset.d * 1000); restAlerted = false; c.rest.total = Math.max(c.rest.total, (c.rest.endAt - Date.now()) / 1000); S.save('current'); tickRest(); } break;
      case 'rest-skip': if (c) { c.rest = null; S.save('current'); tickRest(); } break;
      case 'del-workout': if (confirm('Delete this workout from history?')) { D.workouts = D.workouts.filter((w) => w.id !== b.dataset.id); S.data.workouts = D.workouts; await S.saveNow('workouts'); go('#/history'); } break;
      case 'pick-file': { const f = $('#file-input'); f.dataset.kind = b.dataset.kind; f.value = ''; f.click(); break; }
      case 'paste-parse': {
        pasteDraft = { text: $('#p-text').value, name: $('#p-name').value.trim(), repeat: Math.max(1, parseInt($('#p-rep').value, 10) || 1) };
        try { const r = L.parsePastedText(pasteDraft.text, { name: pasteDraft.name || 'Pasted program', repeatWeeks: pasteDraft.repeat }); pendingImport = { results: [r], kind: 'paste' }; go('#/import/preview'); } catch (e) { alert(e.message); }
        break;
      }
      case 'import-cancel': { const k = pendingImport && pendingImport.kind; pendingImport = null; go(k === 'paste' ? '#/import/paste' : '#/programs'); break; }
      case 'import-save': savePending(); break;
      case 'set-active': D.settings.activeProgramId = b.dataset.id; selectedWeek = null; await S.saveNow('settings'); toast('Active program set'); route(); break;
      case 'export-program': { const p = D.programs.find((x) => x.id === b.dataset.id); download(slug(p.name) + '.json', JSON.stringify(p, null, 2)); break; }
      case 'edit-program': { const p = D.programs.find((x) => x.id === b.dataset.id); openSheet(`<h3>Edit program JSON</h3><textarea id="pjson" rows="18">${esc(JSON.stringify(p, null, 2))}</textarea><button class="btn primary block" style="margin-top:10px" data-act="save-pjson" data-id="${p.id}">Save</button>`); break; }
      case 'save-pjson': {
        try { const { program } = L.normalizeProgram(JSON.parse($('#pjson').value)); program.id = b.dataset.id; const i = D.programs.findIndex((x) => x.id === b.dataset.id); D.programs[i] = program; await S.saveNow('programs'); closeSheet(); toast('Program updated'); route(); } catch (e) { alert(e.message); }
        break;
      }
      case 'del-program': if (confirm('Delete this program? Workout history is kept.')) { D.programs = D.programs.filter((p) => p.id !== b.dataset.id); S.data.programs = D.programs; if (D.settings.activeProgramId === b.dataset.id) D.settings.activeProgramId = D.programs[0] ? D.programs[0].id : null; await Promise.all([S.saveNow('programs'), S.saveNow('settings')]); go('#/programs'); } break;
      case 'units': D.settings.units = b.dataset.u; viewSettings(); await S.saveNow('settings'); break;
      case 'export-backup': download(`lift-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(S.backup(), null, 2)); toast('Backup exported'); break;
      case 'wipe': if (confirm('Erase ALL programs and workouts on this device?') && confirm('Really erase everything? Export a backup first if unsure.')) { await S.restore({ app: 'lift-tracker', programs: [], workouts: [], settings: {} }); toast('All data erased'); go('#/workout'); } break;
      case 'def-rest-adj': {
        if (b.dataset.k === 'restWarmup') { D.settings.restWarmup = Math.max(0, Math.min(600, (D.settings.restWarmup ?? 60) + +b.dataset.d)); $('#wu-rest-val').textContent = fmtClock(D.settings.restWarmup); }
        else { D.settings.defaultRest = Math.max(15, Math.min(600, (D.settings.defaultRest || 90) + +b.dataset.d)); $('#def-rest-val').textContent = fmtClock(D.settings.defaultRest); }
        S.save('settings'); break;
      }
      case 'test-sound': if (b.dataset.n === 'pr') celebratePR({ exercise: 'Test lift', type: 'Heaviest weight', value: `225 ${unit()} × 5` }); else window.LTSound.play(b.dataset.n); break;
      case 'install': if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } break;
    }
  });
  document.addEventListener('input', (ev) => {
    const t = ev.target; const a = t.dataset.act; if (!a) return;
    const c = D.current;
    if (a === 'reps') { const row = t.closest('tr.set'); const v = parseInt(t.value, 10); c.exercises[+row.dataset.e].sets[+row.dataset.s].reps = Number.isFinite(v) ? v : null; S.save('current'); }
    else if (a === 'ex-notes') { c.exercises[+t.closest('.ex').dataset.e].notes = t.value; S.save('current'); }
    else if (a === 'w-notes') { c.notes = t.value; S.save('current'); }
    else if (a === 'imp-name') { pendingImport.results[+t.dataset.i].program.name = t.value; }
    else if (a === 'lib-q') { lib.q = t.value; lib.limit = 120; renderLibResults(); }
    else if (a === 'day-name' || a === 'day-notes') {
      const [, pid, , wi, di] = location.hash.slice(2).split('/').map(decodeURIComponent); const p = D.programs.find((x) => x.id === pid); if (!p) return;
      p.weeks[+wi].days[+di][a === 'day-name' ? 'name' : 'notes'] = a === 'day-name' ? (t.value.trim() || 'Day') : t.value; p.edited = true; S.save('programs');
    }
    else if (a === 'volume') { D.settings.volume = parseInt(t.value, 10); S.save('settings'); }
    else if (a === 'pc-total') { $('#pc-out').innerHTML = platesHTML(t.value, unit()); }
  });
  document.addEventListener('input', (ev) => { if (ev.target.id === 'wval') updPlates(); });
  function updPlates(force) { const box = $('#plates-box'); if (!box || !weightCtx || !D.current) return; if (!force && !box.innerHTML) return; const i = $('#wval'); box.innerHTML = platesHTML(i.value || i.placeholder, D.current.unit); }
  document.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.id === 'file-input' && t.files[0]) handleFile(t.files[0], t.dataset.kind);
    else if (t.dataset.act === 'pick-program') { D.settings.activeProgramId = t.value; selectedWeek = null; await S.saveNow('settings'); viewWorkout(); }
    else if (t.dataset.act === 'set-bool') { D.settings[t.dataset.k] = t.checked; await S.saveNow('settings'); if (t.dataset.k === 'wakeLock') syncWake(); }
    else if (t.dataset.act === 'ramp') { try { D.settings.warmupRamp = X.parseRamp(t.value); t.value = X.rampText(D.settings.warmupRamp); await S.saveNow('settings'); toast('Warm-up ramp saved'); } catch (e) { toast(e.message, 3500); } }
    else if (t.dataset.act === 'bar') { const v = parseFloat(t.value.replace(',', '.')); if (v >= 0) { D.settings[unit() === 'kg' ? 'barKg' : 'barLb'] = v; await S.saveNow('settings'); toast('Bar weight saved'); } }
    else if (t.dataset.act === 'plates') {
      const out = {}; let bad = '';
      t.value.split(/[,;]+/).forEach((part) => { const m = part.trim().match(/^(\d+(?:[.,]\d+)?)\s*(?:[x×*]\s*(\d+))?$/i); if (!part.trim()) return; if (!m) { bad = part; return; } out[parseFloat(m[1].replace(',', '.'))] = m[2] ? +m[2] : 1; });
      if (bad || !Object.keys(out).length) toast(`Can't read "${(bad || t.value).trim()}" — use e.g. 45×4, 25×2, 10×2`, 3500);
      else { D.settings[unit() === 'kg' ? 'platesKg' : 'platesLb'] = out; await S.saveNow('settings'); toast('Plates saved'); }
    }
    else if (t.dataset.act === 'volume') window.LTSound.play('set');
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { // same as back: close the sheet, or leave the picker / detail sub-screen
      if (overlay) { ev.preventDefault(); closeOverlay(); return; }
      if (sheetOpen()) { ev.preventDefault(); closeSheet(); return; }
      const b = $('#topbar [data-act=pick-done], #topbar [data-act=back]'); if (b) { ev.preventDefault(); b.click(); return; }
    }
    if (ev.key === 'Enter' && ev.target.id === 'wval') { ev.preventDefault(); $('[data-act="wsave"]').click(); }
    if (ev.key === 'Enter' && ev.target.id === 'rt-in') { ev.preventDefault(); $('[data-act="rt-save"]').click(); }
    if (ev.key === 'Enter' && ev.target.id === 'lib-q') ev.target.blur();
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('lib-row')) { ev.preventDefault(); ev.target.click(); }
  });
  // form demo: alternate start/end photo every second (only once both are loaded); tap toggles .paused
  setInterval(() => document.querySelectorAll('.demo:not(.paused)').forEach((d) => {
    const imgs = [...d.querySelectorAll('img')]; if (imgs.length < 2 || !imgs.every((i) => i.complete && i.naturalWidth)) return;
    const k = imgs.findIndex((i) => i.classList.contains('on')); imgs.forEach((i, j) => i.classList.toggle('on', j === (k + 1) % imgs.length)); d.dataset.frames = (+(d.dataset.frames || 0) + 1);
  }), 1000);
  window.addEventListener('hashchange', () => { if (!(history.state && history.state.lt)) { const st = navPrev || { idx: navIdx, chain: [] }; history.replaceState({ lt: 'page', idx: st.idx + 1, chain: trimChain([...(st.chain || []), curHash()]) }, '', location.href); navSync(); } if (curHash() !== lastRouted) route(); });
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') S.flush();
    else { if (updateReady && safeToReload()) { applyUpdate(); return; } tickRest(); checkUpdate(); } // reopening the app applies a downloaded update
    syncWake();
  });
  /* With a workout in progress, Android back must never fall off the bottom of the stack (that closes the installed app)
     or land past the workout. When the app opens straight onto a workout (or another page) with nothing beneath it, the
     first tap builds Home ‹ Workout ‹ (this page) underneath. Done on a tap because Chrome skips back over history entries
     that were added without a user gesture. */
  let needRoot = false;
  function armRoot() {
    if (!needRoot) return; needRoot = false;
    const st = navState(); const h = curHash();
    if (st.idx !== 0 || st.lt !== 'page' || !D.current || sheetOpen() || h === '#/workout') return;
    history.replaceState({ lt: 'page', idx: 0, chain: ['#/workout'] }, '', '#/workout');
    history.pushState({ lt: 'page', idx: 1, chain: ['#/workout', '#/session'] }, '', '#/session');
    if (h !== '#/session') history.pushState({ lt: 'page', idx: 2, chain: ['#/workout', '#/session', h] }, '', h);
    navSync();
  }
  ['pointerup', 'keydown', 'click'].forEach((t) => document.addEventListener(t, () => {
    armRoot();
    if (layerPushPending && overlay) { layerPushPending = false; pushLayerState(); }
    if (t === 'pointerup' && ON) ON.schedule(900); // tips appear only right after a tap, when the screen has settled
  }, true));

  /* ---------- app updates ---------- */
  // sw.js activates a new version immediately (skipWaiting + clients.claim); the running page still has the old code, so
  // show "Update ready" and reload at a safe moment: on tap, or automatically the next time the app is opened.
  let updateReady = false; let swReg = null;
  const safeToReload = () => !layerOpen() && !(document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
  function applyUpdate() {
    try { S.flush(); sessionStorage.setItem('lt-reload', JSON.stringify({ hash: curHash(), y: window.scrollY })); } catch (e) { /* ignore */ }
    location.reload();
  }
  function showUpdateReady() {
    if (updateReady) return; updateReady = true;
    let bar = $('#update-bar');
    if (!bar) { bar = document.createElement('button'); bar.id = 'update-bar'; bar.dataset.act = 'apply-update'; bar.textContent = 'Update ready — tap to reload'; document.body.appendChild(bar); }
    if (location.hash === '#/settings') viewSettings();
  }
  async function checkUpdate(manual) {
    if (!swReg) { if (manual) toast('Offline app not active in this browser'); return; }
    if (!manual && navigator.onLine === false) return; // nothing to fetch; Safari logs a failed sw.js load otherwise
    try { await swReg.update(); if (manual && !updateReady) setTimeout(() => { if (!updateReady) toast(`Up to date · version ${APP_VERSION}`); }, 1500); } catch (e) { if (manual) toast('Could not check (offline?)'); }
  }
  window.addEventListener('pagehide', () => S.flush());

  /* ---------- boot ---------- */
  const STARTER_ID = 'starter-ppl'; const STARTER_NAME = 'Starter PPL';
  const BUILTINS = [['programs/starter-ppl.program.json', STARTER_ID], ['sample/example-ppl.json', 'sample-example-ppl'], ['programs/bodyweight-full-body.program.json', 'bodyweight-full-body']];
  async function fetchBuiltIn(url, id) { const raw = await (await fetch(url, { cache: 'no-cache' })).json(); const { program } = L.normalizeProgram({ ...raw, builtIn: true }); program.id = id; return program; }
  /* v1.5.1: the bundled PPL used to carry a different id/name, author, source links and "inferred" flags. Rename it in
     place to Starter PPL so the active program, schedule position (workouts' programId), history, pins and per-exercise
     settings (keyed by exercise name) carry over; an edited copy keeps the user's edits. */
  const isOldPPL = (id) => /-ppl-public$/.test(id || '');
  // FNV-1a hashes of the old built-in's name, description and the coaching notes that were rewritten (hashes, so the old text isn't shipped)
  const OLD_NAME_HASH = 0x56739f4c; const OLD_DESC_HASH = 0xe03dfc21;
  const OLD_NOTE_HASHES = new Set([0xe93dbcf, 0x10d6f5ae, 0x19dc3f46, 0x1f916241, 0x24aa04a3, 0x2d55c284, 0x54a3c097, 0x69e5e52a, 0x7b02d8eb, 0xbce6db06, 0xe86db46d, 0xf2d334f0, 0x375c8113]);
  const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
  const isOldPPLName = (n) => !!n && fnv(n) === OLD_NAME_HASH;
  function cleanNote(note, replacement) {
    if (typeof note !== 'string') return note;
    const n = note.replace(/\s*\[Inferred[^\]]*\]/g, '').trim();
    return OLD_NOTE_HASHES.has(fnv(n)) && replacement != null ? replacement : n; // untouched old note -> new neutral cue; user-written notes are kept
  }
  function cleanTarget(t, notesByName) {
    if (!t || typeof t !== 'object') return;
    delete t.source; delete t.inferred; delete t.inferredFields;
    if (typeof t.notes === 'string') t.notes = cleanNote(t.notes, notesByName && notesByName[t.name]);
  }
  async function migrateStarterPPL() {
    const old = D.programs.find((p) => isOldPPL(p.id));
    const touched = (D.workouts || []).some((w) => isOldPPL(w.programId) || isOldPPLName(w.programName)) || (D.current && (isOldPPL(D.current.programId) || isOldPPLName(D.current.programName)))
      || isOldPPL(D.settings.activeProgramId) || ((D.meta && D.meta.builtInIds) || []).some(isOldPPL);
    if (!old && !touched) return false;
    let notesByName = {}; const dayNotes = {};
    try { const fresh = await fetchBuiltIn(BUILTINS[0][0], STARTER_ID); fresh.weeks.forEach((w) => w.days.forEach((d) => { dayNotes[d.name] = d.notes || ''; d.exercises.forEach((e) => { notesByName[e.name] = e.notes || ''; }); })); } catch (e) { notesByName = {}; }
    if (old) {
      old.id = D.programs.some((p) => p.id === STARTER_ID) ? STARTER_ID + '-' + uid().slice(0, 4) : STARTER_ID;
      old.name = STARTER_NAME; old.author = ''; delete old.source;
      if (!old.description || fnv(old.description) === OLD_DESC_HASH) old.description = 'A suggested 6-day push/pull/legs starter routine; edit it to fit you.';
      (old.weeks || []).forEach((w) => (w.days || []).forEach((d) => { d.notes = cleanNote(d.notes, dayNotes[d.name]); (d.exercises || []).forEach((e) => cleanTarget(e, notesByName)); }));
    }
    const fix = (w) => { if (!w) return; if (isOldPPL(w.programId)) { w.programId = STARTER_ID; w.programName = STARTER_NAME; } else if (isOldPPLName(w.programName)) w.programName = STARTER_NAME; if (w.programId === STARTER_ID) { w.dayNotes = cleanNote(w.dayNotes, dayNotes[w.dayName]); (w.exercises || []).forEach((ex) => cleanTarget(ex.target, notesByName)); } };
    (D.workouts || []).forEach(fix); fix(D.current);
    if (isOldPPL(D.settings.activeProgramId)) D.settings.activeProgramId = STARTER_ID;
    if (D.meta && D.meta.builtInIds) D.meta.builtInIds = D.meta.builtInIds.map((x) => (isOldPPL(x) ? STARTER_ID : x));
    await Promise.all([S.saveNow('programs'), S.saveNow('workouts'), S.saveNow('settings'), S.saveNow('meta'), D.current ? S.saveNow('current') : null]);
    return true;
  }
  async function seedBuiltIns() {
    D.meta = D.meta || {};
    await migrateStarterPPL();
    const firstRun = !D.meta.seeded;
    const upgrade = !firstRun && (D.meta.builtInVersion || 1) < BUILTIN_VERSION;
    if (!firstRun && !upgrade) return;
    const known = new Set(D.meta.builtInIds || (firstRun ? [] : [STARTER_ID, 'sample-example-ppl']));
    for (const [url, id] of BUILTINS) {
      const idx = D.programs.findIndex((p) => p.id === id);
      if (!firstRun && idx < 0 && known.has(id)) continue; // user deleted it: don't resurrect on upgrade (new built-ins are added)
      if (!firstRun && idx >= 0 && D.programs[idx].edited) continue; // keep the user's edits
      try {
        const program = await fetchBuiltIn(url, id);
        if (idx >= 0) { program.createdAt = D.programs[idx].createdAt; D.programs[idx] = program; } else D.programs.push(program); // workout history is untouched
      } catch (e) { console.warn('built-in load failed', url, e); }
    }
    if (upgrade && (D.meta.builtInVersion || 1) < 2 && D.settings.defaultRest === 120) D.settings.defaultRest = 90; // old app default -> Cody's 1:30
    if (!D.settings.activeProgramId && D.programs.some((p) => p.id === STARTER_ID)) D.settings.activeProgramId = STARTER_ID;
    D.meta = { ...D.meta, seeded: true, builtInVersion: BUILTIN_VERSION, appVersion: APP_VERSION, builtInIds: BUILTINS.map((x) => x[1]) };
    await Promise.all([S.saveNow('programs'), S.saveNow('settings'), S.saveNow('meta')]);
  }
  let ON = null; let freshInstall = false;
  S.load().then(() => { freshInstall = !(D.meta && D.meta.seeded) && !(D.workouts && D.workouts.length) && !D.current; }).then(() => LIB.load()).then(() => { if (!Array.isArray(D.custom)) D.custom = []; LIB.setCustom(D.custom); }).then(seedBuiltIns).then(() => {
    { const st = history.state; if (st && st.lt) { navIdx = st.idx; if (st.lt !== 'page') history.replaceState({ ...st, lt: 'dead' }, '', location.href); } else history.replaceState({ lt: 'page', idx: 0, chain: [curHash()] }, '', location.href); navSync(); }
    if (navState().idx === 0 && D.current && curHash() !== '#/workout') needRoot = true;
    ON = window.LTOnboard.create({ D, $, save: () => S.saveNow('settings'), openOverlay, closeOverlay, sheetOpen });
    ON.init(freshInstall);
    route(); tickRest(); ON.maybeTour();
    try { const r = JSON.parse(sessionStorage.getItem('lt-reload') || 'null'); sessionStorage.removeItem('lt-reload'); if (r && r.hash === curHash() && r.y) { window.scrollTo(0, r.y); setTimeout(() => window.scrollTo(0, r.y), 60); } } catch (e) { /* ignore */ }
    setInterval(() => { tickElapsed(); if (D.current && D.current.rest) tickRest(); }, 500);
    window.LTApp = { ready: true, data: D, go, lib: LIB, X, wake: () => !!wakeSentinel, suggestionFor, lastShare: null, onboard: ON };
  });
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) showUpdateReady(); });
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }).then((r) => { swReg = r; if (navigator.onLine !== false) r.update().catch(() => {}); }).catch((e) => console.warn('SW failed', e)));
  }
})();
