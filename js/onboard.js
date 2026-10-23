/* Lift Tracker onboarding: first-launch welcome tour + one-time contextual tips (coach marks) + the Help page content.
   Everything is on-device; seen-state lives in settings.onboard = { tour: 'pending'|'done'|'skipped', tips: { id: true } }.
   The app supplies the layer API (history entries, so Android back closes a tour/tip without leaving the screen). */
(function () {
  'use strict';
  const svg = (inner) => `<svg viewBox="0 0 200 120" class="tour-ill" aria-hidden="true">${inner}</svg>`;
  const TOUR = [
    { t: 'Your program, ready to go', b: 'Home shows <b>Up next</b> from your active program — tap <b>Start</b> and every exercise, set and rep target is laid out. Swap programs any time in <b>Programs</b>.',
      ill: svg(`<rect x="30" y="14" width="140" height="92" rx="12" fill="#181b20" stroke="#2b3038"/><text x="44" y="36" fill="#8d96a3" font-size="10">UP NEXT</text><text x="44" y="54" fill="#eef1f5" font-size="15" font-weight="700">Push · Week 1</text><rect x="44" y="64" width="80" height="5" rx="2.5" fill="#2b3038"/><rect x="44" y="74" width="60" height="5" rx="2.5" fill="#2b3038"/><rect x="44" y="86" width="112" height="14" rx="7" fill="#3b82f6"/><text x="100" y="96" fill="#fff" font-size="9" font-weight="700" text-anchor="middle">Start</text>`) },
    { t: 'Log a set with one tap', b: 'The suggested weight and reps are pre-filled (<span class="sug-key">blue dashed</span>). Did it? Tap <b>✓</b>. Different? Tap the number and change it first.',
      ill: svg(`<rect x="16" y="34" width="168" height="34" rx="9" fill="#181b20" stroke="#2b3038"/><text x="30" y="56" fill="#8d96a3" font-size="13" font-weight="700">1</text><rect x="52" y="42" width="52" height="20" rx="6" fill="none" stroke="#3b82f6" stroke-dasharray="4 3" stroke-width="1.5"/><text x="78" y="56" fill="#93c5fd" font-size="12" font-weight="700" text-anchor="middle">185</text><text x="124" y="56" fill="#eef1f5" font-size="12" text-anchor="middle">8</text><circle cx="162" cy="51" r="12" fill="#22c55e"/><path d="M156 51l4 4 8-8" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M162 92l0-14" stroke="#22c55e" stroke-width="2"/><text x="162" y="108" fill="#22c55e" font-size="10" text-anchor="middle">one tap</text>`) },
    { t: 'Rest timer runs itself', b: 'After each set the rest timer starts at the bottom. Use <b>−15 / +15</b>, tap the time to type one, or <b>Skip</b>. A sound and buzz tell you when to go.',
      ill: svg(`<rect x="12" y="42" width="176" height="40" rx="12" fill="#1e3a8a"/><text x="26" y="69" fill="#fff" font-size="20" font-weight="800">1:30</text><rect x="92" y="52" width="26" height="20" rx="6" fill="rgba(255,255,255,.16)"/><text x="105" y="66" fill="#fff" font-size="9" text-anchor="middle">−15</text><rect x="122" y="52" width="26" height="20" rx="6" fill="rgba(255,255,255,.16)"/><text x="135" y="66" fill="#fff" font-size="9" text-anchor="middle">+15</text><rect x="152" y="52" width="28" height="20" rx="6" fill="rgba(255,255,255,.16)"/><text x="166" y="66" fill="#fff" font-size="9" text-anchor="middle">Skip</text><rect x="12" y="78" width="110" height="4" rx="2" fill="#93c5fd"/><path d="M160 22q8 6 0 12M168 18q12 10 0 20" stroke="#93c5fd" stroke-width="2" fill="none" stroke-linecap="round"/>`) },
    { t: 'See your progress', b: '<b>History</b> keeps every workout. Tap <b>📊 Stats</b> for the training heatmap, streaks, volume and per-exercise charts with your PRs.',
      ill: svg(`${Array.from({ length: 21 }, (_, i) => `<rect x="${18 + (i % 7) * 12}" y="${26 + Math.floor(i / 7) * 12}" width="9" height="9" rx="2" fill="${['#22262d', '#1e3a8a', '#2563eb', '#3b82f6', '#93c5fd'][(i * 7 + 3) % 5]}"/>`).join('')}<polyline points="112,92 128,78 142,82 156,60 172,48 186,36" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linejoin="round"/><circle cx="186" cy="36" r="4" fill="#f59e0b"/><text x="186" y="28" fill="#f59e0b" font-size="9" text-anchor="middle">PR</text><line x1="108" y1="100" x2="190" y2="100" stroke="#2b3038"/>`) },
  ];
  // contextual tips: route prefix, anchor selector, text. Order = priority on that screen.
  const TIPS = [
    { id: 'settype', route: '#/session', sel: 'tr.set:not(.done) [data-act=set-type]', t: '<b>Set type:</b> tap the set number to cycle Normal → <b>W</b> warm-up → <b>F</b> failure → <b>D</b> drop set.' },
    { id: 'suggest', route: '#/session', sel: 'tr.set:not(.done) .wbtn.sug', t: '<b>Blue dashed = suggestion</b> from your last sessions. If you hit it, one tap on ✓ logs it as shown.' },
    { id: 'weight', route: '#/session', sel: 'tr.set:not(.done) [data-act=weight]', t: '<b>Tap the weight</b> to type it, see the plates per side, or fill it into the remaining sets.' },
    { id: 'exmenu', route: '#/session', sel: '.ex [data-act=ex-menu]', t: '<b>⋯ options:</b> replace or swap the lift, add warm-up sets, pin a note, set rest &amp; progression, move or remove it.' },
    { id: 'reorder', route: '#/programs/', sel: '[data-act=ed-move]:not([disabled])', t: '<b>Reorder:</b> use ↑ ↓ to move exercises; tap a row to edit sets, reps and rest.' },
    { id: 'search', route: '#/exercises', sel: '#lib-q', t: '<b>Search tip:</b> combine words, e.g. <b>dumbbell chest</b> or <b>cable row</b>. Use the chips to filter by equipment or muscle.' },
    { id: 'stats', route: '#/history', sel: '#topbar [data-to="#/stats"]', t: '<b>📊 Stats:</b> heatmap, streaks, weekly volume and per-exercise charts with PRs.' },
  ];
  const HELP = [
    ['Change a set’s type', 'Tap the set number: Normal → W (warm-up) → F (failure) → D (drop set) → Normal. Warm-ups don’t count toward volume or PRs.'],
    ['Replace or swap a lift', '⋯ on the exercise → pick a listed substitute, “Replace with a library exercise” (keeps logged sets), or type any name.'],
    ['Notes', '⋯ → Pin a note: it shows on that exercise every session. Workout notes are at the bottom of the workout.'],
    ['Rest & progression per exercise', '⋯ → Progression & rest. Defaults live in Settings → Rest timer / Progression.'],
    ['Plates & warm-ups', 'Tap a weight to see plates per side. ⋯ → Add warm-up sets builds a ramp from your working weight (edit the ramp in Settings).'],
    ['Suggested weights', 'Blue dashed numbers are suggestions from recent sessions (add reps within the range, then weight). One tap on ✓ logs them; tap to change first.'],
    ['Rest timer', 'Starts after each set. −15 / +15, tap the time to type one, or Skip. Sounds/haptics in Settings.'],
    ['Reorder a day', 'Programs → a program → a day → ↑ ↓ on each exercise. During a workout: ⋯ → Move up / down.'],
    ['Find exercises', 'Exercises tab: search with several words (“dumbbell chest”), filter by equipment or muscle, tap ⓘ for form photos and cues.'],
    ['Stats & history', 'History lists every workout. 📊 Stats shows the heatmap, streaks, volume and per-exercise charts.'],
    ['Import a program', 'Programs → Import: paste JSON/CSV/text, open a file, or open a share link. Check the preview, then Save.'],
    ['Import Strong / Hevy history', 'Settings → Backup → Import Strong / Hevy CSV. Duplicates are skipped.'],
    ['Backups', 'Data lives only on this phone. Settings → Export backup (JSON) regularly; Import backup restores it.'],
    ['Sharing', 'A program → Share sends a link or file; a finished workout → Share card makes an image.'],
    ['Install on iPhone', 'Open in Safari → Share → Add to Home Screen. Open it from the icon for full screen and offline use.'],
    ['Install on Android', 'Chrome menu ⋮ → Install app (or Add to Home screen).'],
    ['Updates', 'Updates download by themselves. “Update ready — tap to reload” applies one now; otherwise it applies next time you open the app. Settings shows the version and “Check for update”.'],
  ];

  function create(api) {
    const { D, $, save, openOverlay, closeOverlay } = api;
    let tipEl = null; let lastTipAt = 0; let timer = null; let tour = null;
    const cfg = () => { D.settings.onboard = D.settings.onboard || { tour: 'skipped', tips: {} }; D.settings.onboard.tips = D.settings.onboard.tips || {}; return D.settings.onboard; };
    const disabled = () => { try { return localStorage.getItem('lt-onboard') === 'off'; } catch (e) { return false; } };
    const O = { cooldown: 12000, TIPS, HELP };

    /* first boot: fresh install gets the tour; anyone with data/settings already gets tips only */
    O.init = (fresh) => { if (!D.settings.onboard) { D.settings.onboard = { tour: fresh ? 'pending' : 'skipped', tips: {} }; save(); } };
    O.maybeTour = () => { if (!disabled() && cfg().tour === 'pending') O.showTour(); };

    O.showTour = () => {
      if (tour) return; hideTip();
      const el = document.createElement('div'); el.id = 'tour'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Welcome tour');
      el.innerHTML = `<div class="tour-top"><span class="tour-brand">Lift Tracker</span><button class="btn sm" data-tour="skip">Skip</button></div>
        <div class="tour-track">${TOUR.map((c, i) => `<section class="tour-card" data-i="${i}">${c.ill}<h2>${c.t}</h2><p>${c.b}</p></section>`).join('')}</div>
        <div class="tour-bottom"><div class="tour-dots">${TOUR.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div><button class="btn primary" data-tour="next">Next</button></div>`;
      document.body.appendChild(el);
      const track = el.querySelector('.tour-track');
      const idx = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      const sync = () => { const k = idx(); el.querySelectorAll('.tour-dots i').forEach((d, j) => d.classList.toggle('on', j === k)); el.querySelector('[data-tour=next]').textContent = k >= TOUR.length - 1 ? 'Done' : 'Next'; el.dataset.card = k; };
      track.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
      el.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-tour]'); if (!b) return;
        if (b.dataset.tour === 'skip') return finishTour('skipped');
        const k = idx(); if (k >= TOUR.length - 1) return finishTour('done');
        track.scrollTo({ left: (k + 1) * track.clientWidth, behavior: 'smooth' }); setTimeout(sync, 400);
      });
      tour = el; sync();
      openOverlay({ kind: 'tour', remove: () => { removeTour('skipped'); } });
    };
    function removeTour(state) { if (!tour) return; tour.remove(); tour = null; cfg().tour = state; save(); lastTipAt = Date.now(); }
    function finishTour(state) { removeTour(state); closeOverlay(); }
    O.tourOpen = () => !!tour;

    /* ---- tips ---- */
    function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }
    function dismissTip() { if (!tipEl) return; const id = tipEl.dataset.tip; hideTip(); cfg().tips[id] = true; save(); lastTipAt = Date.now(); closeOverlay(); }
    O.tipShown = () => (tipEl ? tipEl.dataset.tip : null);
    const visibleBox = () => {
      const top = (($('#topbar') || {}).getBoundingClientRect ? $('#topbar').getBoundingClientRect().bottom : 52) + 4;
      let bottom = ($('#tabbar') ? $('#tabbar').getBoundingClientRect().top : innerHeight) - 4;
      const rt = $('#rest-timer'); if (rt && !rt.classList.contains('hidden')) bottom = Math.min(bottom, rt.getBoundingClientRect().top - 4);
      return { top, bottom };
    };
    function restBusy() { const r = D.current && D.current.rest; if (!r) return false; return (r.total - (r.endAt - Date.now()) / 1000) < 6; } // first seconds of a rest
    O.check = (force) => {
      if (disabled() || tour || tipEl) return;
      if (!force && Date.now() - lastTipAt < O.cooldown) return;
      if (api.sheetOpen() || restBusy()) return;
      const ae = document.activeElement; if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
      const ua = navigator.userActivation; if (!force && ua && !ua.isActive) return; // only right after a tap (a tip is a history entry; Chrome skips entries added without a gesture)
      const h = location.hash || '#/workout'; const seen = cfg().tips; const box = visibleBox();
      for (const tip of TIPS) {
        if (seen[tip.id] || !h.startsWith(tip.route)) continue;
        if (tip.id === 'reorder' && !/^#\/programs\/[^/]+\/day\//.test(h)) continue;
        const a = [...document.querySelectorAll(tip.sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width && (e.closest('#topbar') ? r.top >= 0 : r.top >= box.top && r.bottom <= box.bottom); });
        if (a) { showTip(tip, a, box); return tip.id; }
      }
      return null;
    };
    O.schedule = (ms = 900) => { clearTimeout(timer); timer = setTimeout(() => O.check(), ms); };
    function showTip(tip, a, box) {
      const r = a.getBoundingClientRect(); const el = document.createElement('div');
      el.className = 'coach'; el.dataset.tip = tip.id; el.setAttribute('role', 'status');
      el.innerHTML = `<div class="coach-txt">${tip.t}</div><button class="coach-ok" data-coach="ok">Got it</button><i class="coach-arrow"></i>`;
      document.body.appendChild(el);
      // keep clear of the ✓ column so logging is never covered
      const doneCol = [...document.querySelectorAll('.done-btn')].map((d) => d.getBoundingClientRect().left).filter((x) => x > 0);
      const maxRight = (h0 => (h0.startsWith('#/session') && doneCol.length ? Math.min(...doneCol) - 8 : innerWidth - 8))(location.hash);
      const width = Math.max(150, Math.min(280, maxRight - 8));
      el.style.width = width + 'px';
      const left = Math.max(8, Math.min(r.left + r.width / 2 - 28, maxRight - width));
      const hgt = el.getBoundingClientRect().height;
      const below = r.bottom + 10 + hgt <= box.bottom || r.top - 10 - hgt < box.top;
      el.style.left = left + 'px'; el.style.top = (below ? r.bottom + 10 : r.top - 10 - hgt) + 'px';
      el.classList.add(below ? 'below' : 'above');
      const ax = Math.max(12, Math.min(width - 12, r.left + r.width / 2 - left)); el.querySelector('.coach-arrow').style.left = ax + 'px';
      tipEl = el;
      openOverlay({ kind: 'tip', remove: () => { const id = tipEl && tipEl.dataset.tip; hideTip(); if (id) { cfg().tips[id] = true; save(); lastTipAt = Date.now(); } } });
    }
    // tap anywhere dismisses (capture, never preventDefault: the tap still does what it does — e.g. ✓ logs the set)
    document.addEventListener('pointerdown', (ev) => { if (tipEl) dismissTip(); }, true);
    document.addEventListener('keydown', (ev) => { if (tipEl && ev.key !== 'Escape') dismissTip(); }, true);
    window.addEventListener('scroll', () => { if (tipEl) { hideTip(); closeOverlay(); } O.schedule(1200); }, { passive: true }); // a scrolled tip is not marked seen
    window.addEventListener('resize', () => { if (tipEl) { hideTip(); closeOverlay(); } });
    O.onRoute = () => { hideTip(); O.schedule(); };
    O.resetTips = () => { cfg().tips = {}; save(); lastTipAt = 0; };
    O.replayTour = () => { O.showTour(); };
    return O;
  }
  window.LTOnboard = { create, TOUR, TIPS, HELP };
})();
