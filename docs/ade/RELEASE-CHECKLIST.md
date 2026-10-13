# Release checklist — live state

| #   | Gate                                       | State            | Evidence / next command                                                                                                                     |
| --- | ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Isolation positive path                    | **PASS**         | `rc-verify.mjs`: ok true x2, 2 isolated records each attached, 0 sessions in the shared checkout                                            |
| 2   | Isolation negative path                    | **PASS**         | forced registry failure -> `ok: false`, no fallback (isolation-negative-test.md)                                                            |
| 3   | Registration + discovery + resume          | **PASS**         | persisted `storages/workspace.json`                                                                                                         |
| 4   | Real Chromium boots the UI                 | **PASS**         | `browser-acceptance.mjs`: composer, workspace indicator, composer workspace control, model picker; 0 console errors; no failed-to-load card |
| 5   | Our custom sidebar loads                   | **FAIL**         | thread-sidebar fails to import in the minimal scratch profile                                                                               |
| 6   | Thread creation in the browser             | **BLOCKED by 5** | —                                                                                                                                           |
| 7   | Sidebar grouping under the project         | **BLOCKED by 5** | read `thread-sidebar/src/client-entry.tsx`                                                                                                  |
| 8   | Real agent request/response                | **NOT RUN**      | needs a provider in the scratch home                                                                                                        |
| 9   | Second thread, switch, refresh, resume     | **NOT RUN**      | —                                                                                                                                           |
| 10  | Composer / panel / timeline / settings     | **PARTIAL**      | composer renders; panel + timeline blocked by 5                                                                                             |
| 11  | Multi-tab SSE                              | **NOT RUN**      | —                                                                                                                                           |
| 12  | LKG broken-deployment recovery             | **NOT RUN**      | —                                                                                                                                           |
| 13  | Fresh-checkout build/typecheck/regressions | **NOT RUN**      | —                                                                                                                                           |
| 14  | Promotion + rollback commands              | **NOT RUN**      | —                                                                                                                                           |

## Next command

The sidebar's transitive deps are the blocker. Find them, add them to the
scratch profile in `browser-acceptance.mjs`, and re-run:

```sh
node -e "console.log(JSON.stringify(require('./plugins/@dshfiles/thread-sidebar/package.json').dependencies,null,1))"
fnm exec --using=22.23.3 node scripts/release/browser-acceptance.mjs
```
