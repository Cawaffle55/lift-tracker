/* Lift Tracker exercise library: loads data/exercises.json (free-exercise-db + own additions) and user
   custom exercises, provides instant search, name matching and image URLs. window.LTLib */
(function () {
  'use strict';
  const EQUIP_TERMS = [ // [phrase, equipment] - multi-word phrases first
    ['resistance band', 'band'], ['smith machine', 'smith machine'], ['ez curl bar', 'ez bar'], ['ez bar', 'ez bar'], ['ez-bar', 'ez bar'], ['e-z', 'ez bar'],
    ['medicine ball', 'medicine ball'], ['med ball', 'medicine ball'], ['exercise ball', 'exercise ball'], ['swiss ball', 'exercise ball'], ['stability ball', 'exercise ball'],
    ['foam roller', 'foam roller'], ['foam roll', 'foam roller'], ['body weight', 'bodyweight'], ['no equipment', 'bodyweight'],
    ['bodyweight', 'bodyweight'], ['calisthenics', 'bodyweight'], ['bw', 'bodyweight'], ['smith', 'smith machine'],
    ['dumbbells', 'dumbbell'], ['dumbbell', 'dumbbell'], ['db', 'dumbbell'], ['barbells', 'barbell'], ['barbell', 'barbell'], ['bb', 'barbell'],
    ['cables', 'cable'], ['cable', 'cable'], ['machines', 'machine'], ['machine', 'machine'], ['kettlebells', 'kettlebell'], ['kettlebell', 'kettlebell'], ['kb', 'kettlebell'],
    ['bands', 'band'], ['band', 'band']
  ];
  const LEGS = ['quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'];
  const MUSCLE_TERMS = [
    ['upper back', ['middle back', 'traps']], ['lower back', ['lower back']], ['middle back', ['middle back']], ['inner thigh', ['adductors']], ['outer thigh', ['abductors']],
    ['chest', ['chest']], ['pecs', ['chest']], ['pec', ['chest']], ['pectorals', ['chest']], ['shoulders', ['shoulders']], ['shoulder', ['shoulders']], ['delts', ['shoulders']], ['delt', ['shoulders']], ['deltoids', ['shoulders']],
    ['triceps', ['triceps']], ['tricep', ['triceps']], ['biceps', ['biceps']], ['bicep', ['biceps']], ['lats', ['lats']], ['lat', ['lats']], ['back', ['lats', 'middle back', 'lower back']],
    ['traps', ['traps']], ['trap', ['traps']], ['forearms', ['forearms']], ['forearm', ['forearms']], ['grip', ['forearms']], ['quads', ['quadriceps']], ['quad', ['quadriceps']], ['quadriceps', ['quadriceps']],
    ['hamstrings', ['hamstrings']], ['hamstring', ['hamstrings']], ['hams', ['hamstrings']], ['glutes', ['glutes']], ['glute', ['glutes']], ['butt', ['glutes']], ['calves', ['calves']], ['calf', ['calves']],
    ['abs', ['abdominals']], ['ab', ['abdominals']], ['core', ['abdominals']], ['abdominals', ['abdominals']], ['obliques', ['abdominals']], ['adductors', ['adductors']], ['adductor', ['adductors']],
    ['abductors', ['abductors']], ['abductor', ['abductors']], ['neck', ['neck']], ['legs', LEGS], ['leg', LEGS], ['arms', ['biceps', 'triceps', 'forearms']]
  ];
  const CAT_TERMS = { push: 'push', pull: 'pull', core: 'core', stretch: 'stretch', stretches: 'stretch', stretching: 'stretch', cardio: 'conditioning', conditioning: 'conditioning', hiit: 'conditioning', skill: 'skill', skills: 'skill' };
  const EQUIPMENT = ['bodyweight', 'barbell', 'dumbbell', 'cable', 'machine', 'smith machine', 'kettlebell', 'band', 'ez bar', 'medicine ball', 'exercise ball', 'foam roller', 'other'];
  const MUSCLES = ['chest', 'shoulders', 'triceps', 'biceps', 'lats', 'middle back', 'lower back', 'traps', 'forearms', 'abdominals', 'quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors', 'neck'];

  // normalize a name for matching: lowercase, drop (...) and punctuation, strip plural s
  const key = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .map((w) => (w.length >= 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
  const plain = (s) => ' ' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';

  let base = [], custom = [], all = [], byKey = new Map(), byId = new Map(), meta = {}, loaded = null;
  function index() {
    all = base.concat(custom); byKey = new Map(); byId = new Map();
    for (const e of all) {
      byId.set(e.id, e);
      e._hay = plain([e.name, ...(e.aliases || []), e.equipment, ...(e.primary || []), ...(e.secondary || [])].join(' '));
      e._name = plain(e.name); e._compact = e._hay.replace(/ /g, '');
      e._pop = (e.aliases ? 12 : 0) + ({ barbell: 4, dumbbell: 4, cable: 4, machine: 3, bodyweight: 4, 'smith machine': 2, kettlebell: 1, band: 0, 'ez bar': 2 }[e.equipment] ?? -4)
        + ({ strength: 4, powerlifting: 1, stretching: -8, plyometrics: -2, strongman: -6, 'olympic weightlifting': -3, cardio: -1 }[e.type] ?? 2) + (e.source === 'custom' ? 6 : 0);
      for (const n of [e.name, ...(e.aliases || [])]) { const k = key(n); if (k && !byKey.has(k)) byKey.set(k, e); }
    }
  }
  function load(url = 'data/exercises.json') {
    if (loaded) return loaded;
    loaded = fetch(url).then((r) => r.json()).then((j) => { meta = j.meta || {}; base = j.exercises || []; index(); return all; })
      .catch((e) => { console.warn('library load failed', e); loaded = null; return all; });
    return loaded;
  }
  function setCustom(list) { custom = (list || []).map((e) => ({ ...e, source: 'custom' })); index(); }

  // Find the library entry for a (program/history) exercise name
  const MODS = /^(eccentric accentuated|paused|pause|tempo|deficit|weighted|single arm|single leg|one arm|seated|standing|incline|bent over|machine|cable|dumbbell|barbell)\s+/;
  function find(name, id) {
    if (id && byId.has(id)) return byId.get(id);
    let k = key(name); if (!k) return null;
    if (byKey.has(k)) return byKey.get(k);
    k = k.replace(/\s*(21|21s|drop set|myo rep|partial)$/, '').replace(/\s*(→|->).*/, '');
    if (byKey.has(k)) return byKey.get(k);
    const m = k.replace(MODS, ''); if (m !== k && byKey.has(m)) return byKey.get(m);
    return null;
  }

  // Parse a query into equipment / muscle / category filters and free-text words
  function parse(q) {
    let s = plain(q).replace(/ (pull|push|chin|sit|step) (ups?|downs?|overs?) /g, ' $1$2 '); const eq = new Set(), mus = [], cat = new Set(), words = [];
    for (const [ph, e] of EQUIP_TERMS) { const p = plain(ph); if (s.includes(p)) { eq.add(e); s = s.split(p).join(' '); } }
    for (const [ph, ms] of MUSCLE_TERMS) { const p = plain(ph); if (s.includes(p)) { mus.push({ term: ph, ms }); s = s.split(p).join(' '); } }
    for (const w of s.trim().split(/\s+/).filter(Boolean)) { if (CAT_TERMS[w]) cat.add(CAT_TERMS[w]); else words.push(w); }
    return { eq: [...eq], mus, cat: [...cat], words };
  }
  function search(q, f = {}) {
    const P = parse(q); const qn = plain(q).trim(); const out = [];
    for (const e of all) {
      if (f.equipment && e.equipment !== f.equipment) continue;
      if (f.muscle && !(e.primary || []).includes(f.muscle) && !(e.secondary || []).includes(f.muscle)) continue;
      if (P.eq.length && !P.eq.includes(e.equipment)) continue;
      if (P.cat.length && !P.cat.includes(e.category)) continue;
      let score = 0, okAll = true;
      for (const m of P.mus) {
        const pri = (e.primary || []).some((x) => m.ms.includes(x)); const sec = (e.secondary || []).some((x) => m.ms.includes(x));
        const inName = e._name.includes(plain(m.term));
        if (!pri && !sec && !inName) { okAll = false; break; }
        score += pri ? 30 : inName ? 20 : 5;
      }
      if (!okAll) continue;
      for (const w of P.words) {
        if (e._name.includes(' ' + w)) score += 15; else if (e._hay.includes(' ' + w)) score += 8; else if (w.length > 2 && e._compact.includes(w)) score += 6; else { okAll = false; break; }
      }
      if (!okAll) continue;
      if (P.words.length) {
        if (e._name.trim().startsWith(qn)) score += 25;
        if (e._name.trim() === qn || (e.aliases || []).some((a) => plain(a).trim() === qn)) score += 60;
      }
      score += e._pop;
      out.push([score, e]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
    return out.map((x) => x[1]);
  }
  function images(e) { return e && e.images && e.images.length && meta.imageBase ? e.images.map((p) => meta.imageBase + p) : []; }
  window.LTLib = { load, setCustom, find, search, parse, images, key, get all() { return all; }, get meta() { return meta; }, byId: (id) => byId.get(id), EQUIPMENT, MUSCLES };
})();
