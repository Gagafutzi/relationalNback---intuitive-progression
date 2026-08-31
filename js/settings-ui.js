"use strict";

/* ============================================================
   16. SETTINGS UI
   ============================================================ */

function renderStreamRows() {
  const wrap = $('streamRows');
  wrap.innerHTML = '';
  STREAM_KEYS.forEach(k => {
    const spec = STREAMS[k];
    const row = document.createElement('div');
    row.className = 'stream-row';
    row.innerHTML = `<span class="swatch" style="background:${spec.color}"></span>
      <span class="nm">${spec.label}</span>
      <select data-stream="${k}">
        <option value="off">Off</option>
        <option value="identity">Identity</option>
        ${spec.idOnly ? '' : '<option value="relational">Relational</option>'}
      </select>`;
    const sel = row.querySelector('select');
    /* A profile saved before this stream existed, or hand-edited, could still name a
       mode the stream cannot serve. */
    if (spec.idOnly && freeCfg.streams[k] === 'relational') freeCfg.streams[k] = 'identity';
    sel.value = freeCfg.streams[k] || 'off';
    sel.onchange = () => { freeCfg.streams[k] = sel.value; applyFree(); updateHUD(); saveProgress(); };
    wrap.appendChild(row);
  });
}

let capturingId = null;

function renderKeybinds() {
  capturingId = null;
  const wrap = $('keybindList');
  wrap.innerHTML = '';

  STREAM_KEYS.forEach(k => {
    const spec = STREAMS[k];
    const head = document.createElement('div');
    head.className = 'kb-stream';
    head.innerHTML = `<span style="color:${spec.color}">■</span> ${spec.label}`;
    wrap.appendChild(head);

    ['identity', 'relational', 'relationalScreen'].forEach(mode => {
      (spec[mode] || []).forEach(c => {
        const row = document.createElement('div');
        row.className = 'kb-row';
        row.innerHTML =
          `<span class="kb-glyph" style="color:${c.color || spec.color}">${c.glyph}</span>
           <span class="kb-label">${c.label}${
             mode === 'relationalScreen' ? ' <span style="opacity:.45">screen</span>' :
             mode === 'identity' ? ' <span style="opacity:.45">id</span>' : ''}</span>`;

        /* For a channel that's live right now, show the key that ACTUALLY works —
           assignKeys may have bumped it off its preferred key to keep the live deck
           unambiguous. Dormant channels show their configured key instead. */
        const live = runtimeKey(c.id);
        const bumped = live && live !== effectiveKey(c.id);
        if (!live) row.style.opacity = '.5';

        const btn = document.createElement('button');
        btn.className = 'kb-key' + (keyBinds[c.id] ? ' custom' : '') + (bumped ? ' clash' : '');
        btn.dataset.id = c.id;
        btn.textContent = keyLabel(live || effectiveKey(c.id));
        if (bumped) btn.title = `Wanted ${keyLabel(effectiveKey(c.id))}, but another ` +
          `active button already has it — using ${keyLabel(live)} instead.`;
        else if (!live) btn.title = 'This stream is not active right now.';
        btn.onclick = () => {
          if (capturingAction) renderShortcuts();   // only one editor may await a key
          wrap.querySelectorAll('.kb-key.capturing').forEach(b => {
            b.classList.remove('capturing');
            b.textContent = keyLabel(effectiveKey(b.dataset.id));
          });
          capturingId = c.id;
          btn.classList.add('capturing');
          btn.textContent = 'press…';
        };
        row.appendChild(btn);
        wrap.appendChild(row);
      });
    });
  });
}

/* The key a channel responds to right now, or undefined if its stream is dormant. */
function runtimeKey(id) {
  for (const k in state.keyIndex) if (state.keyIndex[k] === id) return k;
  return undefined;
}

let capturingAction = null;

/* Drop a capture that is waiting in this list. Kept separate from a full re-render
   because the click handler below runs on a button inside it — re-rendering would
   detach the very element about to be styled. */
function clearShortcutCapture(wrap) {
  wrap.querySelectorAll('.kb-key.capturing').forEach(b => {
    b.classList.remove('capturing');
    b.textContent = keyLabel(effectiveAction(b.dataset.action));
  });
  capturingAction = null;
}

/* The shortcut editor. Same widget as the keybind rows, but the clash it warns about
   runs the other way. There, a channel loses its preferred key to another channel and
   is handed a replacement. Here nothing is handed over: the keydown handler consults
   the deck first, so a response button sitting on a shortcut's key just makes the
   shortcut stop working, with nothing on screen to say why. Hence the red key and the
   explicit tooltip. */
function renderShortcuts() {
  const wrap = $('shortcutList');
  capturingAction = null;
  wrap.innerHTML = '';

  ACTIONS.forEach(a => {
    const key = effectiveAction(a.id);
    const row = document.createElement('div');
    row.className = 'kb-row';
    row.innerHTML = `<span class="kb-label">${a.label}
      <span class="kb-note">${a.hint}</span></span>`;

    const shadow = key ? state.keyIndex[key] : undefined;
    const btn = document.createElement('button');
    btn.className = 'kb-key' + (key !== ACTION_BY_ID[a.id].key ? ' custom' : '')
                             + (shadow ? ' clash' : '');
    btn.dataset.action = a.id;
    btn.textContent = keyLabel(key);
    btn.title = shadow
      ? `${keyLabel(key)} is a live response button right now (${
          (CHANNEL_BY_ID[shadow] || {}).label || shadow}), so it answers the task ` +
        `instead of running this. Pick another key.`
      : key ? 'Click, then press the key you want.'
            : 'Not bound to anything. Click, then press the key you want.';
    btn.onclick = () => {
      if (capturingId) renderKeybinds();   // only one editor may await a key
      clearShortcutCapture(wrap);
      capturingAction = a.id;
      btn.classList.add('capturing');
      btn.textContent = 'press…';
    };
    row.appendChild(btn);
    wrap.appendChild(row);
  });
}

function renderLadderState() {
  const levels = spinLevels();
  const active = PROG_STREAMS.slice(0, prog.streamCount);
  const pos = ladderPosition();
  $('ladderState').innerHTML = `
    <div><span class="k">Milestone</span><b>${pos.index}</b> of ${pos.total}</div>
    <div><span class="k">Stimuli</span><b>${active.length}</b> — ${
      active.map(s => `${STREAMS[s.key].label}<span style="opacity:.5">·${s.mode === 'relational' ? 'rel' : 'id'}</span>`).join(', ')}</div>
    <div><span class="k">N</span><b>${prog.n}</b></div>
    <div><span class="k">Rotation</span><b>${prog.spinLevel === 0 ? 'still' : levels[prog.spinLevel] + 's/turn'}</b>${
      prog.spinLevel > 0 ? ` <span style="opacity:.5">(step ${prog.spinLevel}/${levels.length - 1})</span>` : ''}</div>
    <div><span class="k">Interval</span><b>${(prog.interval / 1000).toFixed(2)}s</b>
      <span style="opacity:.5">→ ${(tune.targetInterval / 1000).toFixed(2)}s</span></div>
    <div><span class="k">Lure rate</span><b>${Math.round((prog.lureRate ?? 0.2) * 100)}%</b>
      <span style="opacity:.5">adapts on lure trials only</span></div>` +
    (tune.adapt === 'bayes' && stairLog ? `
    <div><span class="k">Threshold</span><b>${(stairThresholdMs() / 1000).toFixed(2)}s</b>
      <span style="opacity:.5">90% CI ${stairCI(0.9).map(v => (v / 1000).toFixed(2)).join('–')}s</span></div>
    <div><span class="k">Confidence</span><b>${Math.round(stairMassBelow(tune.targetInterval) * 100)}%</b>
      <span style="opacity:.5">below target · need ${Math.round(STAIR.clearAt * 100)}%</span></div>` : '');

  $('rcTier').value = String(rcTier);
  $('rcHint').textContent = rcTier >= 4
    ? 'Quaternary binds two relations into one representation — Halford\'s documented adult ceiling. Its own ladder, its own staircase and its own targets, independent of the ternary track.'
    : 'Ternary binds two positions and the direction relating them. The standard track. Its ladder and its targets are its own — editing them leaves quaternary untouched.';

  /* Every section whose numbers are stored per tier is stamped with the tier they
     belong to. Without it, the same four panels showing different values depending on
     a dropdown further up reads as a bug rather than as the point. */
  document.querySelectorAll('.tier-tag').forEach(el => {
    el.textContent = `RC ${rcTier}`;
    el.title = `Saved separately for each relational-complexity tier. ` +
               `You are editing the RC ${rcTier} track.`;
  });

  $('adaptHint').textContent = tune.adapt === 'bayes'
    ? 'Estimates your speed threshold and places each block where it learns most. Carries what it knows across milestones instead of restarting at the top.'
    : 'Walks the interval down one fixed step per good block, resetting to the start at every milestone.';

  const nx = describeNext(prog);
  $('nextUp').innerHTML = `Clear this milestone and <b>${nx.what}</b>.<br>
    <span style="opacity:.75">${nx.why}</span>`;

  $('spinLadderHint').textContent =
    `${levels.length - 1} rotation steps: ${levels.slice(1).join('s, ')}s per turn.`;
}

function syncSettingsUI() {
  $('feedbackMode').value = cfg.feedback;
  $('feedbackModeF').value = freeCfg.feedback;
  $('adaptMode').value = tune.adapt;
  $('startInterval').value = tune.startInterval / 1000;
  $('targetInterval').value = tune.targetInterval / 1000;
  $('intervalStep').value = tune.intervalStep / 1000;
  $('spinStart').value = tune.spinStart;
  $('spinEnd').value = tune.spinEnd;
  $('spinStep').value = tune.spinStep;
  $('nMax').value = tune.nMax;
  $('nAfterStimulus').value = tune.nAfterStimulus;
  $('blockLengthP').value = tune.blockLength;

  $('nValue').value = freeCfg.n;
  $('intervalMs').value = freeCfg.interval;
  $('blockLengthF').value = freeCfg.blockLength;
  $('cubeDimension').value = freeCfg.dim;
  $('letterVoice').value = cfg.letterVoice;
  $('letterVoiceHint').textContent = cfg.letterVoice === 'mix'
    ? 'A new speaker every trial. The letter is still the whole question, so the voice '
      + 'becomes noise you have to hear past — the setting that stops the sound being '
      + 'memorised as a sound.'
    : 'Reads the eight letters for the Spoken letter stream.';
  $('voiceSet').value = cfg.voiceSet;
  $('voiceSetHint').textContent = cfg.voiceSet === 'vowels'
    ? 'Vowel colours — the most separable set. The resonances track the note rather '
      + 'than sitting at fixed frequencies, so the brightness order holds at every '
      + 'pitch and the vowels stay out of the pitch channel.'
    : cfg.voiceSet === 'reeds'
    ? 'Harmonic profiles rather than raw waveforms — more separable than the plain '
      + 'oscillators, and each sounds the same at every pitch, so timbre and pitch '
      + 'stay independent.'
    : 'The four raw oscillator shapes. Cleanest separation from the pitch stream, '
      + 'least separation from each other.';
  $('spinPath').value = cfg.spinPath;
  $('spinPathHint').textContent = cfg.spinPath === 'free'
    ? 'Sweeps the tilt as well as the turn, so four times a revolution the view looks '
      + 'straight down a cube axis and a whole column of slots lands on one point. '
      + 'Fuller motion; the active slot is briefly unreadable.'
    : 'Turntable at a solved tilt plus an in-plane roll. No two slots ever coincide, '
      + 'and every axis still sweeps every screen direction. Costs the exploded '
      + 'layout about half its slot size, since cells must fit the tightest moment.';
  $('rotationOn').checked = freeCfg.rotation;
  $('rotationSpeed').value = freeCfg.spin;
  $('frameMode').value = freeCfg.frame;
  $('varPriority').checked = !!freeCfg.varPriority;
  $('fixedGlyphMap').checked = !!freeCfg.fixedGlyphMap;
  $('metaOn').checked = !!freeCfg.meta;
  $('gateOn').value = String(freeCfg.gate || 0);
  $('retroOn').value = String(freeCfg.retro || 0);
  $('retroOn').disabled = !!freeCfg.meta;
  $('varNBack').value = String(freeCfg.varN || 0);
  /* Shown as unavailable rather than silently ignored: applyFree already forces the
     spread to zero under a retro-cue, and a control that keeps its setting while
     doing nothing is worse than one that says so. */
  $('varNBack').disabled = cfg.retro > 0;
  $('testerLabel').value = progress.tester || '';
  $('lureRateF').value = Math.round(freeCfg.lureRate * 100);
  $('lureVal').textContent = Math.round(freeCfg.lureRate * 100);
  $('gizmoMode').value = cfg.gizmo;
  $('cellVis').value = cfg.cellVis;
  $('cubeLayout').value = cfg.layout;
  $('layoutHint').textContent = LAYOUT_HINT[cfg.layout] || '';
  $('dailyGoal').value = cfg.dailyGoal || 0;
  $('buzzer').checked = !!cfg.buzzer;
  $('moveTraceOn').checked = !!cfg.moveTrace;
  $('cubeSize').value = Math.round((cfg.cubeScale || 1) * 100);
  $('cubeSizeVal').textContent = Math.round((cfg.cubeScale || 1) * 100);
  document.documentElement.style.setProperty('--cube-scale', cfg.cubeScale || 1);
  applyCellVis();

  renderStreamRows();
  renderLadderState();
  renderKeybinds();
  renderShortcuts();
}

function onConfigChanged(rebuildCube) {
  if (rebuildCube) buildCube(cfg.dim);
  applyRotation();
  applyGizmoMode();
  buildDeck();
  primeLetters();
  renderGlyphLegend();
  renderKeybinds();   // live/dormant state changes with the active streams
  renderShortcuts();  // and with them, which shortcut keys the deck is shadowing
  updateHUD();        // single place, so the readout can never drift from cfg
}

function renderDataPanel() {
  $('minutesToday').textContent = Math.floor(progress.dailyMinutes[today()] || 0);
  $('bestLoad').textContent = progress.bestLoad || 0;
  const st = $('dataStatus');
  if (!st) return;
  const n = progress.blocks.length;
  const days = Object.keys(progress.dailyMinutes || {}).length;
  st.innerHTML = `Build <b>${BUILD}</b> · ${n} block${n === 1 ? '' : 's'} recorded` +
    ` over ${days} day${days === 1 ? '' : 's'}` +
    (progress.saveWarning ? `<br><span style="color:#ff6b6b">${progress.saveWarning}</span>` : '');
}

function renderProfileUI() {
  const sel = $('profileSel');
  if (!sel) return;
  sel.innerHTML = '';
  profiles.list.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    sel.appendChild(o);
  });
  sel.value = profiles.active;
  $('profileDelete').disabled = profiles.list.length < 2;
  $('profileHint').innerHTML =
    `${profiles.list.length} profile${profiles.list.length === 1 ? '' : 's'} on this ` +
    `device. Each keeps its own ladder, staircase, keybinds and history. ` +
    `<span style="opacity:.7">Appearance is shared.</span>`;
}

/* ---- export / import ---- */

function exportPayload() {
  return JSON.stringify({
    build: BUILD,
    tester: progress.tester || '',
    profile: activeProfile().name,
    exportedAt: new Date().toISOString(),
    timezoneOffsetMin: new Date().getTimezoneOffset(),
    data: progress,
  }, null, 1);
}

function downloadJSON() {
  const label = (progress.tester || activeProfile().name || 'tester').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const name = `rnb-${label}-${today()}.json`;
  const blob = new Blob([exportPayload()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

function importJSON(text) {
  const parsed = JSON.parse(text);
  const data = parsed && parsed.data ? parsed.data : parsed;
  if (!data || !Array.isArray(data.blocks)) throw new Error('not a Relational N-Back export');
  progress = data;
  if (progress.prog) Object.assign(prog, progress.prog);
  if (progress.tune) Object.assign(tune, progress.tune);
  if (progress.freeCfg) Object.assign(freeCfg, progress.freeCfg);
  if (progress.keyBinds) keyBinds = progress.keyBinds;
  if (progress.actionBinds) actionBinds = progress.actionBinds;
  if (Array.isArray(progress.stair) && progress.stair.length === STAIR.steps)
    stairLog = progress.stair.slice();
  if (progress.display) {
    cfg.gizmo = progress.display.gizmo || cfg.gizmo;
    cfg.cellVis = progress.display.cellVis || cfg.cellVis;
    cfg.spinPath = progress.display.spinPath || cfg.spinPath;
    cfg.voiceSet = progress.display.voiceSet || cfg.voiceSet;
  }
  setMode(progress.mode || 'progression');
  renderDataPanel();
  return progress.blocks.length;
}

