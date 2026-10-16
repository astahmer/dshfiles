# Durable remote DSH operations — open acceptance

## Status

This plan remains open. The existing federation behavior and its boundaries are documented in the [multi-host README](../../plugins/@dshfiles/multi-host/README.md) and [design](../../plugins/@dshfiles/multi-host/docs/design.md); historical real-SSH/UI evidence is in [validation](../../plugins/@dshfiles/multi-host/docs/validation.md). Repository-side launch-file, fail-closed smoke, and loopback-only SSH transport safety are verified, but do not establish a second scratch DSH lifecycle fixture, persistent Linux service owner, or deployment release.

Do not close this plan, infer a target from historical Pi/VPS validation, or apply the draft [nixfiles patch](nixfiles-remote-dsh.patch) as-is. No remote/physical host was contacted or modified; the only SSH connection in this milestone was to a generated loopback-only test daemon. No live DSH on `:3080` was restarted.

## Progress

| Work                                                                                   | State            | Evidence                                                                                             |
| -------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| Harden plugin launch metadata writes for pre-existing paths and failed publication     | Done             | `tests/launch-file.test.ts`; 4 tests pass                                                            |
| Make the manual SSH smoke fail closed, bound its port, and protect keys/launch tokens  | Done             | `tooling/dshx/scripts/smoke-multi-host-ssh.test.mjs`; 9 tests pass                                   |
| Verify explicit high-port SSH transport with ephemeral loopback-only sshd               | Done             | `tooling/dshx/scripts/smoke-multi-host-ssh-sshd.test.mjs`; 1 test pass                                |
| Select first remote host and current service owner                                     | Waiting on human | No owner is inferred from current configuration                                                      |
| Prove durable Linux service, pinned upgrade and rollback                               | Open             | Requires selected owner and disposable Linux environment                                             |
| Add isolated second-scratch-DSH SSH lifecycle E2E fixture                               | Open             | Loopback sshd test covers transport only; remote DSH readiness, threads, reconnect, and lifecycle remain open |

## Remaining acceptance gates

1. **Human decision:** name the first remote Linux host, SSH user and `DSH_HOME`, and identify its existing service owner (Nix Home Manager, Swarm, or another manager). The current nixfiles configuration imports `hm.dsh` only on macOS; its Linux workstation composition does not import it. Do not migrate a host or select an owner by assumption.
2. **Owner-side service:** implement the deterministic non-interactive service in the selected owner's repository. Pin the official DSH/Node/package-manager/dshfiles/profile/dependency tuple; set `PATH`, `DSHFILES_DIR`, `DSH_HOME` and loopback bind explicitly; prove profile-sync failure, stop semantics, restart/backoff and logout/linger behavior. Keep one service owner.
3. **Launch-token boundary:** the existing nixfiles supervisor fallback still needs owner-side fixes before it is accepted: force private permissions on both pre-existing `runtime/` and `web-url`, avoid writing tokenized `dsh web:` output to service logs, and remove stale metadata on all exit paths. Preserve the plugin's private `launch.json` behavior. Do not claim the fallback is safe based on static Nix configuration.
4. **Disposable Linux release proof:** use the selected disposable host to demonstrate boot/readiness, loopback-only access, wrong host-key/identity rejection, clean stop and crash recovery, pinned upgrade, and software rollback while preserving its DSH home, sessions and runtime identity. State data-migration/backup limits separately.
5. **Isolated SSH lifecycle E2E:** extend the passing loopback-only SSH transport fixture with a second scratch DSH covering readiness, remote thread create/read, tunnel loss/reconnect, stale launch metadata, failed profile sync, clean exit/crash recovery, and mutation-response loss without replay. The current test does not start DSH or exercise plugin operations. Keep physical-host acceptance manual and separate from CI.
6. **Safety invariant:** CI and scratch runs must not contact or restart a real host or the user's live DSH on `:3080`.

The current SSH smoke is safer to invoke but is not service acceptance: it requires `MH_DISPOSABLE_TARGET=1`, `MH_ALLOW_REMOTE_MUTATIONS=1`, explicit `MH_SSH_TARGET`, private `MH_SSH_KEY`, `MH_KNOWN_HOSTS`, `MH_UNIT`, `MH_WS` and `MH_REMOTE_HOME`; optional `MH_SSH_PORT` is bounded to 1–65535 and defaults to 22. The manual smoke disables per-user SSH config, refuses unknown host keys, and reads launch files rather than the journal. A separate test uses the same strict SSH option builder against a generated loopback-only server with ephemeral keys and known_hosts; this tests transport only, not DSH operations.

## Resume here

Wait for the human-selected target/service owner and disposable Linux proof environment. Then change the service in that owner's repository, fix the launch-metadata boundary there, run the isolated lifecycle fixture, and record real upgrade/rollback evidence. Until those gates pass, leave this plan open and all deployment acceptance unchecked.
