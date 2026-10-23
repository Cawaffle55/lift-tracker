/* Lift Tracker storage: tiny IndexedDB key/value store with localStorage fallback.
   Everything is kept in memory (LT.data) and written through on change. */
(function () {
  'use strict';
  const DB_NAME = 'lift-tracker'; const STORE = 'kv';
  let dbp = null;
  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve(null);
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  async function get(key) {
    const db = await openDB();
    if (!db) { const v = localStorage.getItem('lt.' + key); return v ? JSON.parse(v) : undefined; }
    return new Promise((res, rej) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function set(key, val) {
    const db = await openDB();
    if (!db) { localStorage.setItem('lt.' + key, JSON.stringify(val)); return; }
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(JSON.parse(JSON.stringify(val)), key);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
  }
  const KEYS = ['programs', 'workouts', 'settings', 'current', 'meta', 'custom', 'exprefs'];
  const DEFAULT_SETTINGS = { units: 'lb', defaultRest: 90, useDefaultRestAll: true, autoRest: true, sound: true, volume: 70, vibrate: true, activeProgramId: null,
    // v1.4 (new keys are merged into older saved settings on load, so existing data migrates automatically)
    progression: true, autoFillSuggestion: true, restWarmup: 60, logRpe: false, effortScale: 'rpe', weeklyGoal: 3, wakeLock: true,
    barLb: 45, barKg: 20, platesLb: { 45: 6, 35: 1, 25: 1, 10: 2, 5: 1, 2.5: 1 }, platesKg: { 25: 4, 20: 2, 15: 1, 10: 1, 5: 1, 2.5: 1, 1.25: 1 },
    warmupRamp: [{ pct: 0, reps: 10 }, { pct: 40, reps: 5 }, { pct: 60, reps: 5 }, { pct: 80, reps: 3 }] };
  const data = { programs: [], workouts: [], settings: { ...DEFAULT_SETTINGS }, current: null, meta: {}, custom: [], exprefs: {} };
  async function load() {
    for (const k of KEYS) {
      const v = await get(k);
      if (v !== undefined && v !== null) data[k] = v;
    }
    data.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    if (!data.exprefs || typeof data.exprefs !== 'object' || Array.isArray(data.exprefs)) data.exprefs = {};
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return data;
  }
  const timers = {};
  function save(key) { // debounced write-through
    clearTimeout(timers[key]);
    return new Promise((res) => { timers[key] = setTimeout(() => set(key, data[key]).then(res, (e) => { console.error(e); res(); }), 150); });
  }
  async function saveNow(key) { clearTimeout(timers[key]); await set(key, data[key]); }
  async function flush() { await Promise.all(KEYS.map((k) => saveNow(k))); }
  function backup() {
    return { app: 'lift-tracker', version: 1, exportedAt: new Date().toISOString(), programs: data.programs, workouts: data.workouts, settings: data.settings, current: data.current, custom: data.custom, exprefs: data.exprefs };
  }
  async function restore(obj, mode = 'replace') {
    if (!obj || obj.app !== 'lift-tracker') throw new Error('Not a Lift Tracker backup file');
    if (mode === 'merge') {
      const ids = new Set(data.programs.map((p) => p.id));
      (obj.programs || []).forEach((p) => { if (!ids.has(p.id)) data.programs.push(p); });
      const wids = new Set(data.workouts.map((w) => w.id));
      (obj.workouts || []).forEach((w) => { if (!wids.has(w.id)) data.workouts.push(w); });
      data.workouts.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      const cids = new Set(data.custom.map((c) => c.id));
      (obj.custom || []).forEach((c) => { if (!cids.has(c.id)) data.custom.push(c); });
      Object.entries(obj.exprefs || {}).forEach(([k, v]) => { if (!data.exprefs[k]) data.exprefs[k] = v; });
    } else {
      data.programs = obj.programs || []; data.workouts = obj.workouts || [];
      data.settings = { ...DEFAULT_SETTINGS, ...(obj.settings || {}) }; data.current = obj.current || null; data.custom = obj.custom || []; data.exprefs = obj.exprefs || {};
    }
    await flush();
  }
  window.LTStore = { data, load, save, saveNow, flush, backup, restore, DEFAULT_SETTINGS };
})();
