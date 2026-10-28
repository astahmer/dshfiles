# @dshfiles/apply-patch

One agent tool, `apply_patch`, for editing a file that was inspected without the
native `read` tool — the measured case where `edit` refuses with "file has not
been read" after an `ast-outline`, `cat`, `sed`, `rg` or `grep` look.

The tool resolves and reads the file itself, records that read on the Host's
observation policy, applies the requested literal replacements in order, and
writes exactly once. That removes two failure classes at the root: the missing
read receipt and the version mismatch between a read and a later write. Anchors
are retried with every whitespace run widened, which finds a reindented or
rewrapped block; an ambiguous or missing anchor fails before writing and names
the candidate lines.

It never creates a file and never runs when the agent has no working directory,
so the native `write` tool stays the only way to create one.

## File permissions

Each call resolves the shared `sandboxPolicy` for its calling Session and passes
that complete policy to the filesystem write. Full access is honored even when
the deployment default is `workspace-write`; a Session's `read-only` setting and
original workspace boundary are likewise enforced. Changing the current directory
does not widen that boundary. Agentless calls retain the deployment policy.

The policy service is optional for a bare filesystem. A confining filesystem
without a policy service is refused, never silently downgraded. No tool argument
can override the policy or grant an escalation.

This is Host code: rebuild the bundle, then use the normal user-controlled DSH
restart to load it. Restarting or moving a chat alone does not replace the Host.

## Usage

```jsonc
{
  "path": "plugins/@dshfiles/thread-sidebar/src/client.tsx",
  "edits": [{ "old": "const label = 'Threads'", "new": "const label = 'Sessions'" }],
}
```

The result is `{ path, exact, fuzzy, bytes, operation }`; `fuzzy` above zero
means the anchor matched only after whitespace normalisation, which is worth a
`git diff`/`jj diff` look.

## Verification

`node --run test` covers exact, ambiguous, `replaceAll`, reindented, rewrapped,
missing, unchanged, sequential and CRLF cases. The sandbox regressions mount the
real native ToolRuntime, AgentLoop, Session policy/projections, working-directory
service and SandboxedFileSystem with private fixture files. They cover mode
changes, per-Session isolation, moved directories, outside/symlink denials,
agentless fallback and a bare filesystem without a policy service.

After `node --run build`, run
`DSH_APPLY_PATCH_BUILT=1 node --run test -- tests/sandbox-policy.test.ts` to repeat
those calls through the compiled Host bundle, including its native plugin
registration and teardown. No model provider or running DSH instance is used.
