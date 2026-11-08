# @dshfiles/jj-cli

The Effect service Host plugins use to run the [Jujutsu](https://jj-vcs.github.io) CLI. It replaces the runner,
`jj <verb>` span and operation-head read cache that `jj-integration` and `jujutsu` each carry. It is a plain library:
bundle it into a Host entry (`host.bundleDependencies`); it depends only on `effect` and never on a plugin.

## Services

| Service       | Method          | Result                                                                                                   |
| ------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `Jj`          | `run(command)`  | `JjOutput`; a non-zero exit is a value. Fails `JjSpawnFailed \| JjTimedOut \| JjOutputTruncated`.        |
| `Jj`          | `exec(command)` | `JjOutput` on exit 0, otherwise `JjCommandFailed` with flag-value-redacted `args` and redacted `stderr`. |
| `JjViewReads` | `read(command)` | `run` for `--ignore-working-copy` view reads, memoized per operation head; other commands run uncached.  |

`Jj` needs `ChildProcessSpawner` (`effect/process`), `FileSystem` and `Path`. Host plugins get a DSH-backed spawner from
dshx; tests use `NodeServices.layer` from `@effect/platform-node`.

```ts
const program = Effect.gen(function* () {
  const jj = yield* Jj
  const output = yield* jj.exec({ args: ['--ignore-working-copy', 'workspace', 'list'], cwd })
  return output.stdout
})

program.pipe(Effect.provide(Layer.provideMerge(JjViewReads.layer, Jj.layer)))
```

Every run:

- resolves `jj` once from `PATH` (or `Jj.layerWith({ executable })`), rejects a relative or NUL-bearing path, and
  retries resolution after a failure instead of caching it;
- runs `jj --color=never --no-pager …` with stdin ignored, stdout capped at 1.16 MB (`maxStdoutBytes`; `onStdoutLimit:
'truncate'` keeps the head instead of failing) and stderr at 64 KB;
- stops after 30 s (`timeout` per command or layer) and kills the process group, with a 1.5 s grace before `SIGKILL`,
  on timeout or when the caller is interrupted;
- is one `jj <verb>` client span with the attributes of the dshx `commandAttributes` helper (verb, flag names, argument
  count, never values or paths) plus `process.exit.code` and `jj.output.truncated`.

`JjViewReads` keys a read by the store's `op_heads/heads` listing, read before the command runs, so the next operation
misses the cache. Entries the moved head made unreachable are invalidated for that store only, never globally, so a
long-lived Host does not retain every result it ever computed (a `diff`/`show` read can be 1.16 MB). Concurrent
identical reads share one process; it keeps running while any caller still waits and stops when the last one is
interrupted. Only exit-0 results are cached.

`redactJjStderr` removes URL credentials, authorization values and secret-looking assignments: remote helpers can
print credential-bearing URLs.
