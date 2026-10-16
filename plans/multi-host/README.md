# Durable remote DSH operations — open release gates

The repository-side lifecycle behavior and verification are documented in the [multi-host README](../../plugins/@dshfiles/multi-host/README.md) and [validation record](../../plugins/@dshfiles/multi-host/docs/validation.md). The isolated second-scratch-DSH SSH lifecycle E2E is complete. The user chose to leave physical release acceptance open: no target or service owner is selected, and no deployment or live `:3080` restart is in scope. The read-only host audit and current access limits are in the validation record. Do not apply the draft [nixfiles patch](nixfiles-remote-dsh.patch) as-is.

## Open gates

1. **Select one target and service owner.** The Pi's pinned host key was valid, but the configured identity was denied; the VPS has no DSH unit/service in its registered home. This is an access limitation, not a refusal. Do not infer an owner or ask a broad target-selection question; continue only after the user chooses a specific target, SSH user, `DSH_HOME`, and existing service owner.
2. **Implement the owner-side service.** In the selected owner's repository, pin the official DSH/Node/package-manager/dshfiles/profile/dependency tuple; set `PATH`, `DSHFILES_DIR`, `DSH_HOME`, and loopback bind explicitly; prove profile-sync failure, stop semantics, restart/backoff, and logout/linger behavior. Keep one service owner.
3. **Harden the launch-token boundary.** Before accepting the Nixfiles supervisor fallback, force private permissions on pre-existing `runtime/` and `web-url`, avoid writing tokenized `dsh web:` output to service logs, and remove stale metadata on every exit path. Preserve the plugin's private `launch.json` behavior and verify the result on the selected disposable host.
4. **Run disposable Linux release acceptance.** Prove boot/readiness, loopback-only access, wrong host-key/identity rejection, clean stop and crash recovery, pinned upgrade, and rollback while preserving the DSH home, sessions, and runtime identity. State data-migration and backup limits separately.

## Safety boundary

CI and scratch fixtures stay loopback-only and must not contact a real host, mutate the production Swarm, or restart the user's live DSH on `:3080`. Physical service changes remain outside this plan until the user selects the target and owner and a disposable Linux release environment is available.
