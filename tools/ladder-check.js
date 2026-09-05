#!/usr/bin/env node
/*
 * The target-accuracy setting, checked against the staircase it drives.
 *
 * `ladder.js` is loaded on its own in a sandbox with nothing but a `tune` object,
 * which is all it needs for the parts under test -- so this runs without a browser,
 * a DOM or a build step:  node tools/ladder-check.js
 *
 * What it is guarding, in order of how badly each would have gone unnoticed:
 *
 *  · The default has to reproduce the old fixed numbers exactly. A new setting that
 *    quietly changes behaviour before anybody touches it is the worst kind.
 *  · `psi(T, T)` must equal the target, or the grid parameter stops being "the
 *    interval at which you score the target" and every printed threshold is a lie.
 *  · Retargeting must translate the posterior rather than reinterpret it. The
 *    stored evidence is about a criterion; change the criterion without moving the
 *    grid and months of blocks silently start claiming to be about a different one.
 *  · The clamp has to hold, because `stairC` divides by `(1 - lapse) - target` and
 *    a target at or above 0.97 makes the whole model infinite.
 */

const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

const ctx = vm.createContext({ console, Math, Array, Object, JSON });
// Only what ladder.js reaches for.
vm.runInContext('var TUNE_DEFAULTS = { targetAccuracy: 0.40 };', ctx);
vm.runInContext('var tune = { startInterval: 5000, targetInterval: 3000, maxInterval: 6500, nMax: 3, targetAccuracy: 0.40 };', ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ladder.js'), 'utf8'), ctx);
const g = k => vm.runInContext(k, ctx);
const set = (k, v) => vm.runInContext(`tune.targetAccuracy = ${v};`, ctx);

const LEGACY = 0.80;   // what every pre-setting record was fitted at
let bad = 0;
const ok = (name, cond, extra='') => { console.log((cond?'  ok   ':'  FAIL ') + name + (cond?'':'  '+extra)); if(!cond) bad++; };
const near = (a, b, tol=1e-9) => Math.abs(a-b) <= tol;

// 1. The band is the target plus its margins, whatever the target is.
ok('the band brackets the target',
   near(g('advanceAt()'), g('targetAccuracy()') + 0.05, 1e-9) &&
   near(g('demoteAt()'), g('targetAccuracy()') - 0.10, 1e-9),
   `target=${g('targetAccuracy()')} advance=${g('advanceAt()')} demote=${g('demoteAt()')}`);

/*
 * The scale the band has to live on -- the bug this file exists to keep out.
 *
 * `streamScore` maps "never pressed" to 0 and perfect to 1, and for the
 * relational position stream the never-press rate is 2/3 by construction: three
 * axis judgments per interval, one of them non-empty for an axis-aligned move.
 * So a raw accuracy `a` scores (a - 2/3) / (1/3), and a band chosen as though
 * the score were a raw accuracy is a band nobody can sit inside. At the original
 * 0.85 / 0.70 a player answering 85% of judgments exactly right scored 55% and
 * was told to ease off on every block.
 *
 * Written as a reachability check rather than as fixed numbers, so it keeps
 * meaning the same thing if the target is retuned again.
 */
const POSITION_CHANCE = 2 / 3;
const corrected = a => (a - POSITION_CHANCE) / (1 - POSITION_CHANCE);
const rawFor = s => POSITION_CHANCE + s * (1 - POSITION_CHANCE);

const holdLo = rawFor(g('demoteAt()')), holdHi = rawFor(g('advanceAt()'));
console.log(`   hold band is ${(holdLo * 100).toFixed(0)}%-${(holdHi * 100).toFixed(0)}%`
  + ` of judgments answered exactly right (target ${(rawFor(g('targetAccuracy()')) * 100).toFixed(0)}%)`);

ok('a player at the target scores inside the hold band',
   corrected(rawFor(g('targetAccuracy()'))) > g('demoteAt()') &&
   corrected(rawFor(g('targetAccuracy()'))) < g('advanceAt()'));
ok('the hold band sits where a human can actually play',
   holdLo >= 0.60 && holdHi <= 0.95,
   `${(holdLo * 100).toFixed(0)}%-${(holdHi * 100).toFixed(0)}% raw is not a band anyone sits in`);
ok('easing off means genuinely below target, not merely imperfect',
   holdLo > POSITION_CHANCE + 0.02 && holdLo < 0.85,
   `eases off below ${(holdLo * 100).toFixed(0)}% raw`);

// 2. The grid parameter IS the threshold, at any target.
let curveOk = true, band = [];
for (const p of [0.20, 0.35, 0.40, 0.55, 0.75, 0.90]) {
  set('t', p);
  const T = 3.5;
  if (!near(g(`psi(${T}, ${T})`), p, 1e-12)) curveOk = false;
  band.push([p, +g('advanceAt()').toFixed(3), +g('demoteAt()').toFixed(3)]);
}
ok('psi(T,T) equals the target at every setting', curveOk);
ok('the band follows the target', band.every(([p,a,d]) => near(a, Math.min(0.98,p+0.05), 1e-6) && near(d, Math.max(0.02,p-0.10), 1e-6)),
   JSON.stringify(band));

// 3. Out-of-range values are clamped rather than making stairC infinite.
set('t', 0.99);
ok('a target above the lapse ceiling is clamped', g('targetAccuracy()') === 0.90 && isFinite(g('stairC()')),
   `${g('targetAccuracy()')} / ${g('stairC()')}`);
set('t', 0.01);
ok('a target below the floor is clamped', g('targetAccuracy()') === 0.20);

// 4. Retargeting preserves the fitted curve.
set('t', 0.40);
vm.runInContext('stairInit(5000);', ctx);
// Some evidence: 14 of 20 at 3.2s, twice.
vm.runInContext('stairObserve(Math.log10(3200), 14, 20); stairObserve(Math.log10(3200), 15, 20);', ctx);
const T0 = g('stairMeanT()');
// Predicted performance across the interval range, under the old criterion.
const xs = [3.0, 3.2, 3.4, 3.6, 3.8];
const before = xs.map(x => g(`psi(${x}, ${T0})`));

set('t', 0.70);
vm.runInContext('stairRetarget(0.40, 0.70);', ctx);
const T1 = g('stairMeanT()');
const after = xs.map(x => g(`psi(${x}, ${T1})`));

const expectedShift = (Math.log(0.70/(0.97-0.70)) - Math.log(0.40/(0.97-0.40))) / 6.0;
ok('the posterior shifts by exactly (C_new - C_old)/beta',
   near(T1 - T0, expectedShift, 2e-3), `moved ${(T1-T0).toFixed(5)}, expected ${expectedShift.toFixed(5)}`);
ok('aiming higher puts the threshold at a slower interval', T1 > T0,
   `${(10**T0).toFixed(0)}ms -> ${(10**T1).toFixed(0)}ms`);
ok('the fitted performance curve itself is unchanged',
   before.every((v, i) => near(v, after[i], 2e-2)),
   JSON.stringify({before: before.map(v=>+v.toFixed(3)), after: after.map(v=>+v.toFixed(3))}));

console.log(`\nthreshold at 40%: ${(10**T0/1000).toFixed(2)}s   at 70%: ${(10**T1/1000).toFixed(2)}s`);

// 5. Retargeting back returns to where it started.
vm.runInContext('stairRetarget(0.70, 0.40);', ctx);
set('t', 0.40);
ok('retargeting back is a round trip', near(g('stairMeanT()'), T0, 3e-3),
   `${g('stairMeanT()').toFixed(5)} vs ${T0.toFixed(5)}`);

// 6. A no-op call and a missing posterior are both safe.
vm.runInContext('stairRetarget(0.40, 0.40);', ctx);
const T2 = g('stairMeanT()');
ok('retargeting to the same value changes nothing', near(T2, g('stairMeanT()')));
vm.runInContext('stairLog = null; stairRetarget(0.40, 0.70);', ctx);
ok('retargeting with no posterior yet does not throw', g('stairLog') === null);

/*
 * The migration every record written before the target was a setting goes
 * through on its first load. Last, because it replaces the posterior the checks
 * above share.
 */
set('t', LEGACY);
vm.runInContext('stairInit(4000);', ctx);
const legacyT = g('stairMeanT()');
vm.runInContext('stairRetarget(LEGACY_P_TARGET, 0.40);', ctx);
set('t', 0.40);
const adoptedT = g('stairMeanT()');
ok('a record fitted at the old target is re-read, not relabelled', adoptedT < legacyT,
   `${(10 ** legacyT).toFixed(0)}ms at ${LEGACY} -> ${(10 ** adoptedT).toFixed(0)}ms at 0.40`);
ok('the constant the migration reads is the criterion those records were fitted at',
   g('LEGACY_P_TARGET') === LEGACY, `LEGACY_P_TARGET=${g('LEGACY_P_TARGET')}`);
console.log(`   a stored 4.00s threshold at the old criterion reads as `
  + `${(10 ** adoptedT / 1000).toFixed(2)}s at the new one`);

/* ------------------------------------------------------------------ *
 * What the report says about a score                                  *
 * ------------------------------------------------------------------ */

/*
 * The colours and the criterion have to move with the target too.
 *
 * They did not. `barColor` was fixed at 0.85 and 0.70 and `progressSummary` held
 * a `CRIT = 0.80`, all three of which were the right numbers while every block
 * aimed at 80%. At the 40% default a cleared milestone was painted red for
 * scoring 56%, and "Load held" read "no block at ≥80% yet" for everybody
 * permanently, because no block at that target ever scores 0.80.
 *
 * Checked by reading the source rather than by calling it: both files reach for
 * the DOM at load, and what went wrong is a literal in the file, which is
 * exactly what a source scan can see.
 */
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const hud = src('js/hud.js');
const barLine = (hud.match(/const barColor = [^;]*;/) || [''])[0];
ok('the report colours a score against the target, not against 80%',
   /advanceAt\(\)/.test(barLine) && /demoteAt\(\)/.test(barLine)
     && !/0\.\d/.test(barLine.replace(/#[0-9a-f]{6}/gi, '')),
   `barColor reads: ${barLine || '(not found)'}`);

const crit = (src('js/analysis.js').match(/const CRIT = [^;]*;/) || [''])[0];
ok('"load held" is held to the score that would advance you',
   /advanceAt\(\)/.test(crit), `CRIT reads: ${crit || '(not found)'}`);

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
process.exit(bad ? 1 : 0);
