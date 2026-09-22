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
      if (!snapMissed(snap)) return;
      signalWrong('miss');
      /* A meta target nobody answered leaves you exactly as lost as a wrong press
         does, so it earns the same trace. Held until the grace window shuts along
         with the buzz — a press landing a few tens of ms late is about to turn this
         into a non-miss. */
      if (cfg.moveTrace && cfg.feedback !== 'off' &&
          snap.judgments.some(j => j.correct.some(o => META_CHANNEL_IDS.has(o))))
        traceMove(snap.trial_);
    }, graceMs());
    revealAnswers();
  }
  if (state.scored >= cfg.blockLength) { endBlock(); return; }

  const t = sampleTrial();
  renderTrial(t);
  state.history.push(t);
  state.currentTrial = t;
  state.trial++;
  /* Counted in trials rather than milliseconds so the trace lasts the same amount of
     TASK however fast the interval is set. */
  if (state.traceUntil != null && state.trial > state.traceUntil) hideMoveArrow();

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
  state.metaDrawn = null;
  state.presses_log = []; state.stimAt = 0;
  state.tickAt = 0; state.lastSnap = null; clearTimeout(state.buzzTimer);
  state.paused = false; state.interrupted = false; state.ending = false;
  hideMoveArrow();
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
  state.activeMs = 0;
  state.running = true;

  if (cfg.streams.glyph === 'relational' && !state.glyphMap) ensureGlyphMap();

  keepAwake();
  updateHUD();
  tick();
  state.timer = setInterval(tick, cfg.interval);
}

function stopBlock(silent) {
  /* Whatever was on the board goes into the record before it is torn down.
     `state.ending` is how a finished block gets past here without being written
     twice: `endBlock` sets it, scores the block, calls this to clean up, and
     writes its own record afterwards. */
  if (state.running && !state.ending) recordAbandoned();

  letSleep();
  clearInterval(state.timer);
  clearTimeout(state.cueTimer);
  clearTimeout(state.buzzTimer);
  state.lastSnap = null; state.tickAt = 0;
  state.timer = null;
  state.running = false;
  document.body.classList.remove('running');
  state.cued = true;
  cancelAutoAdvance();
  $('retroCue').classList.remove('show');
  $('pauseVeil').classList.remove('show');
  state.paused = false;
  clearCells();
  hideLagCue();
  hideMoveArrow();
  /*
   * Active time, not elapsed time.
   *
   * This used to bank `Date.now() - sessionStart`, which is the whole wall
   * clock from the first trial to the last — every pause inside it included.
   * The HUD already knew better and froze its readout while paused, so the
   * screen and the record disagreed and the record was the wrong one: pause
   * for ten minutes and the display would not move, then the block would end
   * and those ten minutes would land in the daily total anyway.
   *
   * It matters more than a tidy number, because `visibilitychange` pauses the
   * block. Switching tabs mid-block and coming back an hour later banked the
   * hour.
   */
  if (state.sessionStart || state.activeMs) {
    addMinutes(state.activeMs + (state.sessionStart ? Date.now() - state.sessionStart : 0));
    state.sessionStart = null;
    state.activeMs = 0;
  }
  if (!silent) { state.judgments = []; updateHUD(); }
}

/**
 * One block as it goes into the record, finished or not.
 *
 * Extracted so an abandoned block is recorded by the same code as a completed
 * one. A second copy of this object literal would be a second thing to keep in
 * step with `cfg`, and the half that got forgotten would be the half nobody
 * looks at until they need it.
 *
 * `completed` is the field that keeps them apart. Everything written before it
 * existed was a finished block by definition — nothing else was ever recorded —
 * so a record without the field reads as completed.
 */
function blockRecord(completed, scored) {
  const rts = state.presses_log.map(p => p.rt).filter(r => r != null).sort((a, b) => a - b);
  const median = rts.length ? rts[rts.length >> 1] : null;

  return {
    ts: Date.now(), build: BUILD, mode: cfg.mode, n: cfg.n,
    load: scored.load, score: scored.score,
    completed: !!completed,
    /* How far it got, against how far it was meant to. Meaningless on a
       finished block and the whole of the story on an abandoned one. */
    trials: state.trial || 0,
    plannedTrials: cfg.blockLength,
    rc: relationalComplexity(), rcTier,
    interrupted: !!state.interrupted,
    priority: state.priorityStream,
    lureScore: scored.lureScore,
    lureTrials: state.lureTally ? state.lureTally.total : 0,
    ladder: cfg.mode === 'progression' ? { ...prog } : null,
    /* Full config snapshot: a score is meaningless without knowing what produced it,
       and settings drift between blocks. */
    cfg: {
      streams: { ...cfg.streams }, dim: cfg.dim, frame: cfg.frame,
      interval: cfg.interval, blockLength: cfg.blockLength, rotation: cfg.rotation,
      spin: cfg.spin, feedback: cfg.feedback, lureRate: cfg.lureRate,
      meta: cfg.meta, gate: cfg.gate, retro: cfg.retro, varN: cfg.varN,
      /* How finely the tones were cut. Four notes an octave apart and twelve a
         minor third apart are not the same stream, and the difference is
         invisible in the settings snapshot without this. */
      toneCount: toneCount(cfg),
      /* An assist, so a score earned with it on is not the same score. */
      moveTrace: !!cfg.moveTrace,
      cellVis: cfg.cellVis,
      /* Both are assists on the same judgement as `moveTrace`: an outline draws
         the slot without six coloured surfaces, and a readout hands you the
         coordinates a dense projection makes you work out. A score earned with
         either is not the same score. */
      cellFill: cfg.cellFill,
      slotReadout: cfg.slotReadout,
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
    /* The posterior AFTER this block's observation — endBlock updates the staircase
       before it builds the record. Stored because the posterior is a single evolving
       distribution, not a series: without a stamp per block there is no way to
       recover what it believed at the time, short of replaying the entire ladder and
       hoping the replay does not diverge. The interval each block was played at is a
       good proxy and always available, but only this carries the uncertainty. */
    ...(cfg.mode === 'progression' && tune.adapt === 'bayes' && stairLog
        ? (() => { const ci = stairCI(0.9);
                   return { thr: Math.round(stairThresholdMs()),
                            thrLo: Math.round(ci[0]), thrHi: Math.round(ci[1]) }; })()
        : {}),
    presses: state.presses_log,
  };
}

/**
 * A block that was stopped rather than finished.
 *
 * Until now, stopping mid-block left nothing behind but the minutes: the trials
 * you answered, the presses, the streams, all discarded because the block never
 * reached `endBlock`. Two hundred trials of an evening spent on hard blocks you
 * abandoned looked identical to an evening you did not train.
 *
 * **It is recorded and never scored.** `endBlock` is what moves the ladder, and
 * a partial block must not: its score is over however many trials you happened
 * to do, which is not the quantity the staircase targets, and letting a
 * two-trial block push the interval around would make quitting a way to steer
 * the progression. So this writes the record and touches nothing else — no
 * `applyProgression`, no `bestLoad`, no promotion.
 */
function recordAbandoned() {
  if (!state.trial) return;                 // nothing happened; nothing to keep
  progress.blocks.push(blockRecord(false, {
    load: computeLoad(), score: blockScore(), lureScore: lureScore(),
  }));
  saveProgress();
}

function endBlock() {
  state.ending = true;
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

  /* ---- Tone precision, adapted on the tone stream's own evidence ---- */
  const toneNote = cfg.mode === 'progression' ? toneRatchet() : '';

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
      /*
       * The colour says what the staircase did, not what a second measure would
       * have said about it.
       *
       * This compared `score` — the weakest-link blend — against the same band
       * the fixed-step mode steps on, while the interval was being placed by the
       * posterior from `pooledRate`. Those are two different numbers: the blend
       * carries a 0.4 * min term, so it sits further below the pooled rate the
       * more streams are running, and the label drifted from the decision it was
       * labelling. Reading the interval before and after is the decision itself.
       */
      const was = prog.interval;
      prog.interval = stairNextInterval();
      verdict = prog.interval < was ? 'up' : prog.interval > was ? 'down' : 'hold';
      headline = `Next block at ${fmt(prog.interval)}`;
      detail = `Threshold estimate <b>${fmt(est)}</b> ` +
               `<span style="opacity:.6">(90% CI ${fmt(ci[0])}–${fmt(ci[1])})</span> · ` +
               `<b>${Math.round(conf * 100)}%</b> confident it's under ` +
               `${fmt(tune.targetInterval)} — need ${Math.round(STAIR.clearAt * 100)}%.`;
    }
    applyProgression();
  } else if (cfg.mode === 'progression') {
    if (score >= advanceAt()) {
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
    } else if (score <= demoteAt()) {
      verdict = 'down';
      prog.interval += tune.intervalStep;
      if (prog.interval > tune.maxInterval) {
        regressLadder(prog);
        headline = 'Stepped back a milestone';
        detail = `You were at the slowest interval and still under ${Math.round(demoteAt() * 100)}%.`;
      } else {
        headline = `Slower — ${(prog.interval / 1000).toFixed(2)}s per stimulus`;
        detail = 'Interval eased off. Same milestone.';
      }
    } else {
      headline = `Holding at ${(prog.interval / 1000).toFixed(2)}s`;
      detail = `Score ${Math.round(advanceAt() * 100)}% or better speeds you up.`;
    }
    applyProgression();
  } else {
    /* Free Play changes nothing. Adapting N here moved a setting the player had
       chosen and then had to put back by hand every block — the mode whose whole
       point is that the task stays exactly as you set it. Progression is where the
       task is allowed to adapt; here the report only says how the block went. */
    headline = `N stays at ${cfg.n}`;
    detail = 'Free Play leaves your settings alone — change them in Settings.';
  }

  if (score >= advanceAt()) progress.bestLoad = Math.max(progress.bestLoad || 0, load);
  const rts = state.presses_log.map(p => p.rt).filter(r => r != null).sort((a, b) => a - b);
  const median = rts.length ? rts[rts.length >> 1] : null;

  progress.blocks.push(blockRecord(true, { load, score, lureScore: ls }));
  state.ending = false;
  saveProgress();

  if (lureNote) detail += (detail ? '<br>' : '') +
    `<span style="color:#ff922b">${lureNote}</span>`;
  if (toneNote) detail += (detail ? '<br>' : '') +
    `<span style="color:#7ee0d0">${toneNote}</span>`;
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
  /*
   * A finer tone pool, on the stream that has to place it. Every note added
   * narrows the step, so both questions the stream can ask get harder: "the same
   * note" has more neighbours to be confused with, and "higher or lower" is a
   * smaller interval to hear. Charged from the starting pool rather than from
   * zero — four notes is the task as it ships, not a bonus.
   */
  if (cfg.streams.pitch && cfg.streams.pitch !== 'off')
    load += 2 * (toneCount(cfg) - TONE_DEFAULT);
  /* Capped: unbounded, this term dwarfs every other axis and lets Free Play inflate
     Load with a silly interval instead of actual difficulty. */
  load += Math.min(30, Math.max(0, 12 * (2500 / cfg.interval - 1)));
  if (cfg.rotation) load += 6 + 600 / cfg.spin;

  /*
   * ---- Everything the position judgement is worth beyond its flat stream term ----
   *
   * The loop above pays 9 for "position, relational" and stopped there, so Load
   * was blind to the entire top half of the app: a ternary block and a quaternary
   * one scored the SAME number at the same settings, and four coordinate axes —
   * the most principled difficulty in here — moved it by nothing at all. Free
   * Play's whole promise is that Load scores the setup; it could not score the
   * part of the setup worth climbing.
   *
   * Frames are charged here rather than unconditionally, too. A reference frame
   * is a way of naming where the stimulus went, so it is worth nothing while
   * position is off or judged as identity — and it used to be charged anyway.
   */
  if (cfg.streams.position === 'relational') {
    /* A second frame asks the same event again in coordinates the first cannot
       supply. Charged per frame rather than as a flat "both", so the second one
       costs less than the first: the moves are the same moves. */
    if (cfg.frame === 'screen') load += 20;
    else if (cfg.frame === 'both') load += 34;

    if (cfg.meta) {
      /*
       * Second order. The first-order term buys reporting a move; this buys
       * binding it to another move that is no longer on screen — the step from
       * ternary to quaternary, and the one Halford's ceiling is measured in.
       */
      load += 14;
      /*
       * Quinary: the second binding, over the same event, in a frame the first
       * cannot be converted into. Only when the cube actually turns — angles are
       * rotation-invariant, so a still cube makes the screen answer a copy of the
       * cube answer and there is no second binding to pay for.
       */
      if (dualFrameLive(cfg)) load += 20;
    }

    /*
     * Coordinate axes. Each is an independent up/down/neither inside the position
     * judgement — a little under a relational stream, since it shares the bucket
     * and borrows the property's own two buttons.
     */
    const axes = coordAxes(cfg).length;
    if (axes) {
      load += 7 * axes;
      /* And worth more again under a second-order judgement, which is the case
         they exist for: there are as many mutually orthogonal directions as
         dimensions, so each one added is another way for two moves to be square
         — and another way for them to sit at no tidy angle at all. */
      if (cfg.meta) load += 3 * axes;
      /* The same axes, a step further apart: a longer move to place, on every
         one of them. */
      if (magnitudeCap(cfg) === 3) load += 2 * axes;
    }
  }
  return Math.round(load);
}

/* ============================================================
   12a. TONE PRECISION
   ============================================================ */

/*
 * Widen the tone pool when the tones are being read, narrow it when they are not.
 *
 * The request this answers is "start with four and add more as you progress",
 * and the honest reading of *progress* here is the tone stream's own accuracy
 * rather than the odometer: a player who is three milestones up because their
 * spatial memory is good has earned nothing on pitch, and a pool that grew for
 * them would be a difficulty they never cleared.
 *
 * So it is a ratchet on the tone stream's evidence alone, exactly as the lure
 * rate is a ratchet on lure trials alone — one axis, one source of evidence, and
 * neither of them touching the interval the staircase is placing. The band is
 * the ladder's own: clear what would speed you up and the pool gains a note;
 * fall to what would ease you off and it loses one.
 *
 * Never while the tones are a COORDINATE of the move: that pool is a short axis
 * with its own reasons to be short (see COORD_POOLS), the judgement lands in the
 * position bucket, and there is no tone score to read.
 */
/* Below this a block has not asked enough about the tones to move the pool.
   A full block with the tone stream on clears it easily; a block stopped after a
   few trials does not. */
const TONE_MIN_JUDGMENTS = 8;

function toneRatchet() {
  const mode = cfg.streams.pitch;
  if (!mode || mode === 'off') return '';
  const t = state.tally.pitch;
  /* A handful of judgments is noise, and this moves a setting that changes what
     every later block is about. */
  if (!t || t.total < TONE_MIN_JUDGMENTS) return '';

  const score = streamScore(t);
  const before = toneCount(cfg);
  let now = before;
  if (score >= advanceAt()) now = Math.min(TONE_MAX, before + 1);
  /* The floor is the starting pool rather than TONE_MIN: three notes exists so
     that a record written before the count was a setting restores onto the pool
     it was played with, not as somewhere a run can fall to. */
  else if (score <= demoteAt()) now = Math.max(TONE_DEFAULT, before - 1);
  if (now === before) return '';

  prog.tones = now;
  cfg.toneCount = now;
  const step = toneStepSemitones(now);
  return `Tones ${now > before ? '\u2191' : '\u2193'} ${now} notes ` +
         `(${step} semitone${step === 1 ? '' : 's'} apart) · ` +
         `scored ${Math.round(score * 100)}% on tone`;
}

/* ============================================================
   13. APPLYING THE LADDER
   ============================================================ */

/*
 * Which properties are coordinates of the move on a ladder run.
 *
 * Below quaternary this is the player's own choice, untouched — an axis there is
 * one more independent up/down/neither and nothing more, so there is nothing for
 * a ladder to grade. At quaternary and up the ladder owns it: axis count is a
 * digit on the odometer, and a rung has to mean the same thing for everyone
 * standing on it. The panel's boxes go read-only to match.
 */
function ladderCoordAxes(store) {
  if (!laddersAxes()) return (coordAxes(store) || []).slice();
  return PROG_AXES.slice(0, prog.axisCount || 0);
}

/* Same division: chosen below quaternary, the ladder's last digit above it. */
function ladderMagnitudeCap(store) {
  if (!laddersAxes()) return (store || progCfg).magnitudeCap === 3 ? 3 : 2;
  return prog.capLevel ? 3 : 2;
}

function applyProgression() {
  const levels = spinLevels();
  /* The floor is the tier's, not zero: quinary reads the cube against the screen,
     and with a still cube those are the same frame twice. */
  prog.spinLevel = Math.min(Math.max(prog.spinLevel, minSpinLevel()), levels.length - 1);
  prog.streamCount = Math.min(prog.streamCount, PROG_STREAMS.length);
  prog.axisCount = Math.min(Math.max(prog.axisCount || 0, 0), maxAxisCount());
  prog.capLevel = laddersAxes() && prog.capLevel ? 1 : 0;
  prog.n = Math.max(1, prog.n);
  prog.lureRate = Math.min(LURE_MAX, Math.max(LURE_MIN, prog.lureRate ?? 0.20));
  /* `toneCount` clamps and defaults in one place, so a ladder restored from a
     record that predates the digit starts where a fresh one does. */
  prog.tones = Math.max(TONE_DEFAULT, toneCount({ toneCount: prog.tones }));
  /* The staircase is allowed to place below the target — a player who is already
     past it should not be held back while the posterior catches up. */
  const floor = tune.adapt === 'bayes'
    ? Math.max(600, tune.targetInterval * 0.75) : tune.targetInterval;
  prog.interval = Math.min(Math.max(prog.interval, floor), tune.maxInterval);

  const streams = {};
  STREAM_KEYS.forEach(k => streams[k] = 'off');
  PROG_STREAMS.slice(0, prog.streamCount).forEach(s => streams[s.key] = s.mode);

  /* One assign of the whole task, from the same field list applyFree writes. Setting
     them line by line is how cfg.feedback came to be written by one mode and not the
     other: nothing about a missing line looks wrong until you are in the other mode
     wondering why your setting changed. */
  Object.assign(cfg, {
    streams,
    n: prog.n,
    interval: prog.interval,
    lureRate: prog.lureRate,
    feedback: progCfg.feedback,
    meta: rcTier >= 4,             // the tier IS the relational-complexity level
    /*
     * Quinary is the meta relation asked in both frames at once — see
     * `relationalComplexity`. Below it the cube frame alone, which is what every
     * ladder run has always used.
     */
    frame: rcTier >= 5 ? 'both' : 'cube',
    /* Free Play only. Each of these changes how hard the task is, and a ladder has to
       mean the same thing at every rung — a fixed symbol map in particular makes the
       glyph stream markedly easier, which is exactly why it is opt-in. */
    gate: 0, retro: 0, varN: 0, fixedGlyphMap: false,
    varPriority: true,
    /* Extra axes widen the space a move lives in without adding an answer, which
       is what makes quaternary at a high N carry more. Below quaternary that buys
       nothing a ladder can grade, so the boxes stay the player's; at quaternary it
       is the last thing left to climb, so the ladder takes them. */
    coordAxes: ladderCoordAxes(progCfg),
    magnitudeCap: ladderMagnitudeCap(progCfg),
    pitchLoudness: !!progCfg.pitchLoudness,
    /* Earned, not chosen — see `toneRatchet`. Clamped on the way out so a record
       written before the digit existed lands on the starting pool. */
    toneCount: prog.tones,
    dim: 3,
    rotation: prog.spinLevel > 0,
    spin: prog.spinLevel > 0 ? levels[prog.spinLevel] : 60,
    blockLength: tune.blockLength,
  });

  if (cfg.streams.glyph === 'relational' && !state.glyphMap) ensureGlyphMap();
  /*
   * Before `onConfigChanged`, not after — which is the order `applyFree` has
   * always had and this one has always had backwards.
   *
   * `onConfigChanged` builds the deck and repaints the HUD from `cfg.streams`, so
   * running it first built both from a configuration where a property was still a
   * coordinate AND a stream: a Tone button on the deck for a stream that was about
   * to be deleted, and a Load counting it. Harmless while nothing but a checkbox
   * could make a property an axis; the axis digit means the ladder does it now.
   */
  applyDimensions(cfg);
  onConfigChanged();
}

function applyFree() {
  const meta = !!freeCfg.meta;
  /* Meta and retro-cue ask incompatible questions of the same trial — meta needs a
     fixed n-back pairing to have a "previous move" at all. */
  const retro = meta ? 0 : freeCfg.retro;
  /* A retro trial is told which pair to report, so it has already replaced the
     n-back rule — there is no lag left for a variable one to vary. */
  const varN = retro > 0 ? 0 : freeCfg.varN;

  Object.assign(cfg, {
    streams: { ...freeCfg.streams },
    n: freeCfg.n,
    interval: freeCfg.interval,
    lureRate: freeCfg.lureRate,
    feedback: freeCfg.feedback,
    meta, gate: freeCfg.gate, retro, varN,
    fixedGlyphMap: !!freeCfg.fixedGlyphMap,
    varPriority: !!freeCfg.varPriority,
    dim: freeCfg.dim,
    coordAxes: (freeCfg.coordAxes || []).slice(),
    magnitudeCap: freeCfg.magnitudeCap === 3 ? 3 : 2,
    pitchLoudness: !!freeCfg.pitchLoudness,
    toneCount: toneCount(freeCfg),
    frame: freeCfg.frame,
    rotation: freeCfg.rotation,
    spin: freeCfg.spin,
    blockLength: freeCfg.blockLength,
  });
  /* Pitch is a coordinate or a stream, never both. */
  applyDimensions(cfg);
  restoreFixedGlyphMap();
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
    : 'Everything unlocked and manual. Nothing adapts — the task stays exactly as you set it; Load scores the setup.';
  if (mode === 'progression') applyProgression(); else applyFree();
  buildCube(cfg.dim);
  syncSettingsUI();
  updateHUD();
  saveProgress();
}

