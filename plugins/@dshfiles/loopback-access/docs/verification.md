# Network access verification

The implementation uses stock DSH 0.2.1-rc.2 and official Node 22.23.3. No core patch is involved.

## Focused proof

- Network package: typecheck and 73 tests pass, including real sockets, immutable native startup configuration, native Loader updates and 11 real-control UI tests.
- Settings shell: typecheck and 52 tests pass.
- Offline migration, selected-source preparation and existing supervisor protocol: 25 Node tests pass.
- SDK startup adapter and Host compiler: 29 tests pass.
- All 13 networking and Settings shell browser scenarios pass after integration with the current supervisor/verifier architecture.
- The settings journey checks the same keep-alive TCP connection before and after Save; desired preferences and revision change while the active binding stays unchanged. Invalid/stale writes, including a generic Settings write, leave profile bytes unchanged. Only the fixture-owned Host is restarted; the new native LAN bind and both origins retain native authentication.
- Widths 360, 480, 768 and 1024 pass without section overflow. Compact section selection works, and the search field retains usable width. Captures wait for the listbox to unmount rather than capturing its closing animation.
- `dshx dev up`, `doctor`, the catalog `open` walk and `shot` pass in isolated state; the shot reports no console, page, request or HTTP errors.

Reproduce the browser scope with the installed stock core and an available Chromium:

```sh
DSHX_DSH_EXECUTABLE=/absolute/path/to/stock/dsh/lib/bin.js \
DSHX_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome \
DSHX_E2E_PREWARM=0 \
pnpm --dir tooling/dshx exec playwright test \
  --config=playwright.e2e.config.ts \
  'loopback-access.feature.spec.js|settings-shell.feature.spec.js' --workers=1
```

The optional executable overrides are shared verifier APIs, not a production requirement. Do not use a personal launcher that resets HOME for scratch verification.

## Activation boundary

The canonical affected artifacts are built. The supervised launcher no longer forces host/port flags; offline preparation preserves the old profile fallbacks and runs only after its stopped-process guard. Existing confirmed-request restart semantics and HMR-gate selection remain intact.

No live profile was edited and no live restart was requested. A historical read-only check found unauthenticated requests to localhost, IPv4 loopback, IPv6 loopback and the selected LAN origin returned 401 while the same Host remained running. Private process and endpoint details are omitted. This observation does not establish current activation; verify the actual runtime and let the user choose any required stop/start.

## Limits

Local execution proves Linux behavior, not macOS or Windows execution. The portable CI matrix remains configured, but no push or cross-OS CI run was performed.

Repository-wide gates are not globally green: feature coverage has the existing Agents mention-preview gap, workspace contract has the existing missing User questions test script, formatting has unrelated existing files, and lint ratchets exceed existing repository caps. The changed networking sources pass direct scoped lint; no unrelated files or ratchet caps were rewritten. Native fork drift also reports existing added Chat/Rich composer files outside this change.
