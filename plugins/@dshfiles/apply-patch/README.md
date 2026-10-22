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
missing, unchanged, sequential and CRLF cases. After a build, the Host bundle is
import-checked like any other plugin bundle.
