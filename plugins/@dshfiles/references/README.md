# @dshfiles/references

Named outside directories or git repositories attached to a thread, so the agent reads documentation, another
project or an upstream source without the thread running there. Host only: slash command, agent tools and runtime
context, no screen of its own.

- **Save** a reference by name: an absolute directory (or `~/…`) is read where it is; a git URL (`https://`,
  `ssh://`, `git@host:…`, `file://`) is shallow-cloned at an optional branch or tag into
  `$DSH_HOME/references/<name>`. Saving a name again replaces it (and clones again).
- **Attach** it to a thread. Every attached reference is listed with its absolute path and origin in that thread's
  runtime context from the next model request, marked read-only. Detaching stops it; the saved reference stays.
- **Remove** forgets it and detaches it everywhere; its clone is deleted, a directory is never touched.

```text
/reference                                          list (● attached to this thread)
/reference save opencode https://github.com/anomalyco/opencode dev
/reference attach docs
/reference detach docs
```

`save` attaches the new reference to the thread that ran it. Agent tools: `references_list` (read-only),
`reference_save`, `reference_attach`, `reference_detach` and `reference_remove` (needs `confirm: true`); the write
tools say to run only when the user asked. References and attachments live in the `dshfiles_references` storage
domain, so they survive a Host restart.

Limits: a reference is not a sandbox grant — a sandbox mode that forbids reading outside the workspace still
refuses those reads. A git clone is not refreshed on its own; save it again to update it.

## Verify

```sh
pnpm --dir plugins/@dshfiles/references test   # real directories and file:// git clones
```
