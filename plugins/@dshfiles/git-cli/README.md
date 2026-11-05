# @dshfiles/git-cli

The Effect service Host plugins use to run the git CLI, the git counterpart of [`@dshfiles/jj-cli`](../jj-cli/README.md).
It replaces the git runners `jj-integration` and `git-worktrees` each carried. It is a plain library: bundle it into a
Host entry (`host.bundleDependencies`); it depends only on `effect` and never on a plugin.

## Service

| Method          | Result                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `run(command)`  | `GitOutput`; a non-zero exit is a value. Fails `GitRunFailed` (spawn, output read, timeout, truncation).         |
| `exec(command)` | Stdout on exit 0, otherwise `GitCommandFailed` with flag-value-redacted `args` and credential-redacted `stderr`. |

`Git` needs `ChildProcessSpawner` (`effect/process`). Host plugins use dshx's `DshChildProcessSpawner`, which resolves the
bare `git` through DSH's subprocess runtime; tests use `NodeServices.layer` from `@effect/platform-node`.

```ts
const program = Effect.gen(function* () {
  const git = yield* Git
  return yield* git.exec({ args: ['worktree', 'list', '--porcelain'], cwd })
})

program.pipe(Effect.provide(Git.layer))
```

Every run:

- runs `git -c core.quotePath=false …` with stdin ignored and `GIT_TERMINAL_PROMPT=0`, no editor and no pager, so it
  never waits for a terminal; `command.env` adds variables over the spawner's environment (a scratch `GIT_INDEX_FILE`);
- sets `GIT_SSH_COMMAND='ssh -o BatchMode=yes'` unless the Host environment already has `GIT_SSH_COMMAND` or `GIT_SSH`,
  so an ssh passphrase or host-key prompt fails fast instead of waiting on `/dev/tty` until the timeout. git lets this
  variable win over `core.sshCommand`: if you set a custom ssh command in git config, set `GIT_SSH_COMMAND` (with
  `-o BatchMode=yes`) in DSH's environment instead, and load keys into `ssh-agent` so batch mode can use them;
- caps stdout at 512 KB (`maxStdoutBytes`; a longer one fails as `output-truncated`, or with `onStdoutLimit: 'truncate'`
  keeps the head and sets `stdoutTruncated`) and stderr at 64 KB;
- stops after two minutes (`timeout` per command or layer) and kills the process, with a 1.5 s grace;
- is one `git <verb>` client span (first subcommand word) with value-free attributes: executable, up to two subcommand
  words, flag names, argument count and `process.exit.code`. Paths and values never reach a span.

`redactGitStderr` removes URL credentials, authorization values and secret-looking assignments: `fetch` prints remote
URLs.

```sh
pnpm --dir plugins/@dshfiles/git-cli test
```
