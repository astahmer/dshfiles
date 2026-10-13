# Multi-host: durable remote hosts

Multi-host shipped: directory, identity pinning, connection pool, host chip,
remote folders and jj workspaces, remote thread view, and the Remote sidebar
section, all on stock DSH 0.2.0-rc.2 and in the `web` seed. Behavior is in the
[package README](../../plugins/@dshfiles/multi-host/README.md), the architecture
and its rules in [docs/design.md](../../plugins/@dshfiles/multi-host/docs/design.md),
and the receipts (VPS, Pi, local; P1–P3 and the 2026-10-13 host chip run) in
[docs/validation.md](../../plugins/@dshfiles/multi-host/docs/validation.md).

What is left is operating a remote host durably, which the plugin deliberately
does not do.

## Remaining

- [ ] **Supervise a remote runtime declaratively.** Today the Pi and VPS run
      hand-made or scratch user units; nixfiles manages neither. Pick the owner
      (nixfiles or the Pi's Swarm setup). For nixfiles, the proposed change is
      [`nixfiles-remote-dsh.patch`](nixfiles-remote-dsh.patch): a Home Manager
      user service that runs the existing `dsh web` supervisor on loopback and
      records `runtime/web-url`, with the macOS-only pieces guarded by
      `isDarwin`. It is untested; check the flag order passed through
      `supervise-web.mjs` on the first Linux apply.
- [ ] **Upgrade and rollback** for a remote runtime: pinned DSH and plugin
      artifacts, prebuilt only, with a way back to the previous release.
- [ ] **Browser journey.** The 8 multi-host catalog entries are
      `not-applicable` because the e2e harness has no SSH server or second
      runtime behind one. A loopback sshd fixture would let the chip, Add host
      and remote thread run in CI.

Blocked upstream: LSP on remote runtimes needs protocol-matching official
SSH/LSP artifacts.

Delete this plan once a nixfiles- (or Swarm-) managed host is in use and its
upgrade path is written down in the package README.
