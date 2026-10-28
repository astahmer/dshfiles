# Typed chat drafts: activation pending

The feature and attachment/reference retry correction are integrated into local `main`. [Upstream PR #1](https://github.com/astahmer/dshfiles/pull/1) contains the cohesive update, revised title/description, current-upstream reconciliation and verification evidence. Its tested base is `04d6c5ee5156a5f18c45273eca440cdbb3ab63c7`; the contribution head is `689f81f97cd65a834daf4e198d9b9643e98a40e1`. The PR-only upstream reconciliation is not a general sync of the personal fork. No force-push, upstream merge, reviewer request or live restart was performed.

Durable behavior and architecture live in the [Thread Sidebar README](../../plugins/@dshfiles/thread-sidebar/README.md), [draft controller](../../plugins/@dshfiles/session-controller/README.md), [model owner](../../plugins/@dshfiles/model-selection/README.md) and [preset owner](../../plugins/@dshfiles/agent-preset/README.md).

Resume here: wait for the user to choose activation. Only activation work remains:

1. The user chooses **Restart when idle** or a normal supervised relaunch. The historical selected profile included both new companion bundles; all prior profile metadata and Cordis patch were preserved. Recheck current local selection before activation.
2. The source supervisor builds all plugins before starting the next Host and then prepares the source-linked profile. Confirm the coupled controller/navigation/composer/sidebar and both native-row companions load together.
3. Verify the existing GUI URL: selected New chat appears, opening blanks creates no saved history, and two typed drafts reopen independently. Then retire this activation note.

Until that restart, keep the four existing served client/Host pairs unchanged. Their Host fingerprints do not change for this feature, so the HMR gate alone would not prevent an incomplete client-only update while the new native rows are still inactive. The supervisor and managed-restart environment were verified active; no automatic build watcher was running. New inactive bundles were built/import-checked canonically, and existing served artifacts were verified unchanged. Never request or perform the restart without the user's decision.

No old conversations are deleted. Draft text remains browser-origin-local in the existing composer store. Metadata merging preserves sequential independent tab interleavings, not cross-process localStorage transaction/CAS semantics. Private profile metadata backups are kept under `~/.local/state/dsh-source-backups/typed-chat-profile-*`.
