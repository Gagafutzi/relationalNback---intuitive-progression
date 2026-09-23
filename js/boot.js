"use strict";

/* ============================================================
   18. BOOT
   ============================================================ */

/*
 * The sampler takes its world rather than reaching for it, and the world is
 * written out here rather than handed over as `globalThis`.
 *
 * It has to be: `const` at the top level of a script is a lexical binding in
 * the global scope and NOT a property of `globalThis`, so `cfg`, `state`,
 * `dimCount` and most of the constants below simply are not on that object.
 * This file is in the same scope and can see them, so it names them.
 *
 * Installing the result as globals keeps every existing call site —
 * `sampleTrial()` in block.js, `pick()` in trials.js — exactly as it was.
 */
Object.assign(globalThis, createSampler({
  cfg, state,
  STREAM_KEYS, TARGET_RATE, META_SHARE, META_FLOOR, PANS, LETTER_KEYS,
  GLYPH_SET_KEYS, dimCount, magnitudeCap, coordAxes, poolFor, voiceSet,
}));

loadAppearance();
applyAppearance();
buildCube(3);
if (!stairLog) stairInit(prog.interval || tune.startInterval);
if (tune.adapt === 'bayes') prog.interval = stairNextInterval();
setMode(cfg.mode);
renderDataPanel();
renderProfileUI();
renderDailyTimer();
