# Bandit Refactoring Checklist

This checklist tracks the recent architectural rectifications and bug fixes applied to the Bandit codebase.

## Completed ✅
- [x] **Modularization**: Separated `pet/engine.js` into `pet/core.js`, `ui/popup.js`, `pet/sprites.js`, and `ui/modals.js`.
- [x] **Demo Isolation**: Extracted `demo.js` so mock chat logs and fake UI event listeners don't bleed into real host websites.
- [x] **Native APIs**: Replaced manual `AbortController` timeouts with `AbortSignal.timeout()`.
- [x] **Memory Leaks Patched**: Audited global `window` event listeners to ensure they properly clear upon extension teardown (no zombie listeners).
- [x] **CPU Bottlenecks Fixed**: Throttled the `pointermove` DOM queries (`getClosest`) to a maximum of 20Hz, reducing idle CPU usage during mouse movement.
- [x] **Timer Garbage Collection**: Pushed background intervals (`thinkingTimer`, `feedCountdownTimer`, `requestAnimationFrame`) to `cleanupTasks` to stop runaway processes.
- [x] **Version Bugs**: Fixed a mismatch where the standalone demo page fell back to version `2.1` instead of tracking the `manifest.json` version `2.4`.
- [x] **Documentation**: Created `README.md` and this `CHECKLIST.md`.

## Open / Future Work 🚧
- [ ] Move the Settings Modal generation (`bindSettings`) from `pet/core.js` to `ui/popup.js` to complete full UI decoupling.
- [ ] Implement unit tests for `storage.js` migrations.
- [ ] Add new accessories for Level 4 and Level 5.
