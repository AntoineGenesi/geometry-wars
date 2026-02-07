## 2026-02-07 - Project Directory Cleanup

**Context:** Root directory had accumulated ~6MB of stale test screenshots, one-off debugging scripts, and empty directories from earlier development iterations.

**Deleted:**
- 8 root PNG files: screenshot1-initial.png, screenshot2-after-w.png, screenshot3-after-click.png, screenshot4-movement.png, test-shooting-right.png, test-shooting-forward.png, test-shooting-left.png, test-final.png (~2.7MB)
- screenshots/ directory: 80+ PNGs across surface-tests/, torus-hole-test/, mouse-test/, multiplayer-test/ (~3.4MB)
- 10 test/screenshot scripts: take-screenshot.js, take-screenshot-puppeteer.js, take-screenshot.mjs, test-camera.mjs, test-shatter-effects.mjs, test-surfaces.mjs, test-gameplay.mjs, test_movement.js, gw-screenshot.mjs, screenshot.spec.js
- SCREENSHOT_INSTRUCTIONS.md
- Empty directories: experiments/, public/, test-results/
- scripts/ directory: visual-debug.cjs, visual-debug-thorough.cjs (superseded by Puppeteer-based testing)
- /tmp/gw-*.png temporary files

**Kept:**
- mesh-test.html: Active debugging tool for mesh movement system
- playwright.config.js: Used by Playwright dependency for visual testing
- All src/, server/, decisions/, research/, docs/ content

**Total savings:** ~6.1MB

**Reversibility:** Easy - files are recoverable from git history.
