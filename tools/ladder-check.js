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
vm.runInContext('var tune = { startInterval: 5000, targetInterval: 3000, maxInterval: 6500, nMax: 3, targetAccuracy: 0.80 };', ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ladder.js'), 'utf8'), ctx);
const g = k => vm.runInContext(k, ctx);
const set = (k, v) => vm.runInContext(`tune.targetAccuracy = ${v};`, ctx);

let bad = 0;
const ok = (name, cond, extra='') => { console.log((cond?'  ok   ':'  FAIL ') + name + (cond?'':'  '+extra)); if(!cond) bad++; };
const near = (a, b, tol=1e-9) => Math.abs(a-b) <= tol;

// 1. Nothing moves at the default.
ok('the default target reproduces the old thresholds exactly',
   near(g('advanceAt()'), 0.85) && near(g('demoteAt()'), 0.70),
   `advance=${g('advanceAt()')} demote=${g('demoteAt()')}`);

const OLD_C = Math.log(0.80 / ((1 - 0.03) - 0.80));
ok('the default target reproduces the old psi offset', near(g('stairC()'), OLD_C, 1e-12));

// 2. The grid parameter IS the threshold, at any target.
let curveOk = true, band = [];
for (const p of [0.55, 0.65, 0.75, 0.80, 0.90, 0.92]) {
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
ok('a target above the lapse ceiling is clamped', g('targetAccuracy()') === 0.92 && isFinite(g('stairC()')),
   `${g('targetAccuracy()')} / ${g('stairC()')}`);
set('t', 0.01);
ok('a target below the floor is clamped', g('targetAccuracy()') === 0.55);

// 4. Retargeting preserves the fitted curve.
set('t', 0.80);
vm.runInContext('stairInit(5000);', ctx);
// Some evidence: 14 of 20 at 3.2s, twice.
vm.runInContext('stairObserve(Math.log10(3200), 14, 20); stairObserve(Math.log10(3200), 15, 20);', ctx);
const T0 = g('stairMeanT()');
// Predicted performance across the interval range, under the old criterion.
const xs = [3.0, 3.2, 3.4, 3.6, 3.8];
const before = xs.map(x => g(`psi(${x}, ${T0})`));

set('t', 0.90);
vm.runInContext('stairRetarget(0.80, 0.90);', ctx);
const T1 = g('stairMeanT()');
const after = xs.map(x => g(`psi(${x}, ${T1})`));

const expectedShift = (Math.log(0.90/(0.97-0.90)) - Math.log(0.80/(0.97-0.80))) / 6.0;
ok('the posterior shifts by exactly (C_new - C_old)/beta',
   near(T1 - T0, expectedShift, 2e-3), `moved ${(T1-T0).toFixed(5)}, expected ${expectedShift.toFixed(5)}`);
ok('aiming higher puts the threshold at a slower interval', T1 > T0,
   `${(10**T0).toFixed(0)}ms -> ${(10**T1).toFixed(0)}ms`);
ok('the fitted performance curve itself is unchanged',
   before.every((v, i) => near(v, after[i], 2e-2)),
   JSON.stringify({before: before.map(v=>+v.toFixed(3)), after: after.map(v=>+v.toFixed(3))}));

console.log(`\nthreshold at 80%: ${(10**T0/1000).toFixed(2)}s   at 90%: ${(10**T1/1000).toFixed(2)}s`);

// 5. Retargeting back returns to where it started.
vm.runInContext('stairRetarget(0.90, 0.80);', ctx);
set('t', 0.80);
ok('retargeting back is a round trip', near(g('stairMeanT()'), T0, 3e-3),
   `${g('stairMeanT()').toFixed(5)} vs ${T0.toFixed(5)}`);

// 6. A no-op call and a missing posterior are both safe.
vm.runInContext('stairRetarget(0.80, 0.80);', ctx);
const T2 = g('stairMeanT()');
ok('retargeting to the same value changes nothing', near(T2, g('stairMeanT()')));
vm.runInContext('stairLog = null; stairRetarget(0.80, 0.90);', ctx);
ok('retargeting with no posterior yet does not throw', g('stairLog') === null);

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
process.exit(bad ? 1 : 0);
