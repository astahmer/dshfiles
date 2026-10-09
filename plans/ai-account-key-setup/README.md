# AI Account key setup progress

Objective: make missing keyed-provider credentials configurable in AI Accounts without exposing values in chat or account JSON, with optional scoped Secret Catalog import and DSH credentials/process-environment fallbacks.

## Progress

| Step | Status | Evidence |
| --- | --- | --- |
| Map current account, Secret Catalog, and DSH credential boundaries | completed | Read-only source and live Inspect evidence; no secret values read |
| Implement write-only DSH credential setup, scoped Secret Catalog bridge, and per-operation resolution | completed | Host revalidates scope/source/target; Client receives metadata only |
| Correct CommandCode model id after live-catalog check | completed | Public catalog advertises `gpt-6-luna`; runtime curation no longer stores `openai/gpt-6-luna` |
| Add focused tests and document seed/runtime/secret-store behavior | completed | Bridge, resolver, visibility, and catalog tests; package suites pass |
| Build and verify in an isolated profile | completed | UI-plugin builds and Host import checks passed; scratch profile boot reported no activation failures; live DSH was not restarted |
| Review security boundaries and split owned changes with jj | in progress | Host keeps reveal→credential write; Client gets metadata only; path/consent trust relies on DSH's authenticated local-client boundary |

## Safety invariants

- AI Accounts JSON stores only credential references, never secret values.
- DSH `credentialsController` is used for manual writes; it never returns values.
- Secret Catalog is optional. Its Host bridge returns metadata only, requires an explicit folder for project/local entries, revalidates the selected scope and unique source, and imports directly into Host credentials.
- Dynamic credential resolution is per operation. Process-environment changes may require relaunch; managed credential-store changes do not.
- AI Accounts JSON stores only the reference. The checked-in `profiles/web/ai-accounts.json` is a seed; the runtime account file is `${DSH_HOME:-~/.dsh}/plugins/ai-accounts/accounts.json`.
- DSH credentials are the non-versioned, write-only secret store fallback; no new raw-secret JSON file is needed.
- Never modify `.secret.json` or restart the live DSH instance on `127.0.0.1:3080`.

Resume here: import-check the rebuilt AI Accounts Host after the CommandCode correction, verify in an isolated profile without touching live DSH, then split the owned source changes with jj.
