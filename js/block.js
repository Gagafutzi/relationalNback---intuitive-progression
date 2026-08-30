"use strict";

/* ============================================================
   11. BLOCK LOOP
   ============================================================ */

const RETRO_LABEL = k => k === 0 ? 'now ← 1' : `${k} ← ${k + 1}`;

function showRetroCue(k) {
  $('retroPair').textContent = RETRO_LABEL(k);
  $('retroCue').classList.add('show');
}

function tick() {
  clearTimeout(state.cueTimer);
  clearTimeout(state.buzzTimer);
  $('retroCue').classList.remove('show');
  /* When the stimulus swapped — the origin the grace window is measured from. */
  state.tickAt = performance.now();

  if (state.judgments.length) {
    scoreInterval();
    /* Once per interval, not once per missed judgment — three misses on one trial
       would otherwise stack three overlapping buzzes. Held until the grace window
       shuts, so a press that lands a few tens of ms late is not scolded for a miss
       it is about to fix. */
    const snap = state.lastSnap;
    state.buzzTimer = setTimeout(() => {
      if (snapMissed(snap)) playBuzz('miss');
    }, graceMs());
    revealAnswers();
  }
  if (state.scored >= cfg.blockLength) { endBlock(); return; }

  const t = sampleTrial();
  renderTrial(t);
  state.history.push(t);
  state.currentTrial = t;
  state.trial++;

  const C = state.chain;
  let pair = null;

  if (cfg.retro > 0) {
    /* Post-cue names WHICH adjacent pair to report, chosen now but revealed only
       after the stimulus clears — so every recent item must be held, not just the
       one the n-back rule would have picked. */
    const S = C.concat([t]);
    const maxK = Math.min(cfg.retro - 1, S.length - 2);
    if (maxK >= 0) {
      t.retroK = randInt(maxK + 1);
      pair = [S[S.length - t.retroK - 2], S[S.length - t.retroK - 1]];
    }
  } else {
    /* t.n, not cfg.n: sampleTrial already committed to a lag and built the stimulus
       around it. Reading cfg.n back here would score the answer against a different
       item than the one the target was planted at. */
    const partner = C[C.length - t.n];
    if (partner) pair = [partner, t];
  }

  /* Meta compares this move against the move the PARTNER made — not the move made
     on the previous trial. At n≥2 those differ, and using the latter would score a
     completely different question than the one being asked. */
  const extra = pair && cfg.meta ? { metaPrev: pair[0].pair } : null;
  state.judgments = pair ? buildJudgments(pair[0], pair[1], extra) : [];
  t.pair = pair;

  state.presses.clear();

  if (cfg.retro > 0 && pair) {
    state.cued = false;
    /* Show the stimulus long enough to encode, but always leave a real response
       window after the cue — otherwise a short interval makes the trial literally
       unanswerable, since presses are locked until the cue appears. */
    const delay = Math.max(300, Math.min(cfg.interval * 0.45, cfg.interval - RETRO_MIN_RESPONSE));
    state.cueTimer = setTimeout(() => {
      clearCells();
      showRetroCue(t.retroK);
      state.cued = true;
      /* RT is measured from the CUE on these trials — that is when the response
         window actually opens, so timing from the stimulus would measure the delay. */
      state.stimAt = performance.now();
    }, delay);
  } else {
    state.cued = true;
    state.stimAt = performance.now();
  }

  if (t.gate !== 'compare') C.push(t);
  updateHUD();
}

function startBlock() {
  stopBlock(true);
  if (audioCtx.state === 'suspended') audioCtx.resume();

  state.history = []; state.chain = []; state.judgments = []; state.presses.clear();
  state.trial = 0; state.scored = 0; state.tally = {};
  state.lureTally = null; state.currentTrial = null; state.cued = true;
  state.presses_log = []; state.stimAt = 0;
  state.tickAt = 0; state.lastSnap = null; clearTimeout(state.buzzTimer);
  state.paused = false; state.interrupted = false;
  $('pauseVeil').classList.remove('show');

  /* Rotate the cued stream rather than picking at random, so every stream actually
     gets its turn — random selection leaves streams uncued for long stretches. */
  const active = STREAM_KEYS.filter(k => cfg.streams[k] && cfg.streams[k] !== 'off');
  if (cfg.varPriority && active.length >= 2) {
    progress.priorityCursor = ((progress.priorityCursor || 0) + 1) % active.length;
    state.priorityStream = active[progress.priorityCursor];
  } else {
    state.priorityStream = null;
  }
  renderPriorityCue();
  renderDailyTimer();
  clearTimeout(state.cueTimer);
  $('retroCue').classList.remove('show');
  state.sessionStart = Date.now();
  state.running = true;

  if (cfg.streams.glyph === 'relational' && !state.glyphMap) ensureGlyphMap();

  updateHUD();
  tick();
  state.timer = setInterval(tick, cfg.interval);
}

function stopBlock(silent) {
  clearInterval(state.timer);
  clearTimeout(state.cueTimer);
  clearTimeout(state.buzzTimer);
  state.lastSnap = null; state.tickAt = 0;
  state.timer = null;
  state.running = false;
  document.body.classList.remove('running');
  state.cued = true;
  $('retroCue').classList.remove('show');
  $('pauseVeil').classList.remove('show');
  state.paused = false;
  clearCells();
  hideLagCue();
  if (state.sessionStart) {
    addMinutes(Date.now() - state.sessionStart);
    state.sessionStart = null;
  }
  if (!silent) { state.judgments = []; updateHUD(); }
}

function endBlock() {
  const score = blockScore();
  const load = computeLoad();
  stopBlock(true);

  let verdict = 'hold', headline = '', detail = '', milestone = null;

  /* ---- Interference axis, adapted independently of speed ----
     Ratchet rather than a second staircase: two staircases both targeting 80% on the
     same block would double-count the same improvement and overshoot. Scoring this
     on lure trials ONLY keeps the two axes reading different evidence. */
  const ls = lureScore();
  let lureNote = '';
  if (cfg.mode === 'progression' && ls != null) {
    const before = prog.lureRate;
    if (ls >= 0.80) prog.lureRate = Math.min(LURE_MAX, prog.lureRate + 0.05);
    else if (ls <= 0.55) prog.lureRate = Math.max(LURE_MIN, prog.lureRate - 0.05);
    if (prog.lureRate !== before)
      lureNote = `Lure rate ${prog.lureRate > before ? '↑' : '↓'} ` +
                 `${Math.round(prog.lureRate * 100)}% (resisted ${Math.round(ls * 100)}%)`;
  }

  if (cfg.mode === 'progression' && tune.adapt === 'bayes') {
    /* ---- Bayesian staircase ---- */
    const n = state.scored, k = Math.round(pooledRate() * n);
    stairObserve(Math.log10(cfg.interval), k, n);

    const conf = stairMassBelow(tune.targetInterval);
    const est = stairThresholdMs(), ci = stairCI(0.9);
    const fmt = ms => (ms / 1000).toFixed(2) + 's';

    if (stairCleared(tune.targetInterval)) {
      verdict = 'up';
      const kind = carryKind(prog);
      milestone = describeNext(prog);
      if (!advanceLadder(prog)) {
        milestone = null; headline = 'Ladder complete';
        detail = 'Switch to Free Play to keep pushing.';
      } else {
        stairCarry(kind);
        prog.interval = stairNextInterval();
      }
    } else if (est > tune.maxInterval) {
      /* Estimated threshold has fallen off the slow end — step back a milestone. */
      verdict = 'down';
      regressLadder(prog);
      stairCarry(carryKind(prog), true);
      prog.interval = stairNextInterval();
      headline = 'Stepped back a milestone';
      detail = `Your threshold is estimated at ${fmt(est)}, past the slowest interval.`;
    } else {
      prog.interval = stairNextInterval();
      verdict = score >= ADVANCE_AT ? 'up' : score <= DEMOTE_AT ? 'down' : 'hold';
      headline = `Next block at ${fmt(prog.interval)}`;
      detail = `Threshold estimate <b>${fmt(est)}</b> ` +
               `<span style="opacity:.6">(90% CI ${fmt(ci[0])}–${fmt(ci[1])})</span> · ` +
               `<b>${Math.round(conf * 100)}%</b> confident it's under ` +
               `${fmt(tune.targetInterval)} — need ${Math.round(STAIR.clearAt * 100)}%.`;
    }
    applyProgression();
  } else if (cfg.mode === 'progression') {
    if (score >= ADVANCE_AT) {
      verdict = 'up';
      if (prog.interval <= tune.targetInterval + 1e-6) {
        /* Already at target speed and just held it — the milestone is proven, so
           carry into the next digit. (Carrying on the step that merely *reaches*
           the target would mean never actually playing a block at it.) */
        const nx = describeNext(prog);
        milestone = nx;
        if (!advanceLadder(prog)) { prog.interval = tune.targetInterval; milestone = null;
          headline = 'Ladder complete'; detail = 'Switch to Free Play to keep pushing.'; }
      } else {
        prog.interval = Math.max(tune.targetInterval, prog.interval - tune.intervalStep);
        headline = `Faster — ${(prog.interval / 1000).toFixed(2)}s per stimulus`;
        const left = Math.ceil((prog.interval - tune.targetInterval) / tune.intervalStep);
        detail = left > 0
          ? `${left} more step${left > 1 ? 's' : ''}, then hold ${(tune.targetInterval / 1000).toFixed(2)}s to clear this milestone.`
          : `Hold ${(tune.targetInterval / 1000).toFixed(2)}s for one block to clear this milestone.`;
      }
    } else if (score <= DEMOTE_AT) {
      verdict = 'down';
      prog.interval += tune.intervalStep;
      if (prog.interval > tune.maxInterval) {
        regressLadder(prog);
        headline = 'Stepped back a milestone';
        detail = 'You were at the slowest interval and still under 70%.';
      } else {
        headline = `Slower — ${(prog.interval / 1000).toFixed(2)}s per stimulus`;
        detail = 'Interval eased off. Same milestone.';
      }
    } else {
      headline = `Holding at ${(prog.interval / 1000).toFixed(2)}s`;
      detail = `Score ${Math.round(ADVANCE_AT * 100)}% or better speeds you up.`;
    }
    applyProgression();
  } else {
    /* Free Play adapts N the classic way and leaves everything else alone. */
    if (score >= ADVANCE_AT) { freeCfg.n = Math.min(9, freeCfg.n + 1); verdict = 'up';
      headline = `N rises to ${freeCfg.n}`; }
    else if (score <= DEMOTE_AT) { freeCfg.n = Math.max(1, freeCfg.n - 1); verdict = 'down';
      headline = `N falls to ${freeCfg.n}`; }
    else headline = `N holds at ${freeCfg.n}`;
    cfg.n = freeCfg.n;
    $('nValue').value = freeCfg.n;
  }

  if (score >= ADVANCE_AT) progress.bestLoad = Math.max(progress.bestLoad || 0, load);
  const rts = state.presses_log.map(p => p.rt).filter(r => r != null).sort((a, b) => a - b);
  const median = rts.length ? rts[rts.length >> 1] : null;

  progress.blocks.push({
    ts: Date.now(), build: BUILD, mode: cfg.mode, n: cfg.n, load, score,
    rc: relationalComplexity(), rcTier,
    interrupted: !!state.interrupted,
    priority: state.priorityStream,
    lureScore: ls, lureTrials: state.lureTally ? state.lureTally.total : 0,
    ladder: cfg.mode === 'progression' ? { ...prog } : null,
    /* Full config snapshot: a score is meaningless without knowing what produced it,
       and settings drift between blocks. */
    cfg: {
      streams: { ...cfg.streams }, dim: cfg.dim, frame: cfg.frame,
      interval: cfg.interval, blockLength: cfg.blockLength, rotation: cfg.rotation,
      spin: cfg.spin, feedback: cfg.feedback, lureRate: cfg.lureRate,
      meta: cfg.meta, gate: cfg.gate, retro: cfg.retro, varN: cfg.varN,
      cellVis: cfg.cellVis,
      gizmo: cfg.gizmo,
      /* Layout belongs here, not with the cosmetics: flat panels remove the depth
         ambiguity entirely, so the same score means something different. */
      layout: cfg.layout, cubeScale: cfg.cubeScale,
    },
    streams: Object.fromEntries(Object.entries(state.tally)
      .map(([k, t]) => [k, { score: streamScore(t), raw: rawAcc(t), chance: chanceOf(t),
                             hit:t.hit, miss:t.miss, fa:t.fa, cr:t.cr }])),
    rt: { n: rts.length, median, mean: rts.length
            ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : null },
    presses: state.presses_log,
  });
  saveProgress();

  if (lureNote) detail += (detail ? '<br>' : '') +
    `<span style="color:#ff922b">${lureNote}</span>`;
  showReport(score, verdict, headline, detail, milestone, load);
  syncSettingsUI();
  updateHUD();
}

/* ============================================================
   12. LOAD SCORE
   ============================================================ */

function computeLoad() {
  let load = 10 * cfg.n;
  /* A varying lag costs more than its mean depth: the pairing cannot be maintained
     as a rehearsal loop, so the whole recent window has to stay addressable and the
     cue has to be read and applied inside the interval. Scaled with N because the
     span is what has to stay open, and a ±1 around 4 is a wider window than ±1
     around 2. */
  if (cfg.varN) load += 6 * cfg.varN + 2 * cfg.varN * cfg.n;
  STREAM_KEYS.forEach(k => {
    if (cfg.streams[k] === 'identity') load += 4;
    else if (cfg.streams[k] === 'relational') load += 9;
  });
  if (cfg.dim === 4) load += 12;
  /* Capped: unbounded, this term dwarfs every other axis and lets Free Play inflate
     Load with a silly interval instead of actual difficulty. */
  load += Math.min(30, Math.max(0, 12 * (2500 / cfg.interval - 1)));
  if (cfg.rotation) load += 6 + 600 / cfg.spin;
  if (cfg.frame === 'screen') load += 20;
  if (cfg.frame === 'both') load += 34;
  return Math.round(load);
}

/* ============================================================
   13. APPLYING THE LADDER
   ============================================================ */

function applyProgression() {
  const levels = spinLevels();
  prog.spinLevel = Math.min(prog.spinLevel, levels.length - 1);
  prog.streamCount = Math.min(prog.streamCount, PROG_STREAMS.length);
  prog.n = Math.max(1, prog.n);
  prog.lureRate = Math.min(LURE_MAX, Math.max(LURE_MIN, prog.lureRate ?? 0.20));
  /* The staircase is allowed to place below the target — a player who is already
     past it should not be held back while the posterior catches up. */
  const floor = tune.adapt === 'bayes'
    ? Math.max(600, tune.targetInterval * 0.75) : tune.targetInterval;
  prog.interval = Math.min(Math.max(prog.interval, floor), tune.maxInterval);

  cfg.streams = {};
  STREAM_KEYS.forEach(k => cfg.streams[k] = 'off');
  PROG_STREAMS.slice(0, prog.streamCount).forEach(s => cfg.streams[s.key] = s.mode);

  cfg.n = prog.n;
  cfg.interval = prog.interval;
  cfg.lureRate = prog.lureRate;
  cfg.meta = rcTier >= 4;          // the tier IS the relational-complexity level
  cfg.gate = 0; cfg.retro = 0; cfg.varN = 0;   // Free Play only, for now
  cfg.varPriority = true;
  cfg.dim = 3;
  cfg.frame = 'cube';
  cfg.rotation = prog.spinLevel > 0;
  cfg.spin = prog.spinLevel > 0 ? levels[prog.spinLevel] : 60;
  cfg.blockLength = tune.blockLength;

  if (cfg.streams.glyph === 'relational' && !state.glyphMap) ensureGlyphMap();
  onConfigChanged();
}

function applyFree() {
  cfg.streams = { ...freeCfg.streams };
  cfg.n = freeCfg.n;
  cfg.interval = freeCfg.interval;
  cfg.dim = freeCfg.dim;
  cfg.frame = freeCfg.frame;
  cfg.rotation = freeCfg.rotation;
  cfg.spin = freeCfg.spin;
  cfg.blockLength = freeCfg.blockLength;
  cfg.feedback = freeCfg.feedback;
  cfg.lureRate = freeCfg.lureRate;
  cfg.varPriority = !!freeCfg.varPriority;
  cfg.meta = !!freeCfg.meta;
  cfg.gate = freeCfg.gate;
  /* Meta and retro-cue ask incompatible questions of the same trial — meta needs a
     fixed n-back pairing to have a "previous move" at all. */
  cfg.retro = cfg.meta ? 0 : freeCfg.retro;
  /* A retro trial is told which pair to report, so it has already replaced the
     n-back rule — there is no lag left for a variable one to vary. */
  cfg.varN = cfg.retro > 0 ? 0 : freeCfg.varN;
  /* A retro trial spends its first stretch showing the stimulus and locks responses
     until the cue, so it needs a floor the plain task doesn't. */
  if (cfg.retro > 0) cfg.interval = Math.max(RETRO_MIN_INTERVAL, cfg.interval);
  onConfigChanged(true);
}

function setMode(mode) {
  if (state.running) stopBlock(true);
  cfg.mode = mode;
  $('modeProgression').classList.toggle('on', mode === 'progression');
  $('modeFree').classList.toggle('on', mode === 'free');
  $('progressionPane').style.display = mode === 'progression' ? '' : 'none';
  $('freePane').style.display = mode === 'free' ? '' : 'none';
  $('modeHint').textContent = mode === 'progression'
    ? 'One ladder, driven by your accuracy. Speed adapts every block; clearing the target speed unlocks the next difficulty.'
    : 'Everything unlocked and manual. N still adapts each block; Load scores the setup.';
  if (mode === 'progression') applyProgression(); else applyFree();
  buildCube(cfg.dim);
  syncSettingsUI();
  updateHUD();
  saveProgress();
}

