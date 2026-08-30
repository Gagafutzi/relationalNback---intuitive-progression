"use strict";

/* ============================================================
   17. WIRING
   ============================================================ */

/* One place decides whether the panel is open. The body class is what hides the
   floating ⚙ button while it is — the button is fixed at the top-left, exactly where
   the panel's own header goes, and it used to sit on top of the first control. */
function setSettingsOpen(open) {
  $('settingsPanel').classList.toggle('open', open);
  document.body.classList.toggle('settings-open', open);
}
const toggleSettings = () =>
  setSettingsOpen(!$('settingsPanel').classList.contains('open'));

$('settingsBtn').onclick = toggleSettings;
$('settingsClose').onclick = () => setSettingsOpen(false);
$('modeProgression').onclick = () => setMode('progression');
$('modeFree').onclick = () => setMode('free');

/* --- progression tunables --- */
const numIn = (id, apply) => $(id).oninput = e => {
  const v = parseFloat(e.target.value);
  if (!isFinite(v)) return;
  apply(v);
  if (cfg.mode === 'progression') applyProgression();
  renderLadderState(); updateHUD(); saveProgress();
};
numIn('startInterval',  v => { tune.startInterval = Math.max(1000, v * 1000);
                               tune.maxInterval = tune.startInterval + 1500; });
numIn('targetInterval', v => tune.targetInterval = Math.max(500, v * 1000));
numIn('intervalStep',   v => tune.intervalStep = Math.max(50, v * 1000));
numIn('spinStart',      v => tune.spinStart = Math.max(5, v));
numIn('spinEnd',        v => tune.spinEnd = Math.max(3, v));
numIn('spinStep',       v => tune.spinStep = Math.max(1, v));
numIn('nMax',           v => tune.nMax = Math.max(1, Math.round(v)));
numIn('nAfterStimulus', v => tune.nAfterStimulus = Math.max(1, Math.round(v)));
numIn('blockLengthP',   v => tune.blockLength = Math.max(5, Math.round(v)));

$('feedbackMode').onchange = e => {
  cfg.feedback = e.target.value; renderGlyphLegend(); saveProgress();
};

/* --- appearance --- */
$('accentCustom').oninput  = e => { appearance.accent = e.target.value; applyAppearance(); saveAppearance(); };
$('axisPalette').onchange  = e => { appearance.palette = e.target.value; applyAppearance(); saveAppearance(); };
$('flatMode').onchange     = e => { appearance.flat = e.target.checked; applyAppearance(); saveAppearance(); };
$('bgDim').oninput         = e => {
  appearance.dim = +e.target.value;
  $('dimVal').textContent = appearance.dim;
  document.documentElement.style.setProperty('--bg-dim', (appearance.dim / 100).toFixed(2));
  saveAppearance();
};
$('bgFile').onchange = e => {
  const f = e.target.files && e.target.files[0];
  if (f) { $('bgStatus').textContent = 'Processing…'; setBackgroundFromFile(f); }
  e.target.value = '';
};
$('bgClear').onclick = () => { appearance.bg = null; applyAppearance(); saveAppearance(); };
$('bgFit').onclick = () => {
  appearance.bgFit = appearance.bgFit === 'cover' ? 'contain' : 'cover';
  applyAppearance(); saveAppearance();
  $('bgStatus').textContent = `Fit: ${appearance.bgFit}.`;
};

$('rcTier').onchange = e => {
  switchTier(+e.target.value);
  applyProgression(); syncSettingsUI(); updateHUD(); saveProgress();
};

$('fixedGlyphMap').onchange = e => {
  freeCfg.fixedGlyphMap = e.target.checked;
  /* Turning it on pins whatever map is current; turning it off drops the stored one
     so the next session reshuffles as normal. */
  if (!freeCfg.fixedGlyphMap) { delete progress.glyphMap; state.glyphMap = null; }
  else if (!state.glyphMap) shuffleGlyphMap();
  renderGlyphLegend(); saveProgress();
};

$('varPriority').onchange = e => {
  freeCfg.varPriority = e.target.checked;
  cfg.varPriority = e.target.checked;
  if (!cfg.varPriority) { state.priorityStream = null; renderPriorityCue(); }
  saveProgress();
};

$('adaptMode').onchange = e => {
  tune.adapt = e.target.value;
  if (tune.adapt === 'bayes' && !stairLog) stairInit(prog.interval || tune.startInterval);
  applyProgression(); renderLadderState(); updateHUD(); saveProgress();
};

$('resetProgress').onclick = () => {
  if (!confirm('Erase the ladder, all history and settings? This cannot be undone.')) return;
  localStorage.removeItem(storeKey());
  /* Reset through the one function that knows the whole picture. Clearing the fields
     by hand here left every OTHER tier's ladder untouched, so an erased profile got
     its quaternary progress back on the next save — and now that the tunables live
     per tier as well, they would have come back with it. */
  resetInMemoryState();
  progress = { version:2, bestLoad:0, dailyMinutes:{}, blocks:[] };
  stairInit(tune.startInterval);
  setMode('progression');       // re-syncs the whole panel on its way through
  renderDataPanel();
};

/* --- profiles --- */
$('profileSel').onchange = e => switchProfile(e.target.value);

$('profileNew').onclick = () => {
  const name = (prompt('Name for the new profile?', `Player ${profiles.list.length + 1}`) || '').trim();
  if (!name) return;
  const id = newProfileId();
  profiles.list.push({ id, name, created: Date.now() });
  saveProfiles();
  switchProfile(id);
  progress.tester = name;          // prefill the export label so files are identifiable
  saveProgress();
  syncSettingsUI();
};

$('profileRename').onclick = () => {
  const cur = activeProfile();
  const name = (prompt('Rename profile', cur.name) || '').trim();
  if (!name) return;
  cur.name = name;
  saveProfiles(); saveProgress(); renderProfileUI(); renderDataPanel();
};

$('profileDelete').onclick = () => {
  if (profiles.list.length < 2) return;
  const cur = activeProfile();
  if (!confirm(`Delete profile "${cur.name}" and all of its training history? ` +
               `This cannot be undone.`)) return;
  try { localStorage.removeItem(storeKey()); } catch (e) {}
  profiles.list = profiles.list.filter(p => p.id !== cur.id);
  const next = profiles.list[0].id;
  profiles.active = null;          // force switchProfile to do the full reload
  saveProfiles();
  profiles.active = next;
  resetInMemoryState();
  progress = loadProgress();
  if (!stairLog) stairInit(prog.interval || tune.startInterval);
  setMode(progress.mode || 'progression');
  buildCube(cfg.dim);
  saveProfiles(); renderDataPanel(); renderProfileUI(); syncSettingsUI();
};

/* --- session data --- */
$('testerLabel').oninput = e => { progress.tester = e.target.value.slice(0, 40); saveProgress(); };

$('exportJson').onclick = () => {
  const name = downloadJSON();
  $('dataStatus').innerHTML = `Saved <b>${name}</b> — send that file over.`;
};

$('copyJson').onclick = async () => {
  const txt = exportPayload();
  try {
    await navigator.clipboard.writeText(txt);
    $('dataStatus').textContent = `Copied ${Math.round(txt.length / 1024)} KB to clipboard.`;
  } catch (e) {
    /* Clipboard needs a secure context; file:// and some browsers refuse it. */
    $('dataStatus').innerHTML =
      `Clipboard blocked here — use <b>Download JSON</b> instead.`;
  }
};

$('importJson').onchange = e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!confirm('Replace ALL local progress with the contents of this file?')) {
    e.target.value = ''; return;
  }
  const r = new FileReader();
  r.onload = () => {
    try {
      const n = importJSON(String(r.result));
      $('dataStatus').innerHTML = `Restored <b>${n}</b> blocks from ${file.name}.`;
    } catch (err) {
      $('dataStatus').innerHTML = `<span style="color:#ff6b6b">Import failed: ${err.message}</span>`;
    }
    e.target.value = '';
  };
  r.readAsText(file);
};

$('resetKeybinds').onclick = () => {
  keyBinds = {};
  buildDeck(); renderKeybinds(); renderShortcuts(); saveProgress();
};

$('resetShortcuts').onclick = () => {
  actionBinds = {};
  /* The deck avoids whatever keys the shortcuts hold, so restoring the defaults can
     change which pool key a button ends up on. */
  buildDeck(); renderKeybinds(); renderShortcuts(); saveProgress();
};

/* --- free play --- */
const freeIn = (id, apply, rebuild) => $(id).oninput = e => {
  const v = parseFloat(e.target.value);
  if (!isFinite(v)) return;
  apply(v); applyFree(); if (rebuild) buildCube(cfg.dim); updateHUD(); saveProgress();
};
freeIn('nValue',        v => freeCfg.n = Math.max(1, Math.round(v)));
freeIn('intervalMs',    v => freeCfg.interval = Math.max(500, v));
freeIn('blockLengthF',  v => freeCfg.blockLength = Math.max(5, Math.round(v)));
freeIn('rotationSpeed', v => freeCfg.spin = Math.max(5, v));

freeIn('lureRateF',     v => freeCfg.lureRate = Math.min(LURE_MAX, Math.max(LURE_MIN, v / 100)));
$('metaOn').onchange  = e => { freeCfg.meta = e.target.checked; applyFree(); syncSettingsUI(); updateHUD(); saveProgress(); };
$('gateOn').onchange  = e => { freeCfg.gate = +e.target.value; applyFree(); updateHUD(); saveProgress(); };
$('retroOn').onchange = e => { freeCfg.retro = +e.target.value; applyFree(); syncSettingsUI(); updateHUD(); saveProgress(); };
$('varNBack').onchange = e => { freeCfg.varN = +e.target.value; applyFree(); syncSettingsUI(); updateHUD(); saveProgress(); };

$('cubeDimension').onchange = e => { freeCfg.dim = +e.target.value; applyFree(); buildCube(cfg.dim); updateHUD(); saveProgress(); };
$('rotationOn').onchange    = e => { freeCfg.rotation = e.target.checked; applyFree(); updateHUD(); saveProgress(); };
$('frameMode').onchange     = e => { freeCfg.frame = e.target.value; applyFree(); updateHUD(); saveProgress(); };
$('feedbackModeF').onchange = e => { freeCfg.feedback = e.target.value; cfg.feedback = e.target.value; renderGlyphLegend(); saveProgress(); };
/* --- display (shared by both modes) --- */
/* Rebuilds rather than just toggling visibility: with the arms gone the stage needs
   a smaller footprint, so the lattice grows to fill it and the arm lengths — which
   are computed in px at build time — no longer match. */
$('gizmoMode').onchange = e => { cfg.gizmo = e.target.value; onConfigChanged(true); saveProgress(); };
$('letterVoice').onchange = e => {
  cfg.letterVoice = e.target.value;
  primeLetters(); syncSettingsUI(); saveProgress();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  /* Decoding is async, so the sample is a beat behind the click on first use. */
  setTimeout(() => playLetter({ letter: 0 }), 260);
};
$('voiceSet').onchange = e => {
  cfg.voiceSet = e.target.value;
  syncSettingsUI(); saveProgress();
  /* Play the set bottom to top so the ordering the deck labels claim is audible. */
  if (audioCtx.state === 'suspended') audioCtx.resume();
  voiceSet().voices.forEach((_, i) =>
    setTimeout(() => playTone({ timbre: i, pitch: 1 }), i * 260));
};
/* Rebuilds: the two paths want different stage footprints, and the spaced layout
   sizes its cells from whichever view is actually going to be held. */
$('spinPath').onchange  = e => {
  cfg.spinPath = e.target.value;
  onConfigChanged(true); syncSettingsUI(); updateHUD(); saveProgress();
};
$('cellVis').onchange   = e => { cfg.cellVis = e.target.value; applyCellVis(); saveProgress(); };
$('dailyGoal').oninput = e => {
  cfg.dailyGoal = Math.max(0, +e.target.value || 0);
  renderDailyTimer(); saveProgress();
};
$('buzzer').onchange = e => {
  cfg.buzzer = e.target.checked;
  /* Audition both, so the two error sounds are distinguishable before you meet
     them mid-block. */
  if (cfg.buzzer) { playBuzz('fa'); setTimeout(() => playBuzz('miss'), 420); }
  saveProgress();
};

$('cubeSize').oninput = e => {
  cfg.cubeScale = +e.target.value / 100;
  $('cubeSizeVal').textContent = e.target.value;
  document.documentElement.style.setProperty('--cube-scale', cfg.cubeScale);
  /* The stage is sized from --cube-size, so the cube has to be rebuilt against the
     new pixel width or the spaced solve is scaled to the old one. */
  buildCube(cfg.dim);
  const cur = state.history[state.history.length - 1];
  if (state.running && cur) state.cells[cur.cellIdx].el.classList.add('active');
  saveProgress();
};

$('cubeLayout').onchange = e => {
  cfg.layout = e.target.value;
  buildCube(cfg.dim);
  applyGizmoMode();
  /* A layout change mid-block would strand the lit cell on a destroyed element. */
  const cur = state.history[state.history.length - 1];
  if (state.running && cur) state.cells[cur.cellIdx].el.classList.add('active');
  $('layoutHint').textContent = LAYOUT_HINT[cfg.layout] || '';
  updateHUD(); saveProgress();
};

/* --- run controls --- */
$('startBtn').onclick = () => {
  setSettingsOpen(false);
  if (cfg.streams.glyph === 'relational') showGlyphIntro(startBlock);
  else startBlock();
};
$('stopBtn').onclick = () => stopBlock(false);

/* What each shortcut actually does. The guards are the point: Start must not be able
   to restart a block that is already running, and Pause must not fire when there is
   nothing to pause. Stop is deliberately unguarded — pressing it with no block in
   progress clears the last block's feedback off the HUD, which is the behaviour it
   has always had. */
const ACTION_RUN = {
  start:    () => { if (!state.running) $('startBtn').click(); },
  stop:     () => stopBlock(false),
  pause:    () => { if (state.paused) resumeFromPause();
                    else if (state.running) pauseBlock(PAUSE_WHY.manual); },
  settings: () => toggleSettings(),
};

/* Bare modifiers make useless bindings — a shortcut on Shift would fire every time
   you reached for a capital — so a modifier does not end the capture. Hold it, press
   a real key, and that key is what gets bound. */
const UNBINDABLE = new Set(['shift', 'control', 'alt', 'meta', 'altgraph',
                            'capslock', 'dead', 'unidentified']);

document.addEventListener('keydown', e => {
  /* Rebinding swallows the next key, whatever it is — including keys that would
     otherwise be responses or shortcuts. */
  if (capturingId) {
    e.preventDefault(); e.stopPropagation();
    const id = capturingId, k = e.key.toLowerCase();
    if (k === 'escape') { renderKeybinds(); return; }
    capturingId = null;
    if (k === 'backspace' || k === 'delete') clearBind(id); else rebind(id, k);
    return;
  }
  if (capturingAction) {
    e.preventDefault(); e.stopPropagation();
    const id = capturingAction, k = e.key.toLowerCase();
    if (UNBINDABLE.has(k)) return;
    if (k === 'escape') { renderShortcuts(); return; }
    capturingAction = null;
    if (k === 'backspace' || k === 'delete') clearActionBind(id);
    else rebindAction(id, k);
    return;
  }
  /* e.target can be `document` (no .matches), which would throw and swallow the
     keypress. Guard on Element before testing. */
  if (e.target instanceof Element && e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  /* Responses are checked before shortcuts and that order is not negotiable: a deck
     key is pressed under time pressure and must never be second-guessed. A shortcut
     parked on the same key is the one that gives way, and the editor marks it red. */
  const ch = state.keyIndex[k];
  if (ch) { e.preventDefault(); press(ch); return; }
  const act = actionForKey(k);
  const run = act && ACTION_RUN[act.id];
  if (run) { e.preventDefault(); run(); }
});

/* ---- Pausing ----
   A hidden tab has its timers clamped to ~1 Hz, so a block left running in the
   background would present trials at the wrong interval and log reaction times
   measured against a stretched clock. Both would quietly corrupt the record, so the
   block stops and the interruption is flagged on the saved block.

   The manual pause shortcut runs through exactly the same path, which is what keeps
   it honest: it costs you the trial on screen and stamps the block as interrupted,
   so it cannot be used to buy a moment's thinking time mid-trial. */
const PAUSE_WHY = {
  hidden: 'The tab lost focus, so the block was paused — browsers slow background ' +
          'timers and the pacing would have been wrong.',
  manual: 'Paused by hand. The trial that was on screen has been discarded and the ' +
          'block is flagged as interrupted in your record.',
};

function pauseBlock(why) {
  if (!state.running || state.paused) return;
  clearInterval(state.timer); state.timer = null;
  clearTimeout(state.cueTimer);
  clearTimeout(state.buzzTimer);
  state.lastSnap = null; state.tickAt = 0;
  state.paused = true;
  state.interrupted = true;
  /* The trial on screen was not seen for its proper duration, so it must not be
     scored. */
  state.judgments = [];
  state.presses.clear();
  clearCells();
  hideLagCue();
  $('retroCue').classList.remove('show');
  $('pauseText').textContent = why;
  $('pauseVeil').classList.add('show');
}

function resumeFromPause() {
  if (!state.paused) return;
  state.paused = false;
  $('pauseVeil').classList.remove('show');
  state.stimAt = 0; state.tickAt = 0; state.lastSnap = null;
  tick();
  state.timer = setInterval(tick, cfg.interval);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseBlock(PAUSE_WHY.hidden);
});
$('pauseResume').onclick = resumeFromPause;

/* Debounced: cube size is vmin-based so a resize must rebuild, but mobile browsers
   fire this continuously as the address bar hides, and each rebuild drops the
   on-screen stimulus. */
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    /* Only the cube box matters here. A phone fires resize for every address-bar
       slide and for the keyboard opening, and rebuilding on each one threw away the
       stimulus mid-trial. */
    const box = parseFloat(getComputedStyle(cubeWrapper).width);
    if (Math.abs(box - state.builtSize) < 0.5) return;

    buildCube(cfg.dim);
    /* Re-render rather than just re-flagging the cell: the lattice is new DOM, so
       colour, glyph, size and quantity are all gone and the slot would come back
       blank. Skipped while a retro cue is up — the stimulus is meant to be hidden
       then, and painting it back would hand over the answer. */
    const cur = state.currentTrial;
    if (state.running && cur && state.stimShown) {
      /* The recorded matrix is the one the screen frame is judged against, sampled
         at onset. Re-rendering must not re-sample it at the angle we happen to be
         at now. */
      const m = cur.matrix;
      renderTrial(cur);
      cur.matrix = m;
    }
  }, 160);
});

