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
/* After setMode, because that is what fills the deck, and the deck is most of the
   dock's height — which is half of what the cube is sized against. The observer
   would catch it too, but only once the page has been rendered, and the cube is
   sized before that. */
measureDock();
renderDataPanel();
renderProfileUI();
renderDailyTimer();
