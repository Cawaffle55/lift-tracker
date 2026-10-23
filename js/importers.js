/* Lift Tracker importers: program normalization, JSON / CSV / pasted-text parsing.
   Exposed as window.LTImport (and module.exports for Node tests). */
(function (root) {
  'use strict';

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const str = (v) => (v === undefined || v === null ? '' : String(v)).trim();
  const int = (v, d = 0) => { const n = parseInt(str(v), 10); return Number.isFinite(n) ? n : d; };

  /* ---------- rest parsing: "2-3 min", "90s", "1:30", 120 -> seconds (range => upper bound) */
  function parseRest(v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'number') return v > 0 ? Math.round(v <= 10 ? v * 60 : v) : null;
    const s = str(v).toLowerCase().replace(/[~≈]/g, '').replace(/[–—]/g, '-');
    let m = s.match(/(\d+):(\d{2})/);
    if (m) return int(m[1]) * 60 + int(m[2]);
    m = s.match(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(min|mins|minute|minutes|m|sec|secs|second|seconds|s)?\b/);
    if (!m) return null;
    const n = parseFloat(m[2] || m[1]);
    const unit = m[3] || (n <= 10 ? 'm' : 's');
    return Math.round(unit.startsWith('m') ? n * 60 : n);
  }

  function splitSubs(v) {
    if (Array.isArray(v)) return v.map(str).filter(Boolean);
    const s = str(v);
    if (!s) return [];
    return s.split(/\s*(?:\||;|\n|,|\s\/\s|\bor\b|\bOR\b)\s*/).map(str).filter((x) => x && !/^(n\/a|none|-)$/i.test(x));
  }

  /* ---------- normalize any program-ish object into the canonical schema */
  function normalizeExercise(e, warnings, where) {
    if (typeof e === 'string') e = { name: e };
    const name = str(e.name || e.exercise || e.lift || e.movement);
    if (!name) { warnings.push(`${where}: exercise without a name was skipped`); return null; }
    const restRaw = e.restSeconds ?? e.rest_seconds ?? e.rest;
    const ex = {
      id: str(e.id) || uid(),
      name,
      warmupSets: Math.max(0, int(e.warmupSets ?? e.warmup_sets ?? e.warmups ?? e.warmup, 0)),
      workingSets: Math.max(0, int(e.workingSets ?? e.working_sets ?? e.sets, 3)),
      reps: str(e.reps ?? e.targetReps ?? e.rep_range) || '',
      rpe: str(e.rpe ?? e.intensity),
      rir: str(e.rir),
      technique: str(e.technique ?? e.intensityTechnique ?? e.intensity_technique),
      load: str(e.load ?? e.percent),
      rest: str(e.rest ?? (e.restSeconds ? e.restSeconds + 's' : '')),
      restSeconds: parseRest(restRaw),
      notes: str(e.notes ?? e.note ?? e.cues),
      substitutions: splitSubs(e.substitutions ?? e.subs ?? e.substitution ?? e.alternatives),
      superset: str(e.superset ?? e.group)
    };
    if (e.source) ex.source = str(e.source);
    const wuRest = parseRest(e.restWarmupSeconds ?? e.restWarmup ?? e.warmup_rest);
    if (wuRest) ex.restWarmupSeconds = wuRest;
    if (str(e.libraryId)) ex.libraryId = str(e.libraryId);
    const tr = str(e.tracking).toLowerCase(); if (tr === 'time' || tr === 'reps') ex.tracking = tr;
    if (e.bodyweight === true || e.bodyweight === 'true') ex.bodyweight = true;
    if (ex.workingSets === 0 && ex.warmupSets === 0) { ex.workingSets = 1; warnings.push(`${where} "${name}": no sets given, defaulted to 1`); }
    return ex;
  }

  function normalizeDay(d, warnings, where, i) {
    const exs = (d.exercises || d.lifts || []).map((e, j) => normalizeExercise(e, warnings, `${where} ${str(d.name) || 'Day ' + (i + 1)} #${j + 1}`)).filter(Boolean);
    return { id: str(d.id) || uid(), name: str(d.name || d.day) || `Day ${i + 1}`, notes: str(d.notes), exercises: exs };
  }

  function normalizeProgram(raw) {
    const warnings = [];
    if (!raw || typeof raw !== 'object') throw new Error('Program must be a JSON object');
    if (raw.program && typeof raw.program === 'object' && !raw.weeks) raw = raw.program;
    let weeks;
    if (Array.isArray(raw.weeks)) {
      weeks = raw.weeks.map((w, i) => ({
        id: str(w.id) || uid(),
        name: str(w.name) || `Week ${i + 1}`,
        notes: str(w.notes),
        days: (w.days || []).map((d, j) => normalizeDay(d, warnings, `Week ${i + 1}`, j))
      }));
    } else if (Array.isArray(raw.days)) {
      // shorthand: one template of days, repeated `weeks` times (default 1)
      const n = Math.max(1, int(raw.weeks, 1));
      weeks = [];
      for (let i = 0; i < n; i++) weeks.push({ id: uid(), name: `Week ${i + 1}`, notes: '', days: raw.days.map((d, j) => normalizeDay(d, warnings, `Week ${i + 1}`, j)) });
    } else throw new Error('Program needs a "weeks" array (or a "days" array)');
    weeks = weeks.filter((w) => w.days.length);
    if (!weeks.length) throw new Error('Program has no days with exercises');
    return {
      program: {
        schema: 'lift-tracker/program@1',
        id: str(raw.id) || uid(),
        name: str(raw.name) || 'Imported program',
        author: str(raw.author),
        description: str(raw.description),
        source: str(raw.source),
        schedule: Array.isArray(raw.schedule) ? raw.schedule.map(str).filter(Boolean) : [],
        builtIn: !!raw.builtIn,
        createdAt: raw.createdAt || new Date().toISOString(),
        weeks
      },
      warnings
    };
  }

  /* ---------- CSV ---------- */
  function parseDelimited(text, delim) {
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === '') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim()));
  }

  // header name -> field. Order matters (technique before rpe, warm-up before sets).
  const HEADER_RULES = [
    ['program', /^program/],
    ['week', /^(wk|week)\b|^week$/],
    ['day', /^(day|workout|session)\b|day name|workout name/],
    ['substitutions', /sub|alternat|swap|option/],
    ['technique', /technique|intensifier|method|advanced/],
    ['warmupSets', /warm/],
    ['rir', /\brir\b|reps in reserve/],
    ['rpe', /rpe|intensity|effort/],
    ['workingSets', /set/],
    ['reps', /rep/],
    ['rest', /rest/],
    ['load', /load|weight|%|percent|1rm/],
    ['notes', /note|cue|comment|tip|instruction/],
    ['superset', /superset|group/],
    ['exercise', /exercise|movement|lift|name|^ex$/]
  ];
  function headerField(h) {
    const s = str(h).toLowerCase();
    if (!s) return null;
    for (const [f, re] of HEADER_RULES) if (re.test(s)) return f;
    return null;
  }
  function mapHeader(cells) {
    const map = cells.map(headerField);
    const known = map.filter(Boolean);
    const ok = known.includes('exercise') && (known.includes('workingSets') || known.includes('reps')) && known.length >= 2;
    return ok ? map : null;
  }

  function rowToExercise(cells, map) {
    const o = {};
    cells.forEach((c, i) => {
      const f = map[i]; if (!f || !c) return;
      o[f] = o[f] ? (f === 'substitutions' ? o[f] + '|' + c : o[f] + ' / ' + c) : c;
    });
    return o;
  }

  // Build program from rows of {week, day, exercise...}
  function buildFromRows(rows, name, warnings) {
    const weeks = []; const wIdx = {};
    let lastWeek = 'Week 1'; let lastDay = 'Day 1';
    for (const r of rows) {
      if (str(r.week)) lastWeek = /^\d+$/.test(str(r.week)) ? `Week ${str(r.week)}` : str(r.week);
      if (str(r.day)) lastDay = str(r.day);
      if (!wIdx[lastWeek]) { wIdx[lastWeek] = { name: lastWeek, days: [], dIdx: {} }; weeks.push(wIdx[lastWeek]); }
      const w = wIdx[lastWeek];
      if (!w.dIdx[lastDay]) { w.dIdx[lastDay] = { name: lastDay, exercises: [], notes: '' }; w.days.push(w.dIdx[lastDay]); }
      if (r._dayNote) { w.dIdx[lastDay].notes = (w.dIdx[lastDay].notes ? w.dIdx[lastDay].notes + '\n' : '') + r._dayNote; continue; }
      if (!str(r.exercise)) continue;
      w.dIdx[lastDay].exercises.push({ ...r, name: r.exercise });
    }
    const res = normalizeProgram({ name, weeks: weeks.map((w) => ({ name: w.name, days: w.days })) });
    res.warnings = warnings.concat(res.warnings);
    return res;
  }

  function parseCSV(text, name = 'Imported program') {
    const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
    const rows = parseDelimited(text.replace(/^\uFEFF/, ''), delim).filter((r) => r.some(Boolean));
    if (!rows.length) throw new Error('CSV is empty');
    const map = mapHeader(rows[0]);
    if (!map) throw new Error('CSV header row must include an "exercise" column and "sets" or "reps" (see PROGRAM_SCHEMA.md)');
    const warnings = [];
    const pi = map.indexOf('program');
    if (pi >= 0 && rows[1] && rows[1][pi]) name = rows[1][pi];
    const objs = rows.slice(1).map((r) => rowToExercise(r, map));
    return buildFromRows(objs, name, warnings);
  }

  /* ---------- paste-text best-effort parser ---------- */
  const RE_WEEK = /^\s*(?:week|wk)\s*#?\s*(\d+)\b\s*[:\-–—]*\s*(.*)$/i;
  const RE_DAYWORD = /^(?:day\s*#?\s*\d+|push|pull|legs?|upper|lower|full[\s-]?body|arms?|chest|back|shoulders?|glutes|core|posterior|anterior|workout\s*[a-z0-9]+|session\s*\d+)\b/i;
  const RE_RANGE = /^~?\s*\d+\s*(?:-|–|—|to)\s*\d+\s*(?:reps?)?$/i;
  const RE_SETXREP = /(\d+)\s*[x×]\s*(\d+(?:\s*[-–]\s*\d+)?|amrap)/i;
  const RE_REST = /^(?:rest\s*)?~?\s*(?:\d+:\d{2}|\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:min|mins|minutes?|m|sec|secs|seconds?|s))\s*(?:rest)?$/i;
  const RE_RPE = /^(?:@?\s*rpe\s*)?~?\s*\d+(?:\.5)?(?:\s*[-–]\s*\d+(?:\.5)?)?\s*(?:rpe)?$/i;
  const RE_TECH = /drop\s*set|myo|rest[\s-]?pause|partials?|failure|lengthened|static stretch|cluster|superset|giant set|amrap|tempo|pause/i;

  function detectDelimiter(lines) {
    const sample = lines.slice(0, 60);
    const count = (re) => sample.filter((l) => re.test(l)).length;
    if (count(/\t/) >= sample.length * 0.3) return '\t';
    if (count(/\|/) >= sample.length * 0.3) return '|';
    if (count(/,/) >= sample.length * 0.5 && count(/,.*,/) >= sample.length * 0.4) return ',';
    return 'spaces';
  }
  function splitLine(line, delim) {
    let cells;
    if (delim === '\t') cells = line.split('\t');
    else if (delim === '|') cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
    else if (delim === ',') cells = parseDelimited(line, ',')[0] || [];
    else cells = line.split(/\s{2,}/);
    cells = cells.map((c) => c.trim());
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    return cells;
  }

  function sectionHeading(cells) {
    const filled = cells.filter(Boolean);
    if (filled.length !== 1 && !(filled.length === 2 && RE_WEEK.test(filled[0]))) return null;
    const t = filled.join(' ').replace(/[:#*=_]+$/g, '').replace(/^[#*=_\s]+/, '').trim();
    if (!t || t.length > 60) return null;
    if (RE_SETXREP.test(t) || /\d+\s*(?:min|mins|sec|secs|s|reps?)\b|\brpe\b|\brir\b/i.test(t)) return null;
    const w = t.match(RE_WEEK);
    if (w) return { week: `Week ${w[1]}`, day: w[2] && RE_DAYWORD.test(w[2]) ? w[2].replace(/^[\s:\-–—]+/, '') : null };
    if (RE_DAYWORD.test(t) || /:$/.test(filled[0]) || (/^[A-Z0-9 #&\-\/()]+$/.test(t) && /[A-Z]{3}/.test(t))) return { day: t };
    return null;
  }

  // Heuristic: classify cells of a header-less row.
  function heuristicRow(cells) {
    const o = { _warn: [] };
    let i = 0;
    // inline "Bench Press 3x8-10 RPE 8 2 min" single-cell lines
    if (cells.length === 1) {
      let line = cells[0];
      const wu0 = line.match(/[,(]?\s*(\d+)\s*(?:x\s*)?warm[\s-]?ups?(?:\s*sets?)?\s*[,)]?/i);
      if (wu0) { o.warmupSets = wu0[1]; line = line.replace(wu0[0], ' ').replace(/\s{2,}/g, ' '); }
      const m = line.match(RE_SETXREP);
      if (!m) return null;
      o.exercise = line.slice(0, m.index).replace(/[-–:,]+\s*$/, '').trim();
      o.workingSets = m[1]; o.reps = m[2].replace(/\s+/g, '');
      let rest = line.slice(m.index + m[0].length);
      const rpe = rest.match(/@?\s*rpe\s*~?\s*([\d.]+(?:\s*[-–]\s*[\d.]+)?)/i);
      if (rpe) { o.rpe = rpe[1].replace(/\s+/g, ''); rest = rest.replace(rpe[0], ' '); }
      const rir = rest.match(/(\d+(?:\s*[-–]\s*\d+)?)\s*rir|rir\s*(\d+(?:\s*[-–]\s*\d+)?)/i);
      if (rir) { o.rir = (rir[1] || rir[2]).replace(/\s+/g, ''); rest = rest.replace(rir[0], ' '); }
      const rs = rest.match(/(?:rest\s*)?~?\s*(\d+:\d{2}|\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:min|mins|minutes?|m|sec|secs|seconds?|s))\b(?:\s*rest)?/i);
      if (rs) { o.rest = rs[1].trim(); rest = rest.replace(rs[0], ' '); }
      const subs = rest.match(/\b(?:subs?|substitutions?|alt(?:ernatives?)?)\s*[:\-]\s*(.+)$/i);
      if (subs) { o.substitutions = subs[1]; rest = rest.replace(subs[0], ' '); }
      rest = rest.replace(/^[\s,;:.\-–|]+|[\s,;:\-–|]+$/g, '').replace(/\s{2,}/g, ' ');
      if (rest) { if (RE_TECH.test(rest) && rest.length < 40) o.technique = rest; else o.notes = rest; }
      return o.exercise ? o : null;
    }
    // multi-cell: first texty cell is the name
    while (i < cells.length && !/[a-z]/i.test(cells[i])) i++;
    if (i >= cells.length) return null;
    o.exercise = cells[i++];
    const ints = []; let gotReps = false; const rpes = []; const texts = [];
    for (; i < cells.length; i++) {
      const c = cells[i]; if (!c) continue;
      const sx = c.match(RE_SETXREP);
      if (sx && !gotReps) { o.workingSets = sx[1]; o.reps = sx[2]; gotReps = true; continue; }
      if (RE_REST.test(c) && /[a-z:]/i.test(c)) { o.rest = c.replace(/^rest\s*/i, ''); continue; }
      if (/rir/i.test(c)) { o.rir = c.replace(/rir/i, '').trim(); continue; }
      if (/rpe/i.test(c) && RE_RPE.test(c)) { rpes.push(c.replace(/rpe|@/ig, '').trim()); continue; }
      if (!gotReps && (RE_RANGE.test(c) || /^amrap$/i.test(c) || /^\d+\s*reps?$/i.test(c))) { o.reps = c.replace(/\s*reps?$/i, '').replace(/\s+/g, ''); gotReps = true; continue; }
      if (/^\d+$/.test(c) && !gotReps) { ints.push(c); continue; }
      if (gotReps && RE_RPE.test(c) && parseFloat(c.replace('~', '')) >= 5 && parseFloat(c.replace('~', '')) <= 10) { rpes.push(c); continue; }
      if (gotReps && /^\d+(?:\.\d+)?$/.test(c)) { if (!o.rest) { o.rest = c; continue; } }
      texts.push(c);
    }
    // ints before reps: [warmup, working, reps] / [working, reps] / [warmup, working]
    if (!gotReps && ints.length >= 2) { o.reps = ints.pop(); gotReps = true; }
    if (ints.length >= 2) { o.warmupSets = ints[ints.length - 2]; o.workingSets = ints[ints.length - 1]; }
    else if (ints.length === 1) {
      if (!o.workingSets) o.workingSets = ints[0]; else o.warmupSets = ints[0];
    }
    if (rpes.length) o.rpe = rpes.join(' / ');
    for (const t of texts) {
      if (!o.technique && RE_TECH.test(t) && t.length < 40) o.technique = t;
      else if (!o.notes && (t.length >= 25 || /[.!]/.test(t))) o.notes = t;
      else if (/\bor\b|\/|,/.test(t) || (o.notes && t.length < 60)) o.substitutions = o.substitutions ? o.substitutions + '|' + t : t;
      else o.notes = o.notes ? o.notes + ' ' + t : t;
    }
    if (!o.workingSets && !o.reps) return null; // probably not an exercise row
    if (!o.workingSets) o._warn.push('no set count found (defaulted to 3)');
    return o;
  }

  function parsePastedText(text, opts = {}) {
    const name = opts.name || 'Pasted program';
    const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\u00a0/g, ' ')).filter((l) => l.trim());
    if (!lines.length) throw new Error('Nothing to parse');
    const delim = detectDelimiter(lines);
    const rows = []; const warnings = []; const ignored = [];
    let map = null; let week = null; let day = null; let lastEx = null;
    for (let n = 0; n < lines.length; n++) {
      const raw = lines[n];
      if (/^\s*\|?\s*:?-{3,}/.test(raw)) continue; // markdown separator
      const cells = splitLine(raw, delim);
      if (!cells.some(Boolean)) continue;
      const hdr = mapHeader(cells);
      if (hdr) { map = hdr; continue; }
      const sec = sectionHeading(cells);
      if (sec && !(map && map.includes('week') && cells.length > 1)) {
        if (sec.week) { week = sec.week; day = sec.day || null; }
        if (sec.day && !sec.week) day = sec.day;
        if (/rest\s*day|^rest$|^off$/i.test(day || '')) day = null;
        lastEx = null; continue;
      }
      let o = null;
      if (map && cells.length >= 2) {
        o = rowToExercise(cells, map);
        if (!str(o.exercise)) o = null;
      }
      if (!o) o = heuristicRow(cells);
      if (!o) {
        const t = cells.filter(Boolean).join(' ');
        if (/rest\s*day/i.test(t)) continue;
        if (lastEx && t.length > 3) { lastEx.notes = (lastEx.notes ? lastEx.notes + ' ' : '') + t; continue; }
        if (t.length > 3 && (day || week)) { rows.push({ week, day, _dayNote: t }); continue; }
        ignored.push(`line ${n + 1}: ${t.slice(0, 80)}`); continue;
      }
      if (o.week) week = /^\d+$/.test(str(o.week)) ? `Week ${str(o.week)}` : str(o.week);
      if (o.day) day = o.day;
      if (!day) { day = 'Day 1'; warnings.push('No day heading found before first exercise; using "Day 1"'); }
      (o._warn || []).forEach((w) => warnings.push(`${o.exercise}: ${w}`));
      delete o._warn;
      o.week = week || 'Week 1'; o.day = day;
      rows.push(o); lastEx = o;
    }
    if (!rows.some((r) => r.exercise)) throw new Error('Could not find any exercises. Try including a header row (Exercise, Sets, Reps, ...) or lines like "Bench Press 3x8-10 RPE 8 2 min".');
    const res = buildFromRows(rows, name, warnings);
    if (opts.repeatWeeks > 1 && res.program.weeks.length === 1) {
      const base = res.program.weeks[0];
      for (let i = 2; i <= opts.repeatWeeks; i++) res.program.weeks.push(JSON.parse(JSON.stringify({ ...base, id: uid(), name: `Week ${i}` })));
      res.program.weeks[0].name = 'Week 1';
      res.program.weeks.forEach((w) => w.days.forEach((d) => { d.id = uid(); d.exercises.forEach((e) => (e.id = uid())); }));
    }
    res.ignored = ignored; res.delimiter = delim === '\t' ? 'tab' : delim; res.usedHeader = !!map;
    return res;
  }

  function parseJSONProgram(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('Not valid JSON: ' + e.message); }
    if (Array.isArray(raw)) return raw.map(normalizeProgram);
    if (raw && raw.app === 'lift-tracker' && raw.programs) throw new Error('This is a full backup file. Use Settings → Import backup.');
    return [normalizeProgram(raw)];
  }

  const api = { normalizeProgram, parseCSV, parsePastedText, parseJSONProgram, parseRest, uid, parseDelimited };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LTImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
