# Changelog

This file is maintained by Changesets. Entries after 0.1.0 are produced by the
version PR; the 0.1.0 entry below is the hand-written initial release, which the
first publish carries and therefore needs no Changeset.

## 0.1.0

### Minor Changes

- Initial implementation of the Pomodoro focus clock.
- Ambient timer under the composer (`conversation.composer.dock`): phase, countdown, cycle position, start/pause, restart, skip.
- Settings page (`settings.section`) for focus / short-break / long-break lengths, the cycle length and both autostart switches, plus today's rounds, focus time and a daily reset.
- Daily round and focus-time counters that roll over at local midnight.
- State persists in `localStorage` (`skillre-pomodoro/state`, payload version 2) with absolute phase deadlines, so a reload resumes the same round. A round is credited for the length it actually ran, corrupt or out-of-range records degrade to a fresh paused timer instead of crediting a phantom round, and a skipped round never earns a long break.
- The Client half is bundled by esbuild into one CommonJS artifact with only baseline `react` external; a test loads it through the shell's `__ModuleLoader__` envelope contract.
