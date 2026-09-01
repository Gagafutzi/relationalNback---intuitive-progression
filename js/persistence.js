"use strict";

/* ============================================================
   5. PERSISTENCE
   ============================================================ */

/* ---- Profiles ----
   Each profile owns a complete, independent training record under its own key, so
   several people can share a browser and one person can keep separate tracks.
   Appearance stays device-level: it is a display preference, and per-profile
   background images would multiply the storage that matters least. */
const PROFILES_KEY = 'rnb.profiles.v1';
const LEGACY_KEY   = 'rnb.progress.v2';

let profiles = { active: null, list: [] };

const storeKey = () => `${LEGACY_KEY}.${profiles.active}`;
const newProfileId = () =>
  'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && Array.isArray(p.list) && p.list.length) {
        profiles = p;
        if (!profiles.list.some(x => x.id === profiles.active))
          profiles.active = profiles.list[0].id;
        return;
      }
    }
  } catch (e) { /* fall through to a fresh registry */ }

  /* First run, or upgrading from the single-key layout: adopt any existing record
     as the first profile rather than stranding it. */
  const id = newProfileId();
  profiles = { active: id, list: [{ id, name: 'Player 1', created: Date.now() }] };
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      localStorage.setItem(`${LEGACY_KEY}.${id}`, legacy);
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) { /* keep the legacy copy if the move fails */ }
  }
  saveProfiles();
}

function saveProfiles() {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); } catch (e) {}
}

const activeProfile = () =>
  profiles.list.find(p => p.id === profiles.active) || { name: '—', id: '' };

loadProfiles();
progress = loadProgress();

/* Everything that lives outside `progress` and has to be re-seeded when the active
   profile changes. Reset first, then load, so a profile with no saved value inherits
   a clean default rather than the previous profile's. */
function resetInMemoryState() {
  prog = { streamCount:1, n:1, spinLevel:0, interval:5000, lureRate:0.20 };
  Object.keys(tiers).forEach(k => delete tiers[k]);
  rcTier = 3;
  stairLog = null;
  keyBinds = {};
  actionBinds = {};
  Object.assign(progCfg, { feedback: 'reveal' });
  state.glyphMap = null;
  Object.assign(tune, TUNE_DEFAULTS);
  Object.assign(freeCfg, {
    n:2, streams:{ position:'relational' }, dim:3, rotation:false, spin:60,
    frame:'cube', interval:2500, blockLength:20, feedback:'reveal',
    lureRate:0.20, meta:false, gate:0, retro:0, varN:0,
    varPriority:true, fixedGlyphMap:false,
  });
}

function switchProfile(id) {
  if (id === profiles.active) return;
  if (state.running) stopBlock(true);
  saveProgress();                      // flush the outgoing profile
  profiles.active = id;
  saveProfiles();
  resetInMemoryState();
  progress = loadProgress();
  if (!stairLog) stairInit(prog.interval || tune.startInterval);
  setMode(progress.mode || 'progression');
  buildCube(cfg.dim);
  renderDataPanel();
  renderProfileUI();
}

function loadProgress() {
  const blank = { version:2, bestLoad:0, dailyMinutes:{}, blocks:[] };
  try {
    const raw = localStorage.getItem(storeKey());
    if (!raw) return blank;
    const p = Object.assign(blank, JSON.parse(raw));
    if (p.prog) Object.assign(prog, p.prog);
    if (p.tune) Object.assign(tune, p.tune);
    if (p.freeCfg) Object.assign(freeCfg, p.freeCfg);
    if (p.progCfg) Object.assign(progCfg, p.progCfg);
    if (p.keyBinds) keyBinds = p.keyBinds;
    if (p.actionBinds) actionBinds = p.actionBinds;
    /* Only accept a posterior that matches the current grid, so changing STAIR.steps
       can never silently reinterpret an old array against a different grid. */
    if (Array.isArray(p.stair) && p.stair.length === STAIR.steps) stairLog = p.stair.slice();
    if (p.tiers) Object.entries(p.tiers).forEach(([k, v]) => {
      tiers[k] = { prog: v.prog,
        stair: Array.isArray(v.stair) && v.stair.length === STAIR.steps ? v.stair.slice() : null,
        /* Records written before the tunables were per-tier carry no v.tune. Seeding
           every tier from the one global set that record does have keeps whatever was
           configured, rather than resetting a tuned ladder to the factory numbers. */
        tune: { ...TUNE_DEFAULTS, ...(v.tune || p.tune || {}) } };
    });
    if (p.rcTier) rcTier = p.rcTier;
    /* A fixed symbol map is only fixed if it outlives the session that made it. */
    if (p.glyphMap) state.glyphMap = p.glyphMap;
    if (p.display) { cfg.gizmo = p.display.gizmo || cfg.gizmo;
                     cfg.cellVis = p.display.cellVis || cfg.cellVis;
                     cfg.layout = p.display.layout || cfg.layout;
                     cfg.spinPath = p.display.spinPath || cfg.spinPath;
                     cfg.voiceSet = p.display.voiceSet || cfg.voiceSet;
                     cfg.letterVoice = p.display.letterVoice || cfg.letterVoice;
                     cfg.cubeScale = p.display.cubeScale || cfg.cubeScale;
                     if (p.display.dailyGoal != null) cfg.dailyGoal = p.display.dailyGoal;
                     cfg.buzzer = !!p.display.buzzer;
                     if (p.display.moveTrace != null)
                       cfg.moveTrace = !!p.display.moveTrace;
                     if (p.display.autoAdvance != null)
                       cfg.autoAdvance = +p.display.autoAdvance || 0; }
    if (p.mode) cfg.mode = p.mode;
    return p;
  } catch (e) { return blank; }
}

/* ---- Press-log compaction ----
   A block's raw press log is by far the biggest thing in a record: roughly 40 bytes
   per press against ~700 for everything else combined. That made it the first thing
   quota pressure reached for, and it used to be deleted outright — throwing away the
   only per-trial data the app ever collects. Reaction-time SPREAD (which moves before
   accuracy does), which channel specifically you get wrong, whether you decay across
   a block: all of it, gone, with a one-line warning in a collapsed panel.

   None of those questions actually need the raw log. They need a summary about a
   fifth the size, so the log is summarised instead of dropped. */
function quantiles(sorted, qs) {
  if (!sorted.length) return null;
  return qs.map(q => {
    const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
  });
}

function summarisePresses(b) {
  const p = b.presses;
  if (!Array.isArray(p)) return;
  const rts = p.map(x => x.rt).filter(r => r != null).sort((a, c) => a - c);

  /* Accuracy by position in the block, in thirds. Keeps "do I fade, and is my block
     length right for me" answerable once the per-trial rows are gone. */
  const span = Math.max(1, b.trials || b.plannedTrials || 1);
  const thirds = [[0, 0], [0, 0], [0, 0]];
  const ch = {};
  p.forEach(x => {
    const k = Math.max(0, Math.min(2, Math.floor(((x.t || 1) - 1) / span * 3)));
    thirds[k][0]++; if (x.ok) thirds[k][1]++;
    const c = ch[x.ch] || (ch[x.ch] = [0, 0, []]);
    c[0]++; if (x.ok) c[1]++; if (x.rt != null) c[2].push(x.rt);
  });

  b.pressSummary = {
    n: p.length,
    late: p.filter(x => x.late).length,
    rt: quantiles(rts, [0.1, 0.25, 0.5, 0.75, 0.9]),   // the median alone hid the spread
    thirds,                                            // [[n, ok] × 3]
    ch: Object.fromEntries(Object.entries(ch).map(([k, c]) => {
      c[2].sort((a, d) => a - d);
      return [k, [c[0], c[1], c[2].length ? c[2][c[2].length >> 1] : null]];   // n, ok, median rt
    })),
  };
  delete b.presses;
}

/* Raw logs survive for the most recent blocks and become summaries behind them. Run
   on EVERY save rather than only once the quota is gone: a bounded steady state means
   the wall is never reached, and reaching it is what used to cost whole blocks. */
const FULL_PRESS_BLOCKS = 60;
function compactPresses(keep = FULL_PRESS_BLOCKS) {
  const b = progress.blocks, cut = b.length - keep;
  for (let i = 0; i < cut; i++) if (b[i].presses) summarisePresses(b[i]);
}

/* Summaries are shed oldest-first too. The first version dropped them from every
   block at once, including the block just played, which threw away far more than the
   quota was actually asking for. */
function dropSummaries(keep) {
  const b = progress.blocks, cut = b.length - keep;
  for (let i = 0; i < cut; i++) delete b[i].pressSummary;
}

/* Last resort, and the reason the old `slice(-500)` was the worst line in this file:
   it ran unconditionally on every save, with no quota problem at all, and a block
   past the cap simply ceased to exist. Blocks that genuinely have to go now leave a
   per-day line behind, so a year of training can never read as though it did not
   happen. Sums, not means — that is what merges when the next block folds in. */
function rollUpBlocks(n) {
  const roll = progress.rollup || (progress.rollup = {});
  progress.blocks.splice(0, n).forEach(b => {
    const d = new Date(b.ts || Date.now()).toISOString().slice(0, 10);
    const r = roll[d] || (roll[d] = { blocks: 0, trials: 0, scoreSum: 0, loadSum: 0, bestLoad: 0 });
    r.blocks++;
    r.trials += b.trials || b.plannedTrials || 0;
    r.scoreSum += b.score || 0;
    r.loadSum += b.load || 0;
    r.bestLoad = Math.max(r.bestLoad, b.load || 0);
  });
}

function saveProgress() {
  progress.build = BUILD;
  progress.prog = prog; progress.tune = tune;
  progress.freeCfg = freeCfg; progress.mode = cfg.mode;
  progress.keyBinds = keyBinds;
  progress.actionBinds = actionBinds;
  progress.progCfg = progCfg;
  progress.display = { gizmo: cfg.gizmo, cellVis: cfg.cellVis, layout: cfg.layout,
                       spinPath: cfg.spinPath, voiceSet: cfg.voiceSet,
                       letterVoice: cfg.letterVoice,
                       cubeScale: cfg.cubeScale,
                       dailyGoal: cfg.dailyGoal, buzzer: cfg.buzzer,
                       moveTrace: cfg.moveTrace, autoAdvance: cfg.autoAdvance };
  progress.stair = stairLog ? stairLog.map(v => +v.toFixed(4)) : null;
  progress.rcTier = rcTier;
  progress.profileName = activeProfile().name;
  /* Only Free Play owns the remembered map. Progression reshuffles by design, and
     writing through from there would overwrite the very map this setting exists to
     preserve — so a progression session leaves the saved one alone entirely. */
  if (cfg.mode === 'free') {
    if (freeCfg.fixedGlyphMap && state.glyphMap) progress.glyphMap = state.glyphMap;
    else delete progress.glyphMap;
  }
  tierState(rcTier).prog = { ...prog };
  tierState(rcTier).stair = stairLog ? stairLog.slice() : null;
  tierState(rcTier).tune = { ...tune };
  progress.tiers = Object.fromEntries(Object.entries(tiers).map(([k, v]) =>
    [k, { prog: v.prog, tune: v.tune,
          stair: v.stair ? v.stair.map(x => +x.toFixed(4)) : null }]));

  compactPresses();

  const write = () => {
    try { localStorage.setItem(storeKey(), JSON.stringify(progress)); return true; }
    catch (e) { return false; }
  };
  /* Re-rendering only when the message actually changes: saveProgress runs on every
     settings keystroke, and a panel rebuild per keystroke is its own bug. */
  const done = warning => {
    const changed = progress.saveWarning !== warning;
    progress.saveWarning = warning;
    if (changed) renderDataPanel();
  };

  if (write()) { done(null); return; }

  /* Out of quota. Every step is retried immediately, so we stop at the first one that
     fits instead of over-shedding, and each gives up strictly less than the next.
     Raw logs go before summaries because they are four times the size, and both go
     oldest-first. */
  const shed = [
    () => compactPresses(20),
    () => compactPresses(0),
    () => dropSummaries(120),
    () => dropSummaries(20),
    () => dropSummaries(0),
  ];
  for (const step of shed) {
    step();
    if (write()) { done('storage tight — per-press detail trimmed from older blocks'); return; }
  }

  /* Blocks themselves now, halving what is left each time. Nibbling 25 at a time made
     a genuinely full quota cost dozens of serialisations to converge, and it stopped
     at an arbitrary floor of 50 — which meant refusing to save at all rather than
     shedding the 51st, losing the block just played into the bargain. */
  while (progress.blocks.length > 4) {
    rollUpBlocks(Math.max(4, progress.blocks.length >> 1));
    if (write()) {
      done(`storage full — oldest blocks folded into daily totals, ` +
           `${progress.blocks.length} kept in full. Export your JSON to keep the rest.`);
      return;
    }
  }
  /* Daily totals and the ladder, nothing else. Still far better than a failed write,
     which loses the block you just played as well as everything before it. */
  rollUpBlocks(progress.blocks.length);
  if (write()) { done('storage full — only daily totals kept. Export your JSON.'); return; }
  done('could not save — export your JSON now, before closing this tab');
}

const today = () => new Date().toISOString().slice(0, 10);

function addMinutes(ms) {
  const d = today();
  progress.dailyMinutes[d] = (progress.dailyMinutes[d] || 0) + ms / 60000;
  saveProgress();
  renderDataPanel();
}

