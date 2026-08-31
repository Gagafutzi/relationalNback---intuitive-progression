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
                       cfg.moveTrace = !!p.display.moveTrace; }
    if (p.mode) cfg.mode = p.mode;
    return p;
  } catch (e) { return blank; }
}

function saveProgress() {
  if (progress.blocks.length > 500) progress.blocks = progress.blocks.slice(-500);
  progress.build = BUILD;
  progress.prog = prog; progress.tune = tune;
  progress.freeCfg = freeCfg; progress.mode = cfg.mode;
  progress.keyBinds = keyBinds;
  progress.actionBinds = actionBinds;
  progress.display = { gizmo: cfg.gizmo, cellVis: cfg.cellVis, layout: cfg.layout,
                       spinPath: cfg.spinPath, voiceSet: cfg.voiceSet,
                       letterVoice: cfg.letterVoice,
                       cubeScale: cfg.cubeScale,
                       dailyGoal: cfg.dailyGoal, buzzer: cfg.buzzer,
                       moveTrace: cfg.moveTrace };
  progress.stair = stairLog ? stairLog.map(v => +v.toFixed(4)) : null;
  progress.rcTier = rcTier;
  progress.profileName = activeProfile().name;
  if (freeCfg.fixedGlyphMap && state.glyphMap) progress.glyphMap = state.glyphMap;
  else delete progress.glyphMap;
  tierState(rcTier).prog = { ...prog };
  tierState(rcTier).stair = stairLog ? stairLog.slice() : null;
  tierState(rcTier).tune = { ...tune };
  progress.tiers = Object.fromEntries(Object.entries(tiers).map(([k, v]) =>
    [k, { prog: v.prog, tune: v.tune,
          stair: v.stair ? v.stair.map(x => +x.toFixed(4)) : null }]));

  try {
    localStorage.setItem(storeKey(), JSON.stringify(progress));
    progress.saveWarning = null;
  } catch (e) {
    /* Out of quota. Shed the bulkiest thing (raw per-press logs on older blocks)
       and retry rather than silently losing every block from here on — an invisible
       stop would quietly wipe out a whole test round. */
    try {
      const keep = 25;
      progress.blocks.forEach((b, i) => {
        if (i < progress.blocks.length - keep) delete b.presses;
      });
      localStorage.setItem(storeKey(), JSON.stringify(progress));
      progress.saveWarning = 'storage full — dropped raw press logs from older blocks';
    } catch (e2) {
      try {
        progress.blocks = progress.blocks.slice(-100);
        localStorage.setItem(storeKey(), JSON.stringify(progress));
        progress.saveWarning = 'storage full — kept only the last 100 blocks';
      } catch (e3) {
        progress.saveWarning = 'could not save — export your JSON before closing';
      }
    }
    renderDataPanel();
  }
}

const today = () => new Date().toISOString().slice(0, 10);

function addMinutes(ms) {
  const d = today();
  progress.dailyMinutes[d] = (progress.dailyMinutes[d] || 0) + ms / 60000;
  saveProgress();
  renderDataPanel();
}

