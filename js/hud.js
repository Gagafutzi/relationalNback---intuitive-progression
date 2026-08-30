"use strict";

/* ============================================================
   14. HUD + REPORT
   ============================================================ */

function spinLabel() {
  if (!cfg.rotation) return 'still';
  return `${cfg.spin}s/turn`;
}

function updateHUD() {
  /* Lets the stylesheet strip non-essential chrome mid-block, which only matters on
     a phone where the HUD and the cube compete for the same pixels. */
  document.body.classList.toggle('running', state.running);
  const isProg = cfg.mode === 'progression';
  const pos = isProg ? ladderPosition() : null;

  $('hudMode').textContent = isProg
    ? `Milestone ${pos.index} / ${pos.total}`
    : 'Free Play';
  const rc = relationalComplexity();
  $('hudRC').textContent = 'RC ' + rc;
  $('hudRCName').textContent = RC_NAMES[rc] + (rc >= 4 ? ' · adult ceiling' : '');
  /* In variable mode the single number is a lie — what is fixed is the span the
     lag is drawn from, so that is what the HUD shows. */
  $('hudN').textContent = cfg.varN ? `${cfg.n}±${cfg.varN}` : cfg.n;
  $('hudSpinLabel').textContent = spinLabel();
  renderPriorityCue();
  $('hudTrial').textContent = `${state.scored}/${cfg.blockLength}`;
  $('hudLoad').textContent = computeLoad();
  $('hudAcc').textContent = Object.keys(state.tally).length
    ? Math.round(blockScore() * 100) + '%' : '—';

  if (isProg) {
    $('speedWrap').style.display = '';
    $('speedNow').textContent = (prog.interval / 1000).toFixed(2) + 's';
    let done;
    if (tune.adapt === 'bayes' && stairLog) {
      /* Progress is posterior confidence, not distance along a track — with a
         staircase the interval can move either way and still be progress. */
      const conf = stairMassBelow(tune.targetInterval);
      done = conf / STAIR.clearAt;
      $('speedGoal').textContent =
        `≈${(stairThresholdMs() / 1000).toFixed(2)}s · ${Math.round(conf * 100)}%`;
    } else {
      $('speedGoal').textContent = '→ ' + (tune.targetInterval / 1000).toFixed(2) + 's';
      const span = Math.max(1, tune.startInterval - tune.targetInterval);
      done = (tune.startInterval - prog.interval) / span;
    }
    $('hudProgress').style.width = Math.max(0, Math.min(1, done)) * 100 + '%';
    const nx = describeNext(prog);
    $('hudNext').innerHTML = `next: <b>${nx.what}</b>`;
  } else {
    $('speedWrap').style.display = 'none';
    $('hudNext').textContent = '';
  }
}

/* Banked minutes plus whatever the current block has accrued, so the readout moves
   while you play instead of jumping only when a block ends. */
function minutesToday() {
  const banked = progress.dailyMinutes[today()] || 0;
  const live = state.sessionStart && !state.paused
    ? (Date.now() - state.sessionStart) / 60000 : 0;
  return banked + live;
}

function renderDailyTimer() {
  const el = $('hudToday'), goalEl = $('hudGoal');
  if (!el) return;
  const m = minutesToday(), goal = cfg.dailyGoal || 0;
  el.textContent = m < 1 && m > 0 ? '<1m' : Math.floor(m) + 'm';
  const hit = goal > 0 && m >= goal;
  el.style.color = hit ? 'var(--good)' : '';
  goalEl.textContent = goal > 0 ? (hit ? '✓ goal' : `/ ${goal}m`) : '';
  goalEl.style.color = hit ? 'var(--good)' : '';
}

/* One second is plenty for a minutes display, and it keeps ticking between blocks. */
setInterval(renderDailyTimer, 1000);

const barColor = a => a >= 0.85 ? '#51cf66' : a >= 0.7 ? '#fcc419' : '#ff6b6b';

function showReport(score, verdict, headline, detail, milestone, load) {
  const rows = Object.entries(state.tally).map(([k, t]) => {
    const s = streamScore(t);
    return `<div class="bar-row">
      <span class="nm">${labelFor(k)}</span>
      <span class="track"><span class="fill" style="width:${(s*100).toFixed(0)}%;background:${barColor(s)}"></span></span>
      <span class="val">${Math.round(s*100)}%</span>
    </div>
    <div class="bar-detail">${t.hit} hit · ${t.miss} miss · ${t.fa} false alarm ·
      ${Math.round(rawAcc(t)*100)}% raw</div>`;
  }).join('');

  const mBanner = milestone ? `
    <div class="milestone-banner">
      <div class="t">★ Milestone cleared</div>
      <div class="s">Now: <b style="color:#e6ebff">${milestone.what}</b><br>${milestone.why}</div>
    </div>` : '';

  modalBox.innerHTML = `
    <h2>Block complete</h2>
    <p>Score <b style="color:${barColor(score)}">${Math.round(score*100)}%</b> ·
       Load <b>${load}</b> · N ${cfg.n} · ${spinLabel()}</p>
    <div class="bars">${rows || '<p>No scored judgments.</p>'}</div>
    ${headline ? `<div class="verdict ${verdict}">${headline}</div>` : ''}
    ${detail ? `<p style="text-align:center;margin:6px 0 0;font-size:12px">${detail}</p>` : ''}
    ${mBanner}
    <p style="margin-top:14px;font-size:12px">
      Bars are chance-corrected: 0% is what you'd score by never pressing, 100% is
      flawless. The block score blends the average across streams with your weakest
      stream, so an abandoned stream costs you either way.</p>
    <button class="cta" id="modalClose">Continue</button>`;
  modalEl.classList.add('open');
  $('modalClose').onclick = () => modalEl.classList.remove('open');
}

/* ============================================================
   15. GLYPH MAP
   ============================================================ */

/* ONE layout, generated once per session and used by both the intro and the scorer. */
/* With a fixed map the layout is generated once and then reused forever, so it can be
   learned instead of re-memorised every session. That makes the glyph stream markedly
   easier, which is the point of it being opt-in. */
function ensureGlyphMap() {
  if (freeCfg.fixedGlyphMap && state.glyphMap) { renderGlyphLegend(); return; }
  shuffleGlyphMap();
}

function shuffleGlyphMap() {
  const pos = [{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}];
  const keys = [...GLYPH_SET_KEYS].sort(() => Math.random() - 0.5);
  state.glyphMap = {};
  keys.forEach((k, i) => { state.glyphMap[k] = pos[i]; });
  renderGlyphLegend();
}

function glyphMapHTML() {
  const grid = [null, null, null, null];
  Object.entries(state.glyphMap).forEach(([k, p]) => { grid[p.y * 2 + p.x] = k; });
  return `<div class="glyph-map">` + grid.map(k =>
    `<div class="gm-cell"><div class="set">${k}</div>
     <div class="items">${GLYPH_SETS[k].join(' ')}</div></div>`).join('') + `</div>`;
}

function renderGlyphLegend() {
  const el = $('glyphLegend');
  const show = state.glyphMap && cfg.streams.glyph === 'relational' && cfg.feedback === 'reveal';
  el.classList.toggle('show', !!show);
  if (!show) return;
  const grid = [null, null, null, null];
  Object.entries(state.glyphMap).forEach(([k, p]) => { grid[p.y * 2 + p.x] = k; });
  el.innerHTML = `set map<br><b>${grid[0]}</b> &nbsp;<b>${grid[1]}</b><br><b>${grid[2]}</b> &nbsp;<b>${grid[3]}</b>`;
}

/* Blocking intro — the map must be memorised before trials begin. */
function showGlyphIntro(then) {
  ensureGlyphMap();
  modalBox.innerHTML = `
    <h2>Symbol map</h2>
    <p>These four sets sit on a 2×2 map, reshuffled every session. You will report
       movement <em>across this map</em> — not which set it was.</p>
    ${glyphMapHTML()}
    <p>Within a set, <b>+</b> / <b>−</b> report rank movement (1→5, A→E, …).</p>
    <button class="cta" id="modalClose">I have it — begin</button>`;
  modalEl.classList.add('open');
  $('modalClose').onclick = () => { modalEl.classList.remove('open'); then(); };
}

