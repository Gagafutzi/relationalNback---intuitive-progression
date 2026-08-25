"use strict";

/* ============================================================
   18. BOOT
   ============================================================ */

loadAppearance();
applyAppearance();
buildCube(3);
if (!stairLog) stairInit(prog.interval || tune.startInterval);
if (tune.adapt === 'bayes') prog.interval = stairNextInterval();
setMode(cfg.mode);
renderDataPanel();
renderProfileUI();
renderDailyTimer();
