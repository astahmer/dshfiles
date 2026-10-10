# Project Checks

Project Checks adds a session-scoped action in the native composer command menu. It runs profile-trusted, named commands in the active session's directory, stores bounded receipts in DSH storage, can verify configured actions before a turn closes, and shows native hook invocation/result records.

## Configure trusted actions

Actions belong in the profile's `cordis.patch.yml`, never in project-controlled configuration. Add this top-level patch row alongside the other entries and use absolute paths for roots:

```yaml
- id: dshfiles-project-checks
  config:
    actions:
      - id: test
        label: Test
        description: Run the project test suite.
        command: pnpm
        args: [test]
        root: /absolute/path/to/project
        timeoutMs: 180000
        verifyBeforeComplete: true
      - id: typecheck
        label: Typecheck
        command: pnpm
        args: [typecheck]
        root: /absolute/path/to/project
        timeoutMs: 120000
```

The process uses direct argv, the session directory as `cwd`, and DSH's scrubbed child environment. It does not evaluate shell text, read repository command config, forward credentials, or display raw command output. A session must resolve inside the configured root. One-shot actions have a 1–300 second timeout. Long-running development servers remain in DSH's owner-scoped terminal.

Actions marked `verifyBeforeComplete` run at the native awaited `agent/turn-stopping` event. Failed checks steer the same turn once, then the configured attempt limit (maximum two) stops that turn with a failure. Cancellation aborts and cleans up the subprocess. Pass receipts are bound to the current Jujutsu working-copy commit id and become stale when that id changes.

The panel reads hook events from the native session query service. DSH 0.2 records `hook/invoked` and `hook/result`; it does not emit durable skipped/unsupported-hook events, so the panel states that gap instead of inventing per-hook skip records. Hook stderr content and raw subprocess output are not exposed.

## Verify

Run `pnpm typecheck`, `pnpm test`, and `pnpm build` from this package. `pnpm verify:scratch` exercises trusted actions, completion receipts, and native hook results in an isolated scratch DSH profile; it does not modify the active profile.
