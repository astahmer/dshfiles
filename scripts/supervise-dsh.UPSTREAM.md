# Supervisor provenance and update boundary

Adapted from Alexandre Stahmer's
[`assets/dsh/supervise-web.mjs`](https://github.com/astahmer/nixfiles/blob/9daa1991c1d11f0689eac44171342b018f47cf6f/assets/dsh/supervise-web.mjs).
The source repository does not declare a license in its repository metadata;
this file records attribution and does not assert a new upstream license.

The retained mechanism is the existing managed restart protocol:

1. Allocate a fresh UUID and exact request path per child run.
2. Pass `DSH_RESTART_RUN_ID` and `DSH_RESTART_REQUEST_PATH` to DSH.
3. Accept a restart only after exit 75, no signal, and matching request contents.
4. Dispose the previous run, prepare the source/profile, and spawn a new Host.
5. Forward Ctrl+C/termination and do not restart a process being stopped.
6. Keep the tokenized launch URL in the private runtime file, never in docs.

The unchanged Thread sidebar already detects changed Host artifacts, shows the
restart warning, and provides **Restart now / Restart when idle / Cancel**.
The supervisor supplies the missing process-parent contract; it does not invent
another sidebar, update mechanism or launcher command.

## Local adaptations

- One public command, `dsh`, invokes this supervisor through a machine-local
  Node/core/source/profile configuration. See
  [personal configuration](../docs/personal-configuration.md) for the strict JSON
  keys, environment precedence and migration contract. No person's installation,
  home, profile, account or port is selected by shared launcher defaults.
  Network access preferences and explicit native CLI flags retain precedence;
  only an explicit local `legacyPort` supplies a compatibility fallback.
  The confirmed restart protocol is unchanged. No recursive `spawn('dsh', ...)`,
  macOS `caffeinate`, or second launcher command is introduced.
- Build/cache and selected-only profile preparation run before each initial or
  requested start. The preparation helper retains its historical filename for
  compatibility but uses the configured DSH home and profile. Errors fail closed
  instead of running a partly prepared profile. It does not apply the shared web
  seed over an existing user's private profile.
- Already-selected bundles, their order and private patch settings are preserved;
  preparation does not implicitly add a person's plugin selection. The generic
  shared web seed includes `@dshfiles/hmr-gate`, whose existing bundle patch
  disables stock `client-hmr`.
- No channel-pack account/checkin seeding, environment-provider overrides or
  automatic LKG background snapshot: those upstream machine choices are not
  required by the reload feature and were not approved here.
- Output is buffered by complete lines so split launch-URL writes are handled;
  the request identity, URL mode and non-restart exits are tested.

## Honest limits

The native Host `hmr` row remains disabled: changed backend code is loaded by a
whole-Host managed restart, not an in-process hot swap. Gate deferral protects
existing tabs' rebuild announcements; it does not freeze served files for a new
tab/manual refresh, cover every external dependency, or compile source changes.
A merge must still build the canonical checkout's affected artifacts.

The existing **Restart when idle** waits for running turns, not all background
processes/jobs, requires two idle polls, and has a 30-minute fallback that can
restart while turns still run. Existing `resumeAfterRestart` settings remain
unchanged; do not promise automatic continuation when disabled. This task does
not change those upstream semantics. Reload the browser after the Host restarts.

Future updates should compare the pinned source's request/signal protocol and
port/profile preparation deliberately, not overwrite this adapter from upstream
or apply the Mac's personal profile defaults to this machine.
