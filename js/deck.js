"use strict";

/* ============================================================
   10. RESPONSE DECK
   ============================================================ */

/* Groups shown on the deck, in order. Position splits per reference frame. */
function deckGroups() {
  const groups = [];
  STREAM_KEYS.forEach(k => {
    const m = cfg.streams[k];
    if (m !== 'identity' && m !== 'relational') return;
    const spec = STREAMS[k];

    if (k === 'position' && m === 'relational' && cfg.meta) {
      groups.push({ key:'position', label:'Move vs. previous move ↺',
                    color: spec.color, channels: spec.meta });
    } else if (k === 'position' && m === 'relational') {
      const both = cfg.frame === 'both';
      if (cfg.frame === 'cube' || both)
        groups.push({ key:'position', label:'Position' + (both ? ' · cube' : ''),
                      color: spec.color, channels: spec.relational });
      if (cfg.frame === 'screen' || both)
        groups.push({ key:'position2', label:'Position' + (both ? ' · screen' : ' · screen'),
                      color:'#9ccc65', channels: spec.relationalScreen });
    } else {
      groups.push({ key:k, label: spec.label + (m === 'relational' ? ' ↔' : ' ='),
                    color: spec.color, channels: spec[m] });
    }
  });
  return groups;
}

/* Custom bind wins, then the built-in default, then the pool. The pool pass is the
   runtime guarantee: whatever the user configures, no two live buttons share a key. */
function assignKeys(groups) {
  const used = new Set(), map = new Map();
  const all = groups.flatMap(g => g.channels);
  const claim = (c, k) => { if (k && !used.has(k)) { used.add(k); map.set(c.id, k); } };

  all.forEach(c => claim(c, keyBinds[c.id]));
  all.forEach(c => { if (!map.has(c.id)) claim(c, c.key); });
  /* The pool pass skips keys an app shortcut owns. The keydown handler checks the
     deck first, so a key handed out here would silently kill the shortcut — and
     unlike a bind the user chose, nobody asked for it. A deliberate bind on either
     side may still collide; both editors flag that rather than preventing it.
     The unreserved fallback only matters if the pool is exhausted, where a button
     with no key at all is the worse outcome. */
  const reserved = reservedActionKeys();
  all.forEach(c => { if (!map.has(c.id)) claim(c,
    KEY_POOL.find(k => !used.has(k) && !reserved.has(k)) ||
    KEY_POOL.find(k => !used.has(k))); });
  return map;
}

/* KeyboardEvent.key spells the non-printing keys as words, and uppercasing them the
   way a letter is uppercased gave key caps reading ENTER and ESCAPE. */
const KEY_NAMES = {
  ' ':'Spc', enter:'Enter', escape:'Esc', backspace:'Bksp', delete:'Del', tab:'Tab',
  arrowleft:'←', arrowright:'→', arrowup:'↑', arrowdown:'↓',
  home:'Home', end:'End', pageup:'PgUp', pagedown:'PgDn', insert:'Ins',
};
const keyLabel = k => !k ? '—' : KEY_NAMES[k] || k.toUpperCase();

function buildDeck() {
  deckEl.innerHTML = '';
  state.keyIndex = {};
  const groups = deckGroups();
  const keys = assignKeys(groups);

  groups.forEach(g => {
    const group = document.createElement('div');
    group.className = 'deck-group';
    group.dataset.stream = g.key;
    group.style.borderColor = g.color + '55';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = g.label;
    group.appendChild(title);

    const btns = document.createElement('div');
    btns.className = 'btns';
    g.channels.forEach(c => {
      const key = keys.get(c.id);
      state.keyIndex[key] = c.id;

      const b = document.createElement('button');
      b.className = 'rbtn';
      b.dataset.channel = c.id;
      b.style.setProperty('--btn-color', c.color || g.color);
      b.title = `${g.label}: ${c.label}`;
      b.innerHTML = `<span class="glyph">${c.glyph}</span>` +
                    `<span class="kbd">${keyLabel(key)}</span>`;
      /* pointerdown, not click: on touch a click is only dispatched when the finger
         LIFTS, plus whatever the browser spends deciding the tap was not the first
         half of a double-tap. That delay pushed answers given near the end of an
         interval across the boundary, where they were graded against the next
         trial. preventDefault suppresses the compatibility click that would
         otherwise arrive a second time. */
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        b.classList.add('down');
        press(c.id);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
        b.addEventListener(ev, () => b.classList.remove('down')));
      /* detail === 0 means the click came from Enter/Space on a focused button, not
         from a pointer — the only clicks left to honour. */
      b.addEventListener('click', e => { if (e.detail === 0) press(c.id); });
      btns.appendChild(b);
    });
    group.appendChild(btns);
    deckEl.appendChild(group);
  });
}

/* Highlight the cued deck group and name it in the HUD. The cue has to be visible
   the whole block — it is an instruction to hold, not a momentary signal. */
function renderPriorityCue() {
  deckEl.querySelectorAll('.deck-group').forEach(g =>
    g.classList.toggle('priority', g.dataset.stream === state.priorityStream));
  const el = $('hudPriority');
  if (!el) return;
  if (state.priorityStream && state.running) {
    el.innerHTML = `focus: <b>${labelFor(state.priorityStream)}</b>`;
    el.style.display = '';
  } else el.style.display = 'none';
}

/* Grace window for a response that lands just after the stimulus changed. No press
   this soon can be a reaction to the NEW trial — a relational judgment needs half a
   second at the very least — so it belongs to the interval that just closed.
   Without this, an answer given near the end of an interval was scored against the
   trial that replaced it, and a correct answer flashed red. */
const LATE_PRESS_GRACE = 260;
const graceMs = () => Math.min(LATE_PRESS_GRACE, cfg.interval * 0.25);

/* ---- Move trace ----
   Only the meta-relation channels get one. Every other stream asks an independent
   question — miss a colour and the next colour question is unaffected — but meta
   compares this move against the move you reported last time, so an error there
   takes the anchor with it and the rest of the block is guesswork. This hands the
   anchor back. */
const META_CHANNEL_IDS = new Set((STREAMS.position.meta || []).map(c => c.id));

/* Deliberately left up through the FOLLOWING trial, not flashed and cleared. The
   direction it draws is the one the next trial has to be judged against, so the
   moment it is most useful is after the next stimulus has already appeared. */
function traceMove(trial) {
  const axisId = moveIntoTrial(trial);
  if (!axisId) return;
  showMoveArrow(axisId);
  state.traceUntil = state.trial + 1;
  /* The gizmo arm for the same axis, once, so the eye is handed from the arrow
     inside the lattice out to the label that names it. */
  flashArm(axisId);
}

function pressFeedback(channelId, ok, trial) {
  const btn = deckEl.querySelector(`[data-channel="${channelId}"]`);
  if (AXIS[channelId]) flashArm(channelId);
  if (!ok) playBuzz('fa');
  if (cfg.feedback !== 'off' && btn) {
    btn.classList.add(ok ? 'hit' : 'miss');
    setTimeout(() => btn.classList.remove('hit', 'miss'), 260);
  }
  /* Suppressed under test conditions whatever the switch says — the trace is the
     loudest feedback in the app and "None" has to mean none. */
  if (!ok && cfg.moveTrace && cfg.feedback !== 'off' && META_CHANNEL_IDS.has(channelId))
    traceMove(trial);
}

function press(channelId) {
  if (!state.running) return;

  /* Tested before the `cued` guard: on a retro-cue trial the window for the NEW
     trial is still shut, but a late answer to the trial that just closed is
     perfectly legitimate and must not be swallowed. */
  const snap = state.lastSnap;
  if (snap && state.tickAt && performance.now() - state.tickAt < graceMs() &&
      !snap.presses.has(channelId) &&
      snap.judgments.some(j => j.options.includes(channelId))) {
    applyInterval(snap, -1);
    snap.presses.add(channelId);
    applyInterval(snap, 1);

    const ok = snap.judgments.some(j => j.correct.includes(channelId));
    state.presses_log.push({
      t: snap.trial, ch: channelId, ok, late: true,
      rt: snap.stimAt ? Math.round(performance.now() - snap.stimAt) : null,
    });
    pressFeedback(channelId, ok, snap.trial_);
    return;
  }

  if (state.presses.has(channelId)) return;
  if (!state.cued) return;        // retro-cue trial: no answering before the cue
  state.presses.add(channelId);

  const j = state.judgments.find(x => x.options.includes(channelId));
  const ok = !!(j && j.correct.includes(channelId));

  /* Logged regardless of the feedback setting — RT cannot be reconstructed later. */
  state.presses_log.push({
    t: state.trial, ch: channelId, ok,
    rt: state.stimAt ? Math.round(performance.now() - state.stimAt) : null,
  });

  pressFeedback(channelId, ok, state.currentTrial);
}

function revealAnswers() {
  if (cfg.feedback !== 'reveal') return;
  state.judgments.forEach(j => j.correct.forEach(id => {
    const btn = deckEl.querySelector(`[data-channel="${id}"]`);
    if (btn) { btn.classList.add('reveal'); setTimeout(() => btn.classList.remove('reveal'), 500); }
    if (AXIS[id]) flashArm(id);
  }));
}

