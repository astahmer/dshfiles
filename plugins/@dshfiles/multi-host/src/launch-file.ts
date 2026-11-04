import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, type PlatformError, Schema, type Scope } from 'effect'
import { MultiHostPaths } from './paths.js'
import { PrivateFile } from './private-file.js'

/**
 * Where a running DSH tells a multi-host manager how to reach it: the tokenized loopback launch URL, written 0600 by
 * the runtime's own multi-host Host. `runtime/web-url` is the same fact written by the dsh-web supervisor, read when
 * the runtime has no multi-host plugin. Replaces scraping the systemd journal, so any Unix host with SSH works.
 */
const launchFilePaths = (dshHome: string): readonly [string, string] => [
  join(dshHome, 'plugins', 'multi-host', 'launch.json'),
  join(dshHome, 'runtime', 'web-url'),
]

const launchUrlSchema = Schema.Trim.check(Schema.isPattern(/^http:\/\/127\.0\.0\.1:\d{1,5}\/\?token=[A-Za-z0-9._~-]{8,512}$/))
const launchRecordSchema = Schema.StructWithRest(
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    launchUrl: launchUrlSchema,
    pid: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
const decodeRecord = Schema.decodeUnknownOption(Schema.fromJsonString(launchRecordSchema))
const decodeUrl = Schema.decodeUnknownOption(launchUrlSchema)
const decodeLaunchUrl = Schema.decodeUnknownEffect(launchUrlSchema)

type LaunchFileWriteError = Schema.SchemaError | PlatformError.PlatformError

export type RuntimeLaunch = { readonly port: number; readonly token: string }

/** Decode either launch file: the JSON record or a bare URL line. Anything else reads as no launch. */
const parseRuntimeLaunch = (content: string): RuntimeLaunch | undefined => {
  const url = Option.getOrUndefined(
    Option.orElse(
      Option.map(decodeRecord(content), record => record.launchUrl),
      () => decodeUrl(content.split('\n', 1)[0] ?? ''),
    ),
  )
  if (url === undefined) return undefined
  const parsed = new URL(url)
  const port = Number(parsed.port)
  const token = parsed.searchParams.get('token')
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || token === null) return undefined
  return { port, token }
}

const ownedBy = (content: string | undefined, pid: number): boolean =>
  content !== undefined && Option.match(decodeRecord(content), { onNone: () => false, onSome: record => record.pid === pid })

/** On a process exit the plugin never disposed, only synchronous file calls still run. */
const removeOwnedSync = (path: string): void => {
  try {
    if (ownedBy(readFileSync(path, 'utf8'), process.pid)) rmSync(path, { force: true })
  } catch {
    // Unreadable or already gone: nothing of ours to remove.
  }
}

export class RuntimeLaunchFile {
  static readonly launchFilePaths = launchFilePaths
  static readonly parseRuntimeLaunch = parseRuntimeLaunch
}

/** This runtime's launch file: written while the plugin runs, removed when it unloads or the process exits. */
export class LaunchFile extends Context.Service<
  LaunchFile,
  {
    /** Write a launch record for `launchUrl` into `dshHome`, returning its path. */
    readonly write: (input: { readonly dshHome: string; readonly launchUrl: string }) => Effect.Effect<string, LaunchFileWriteError>
    /** Remove the record only while it still names this process, so a newer runtime's record survives. */
    readonly removeIfOwned: (path: string) => Effect.Effect<void>
    /** Publish this runtime's launch URL for the Scope; a failed write is logged, never fatal. */
    readonly publish: (launchUrl: string) => Effect.Effect<void, never, Scope.Scope>
  }
>()('@dshfiles/multi-host/LaunchFile') {
  static readonly layer = Layer.effect(
    LaunchFile,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const paths = yield* MultiHostPaths

      const write = Effect.fn('multi-host launch file write')(function* (input: { readonly dshHome: string; readonly launchUrl: string }) {
        const [launchPath] = launchFilePaths(input.dshHome)
        const launchUrl = yield* decodeLaunchUrl(input.launchUrl)
        const record = { schemaVersion: 1, launchUrl, pid: process.pid, writtenAt: DateTime.formatIso(yield* DateTime.now) }
        yield* PrivateFile.write({ path: launchPath, body: `${JSON.stringify(record)}\n`, commit: 'rename' }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        )
        return launchPath
      })

      const removeIfOwned = (launchPath: string) =>
        PrivateFile.readIfPresent(launchPath).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.flatMap(content => (ownedBy(content, process.pid) ? fileSystem.remove(launchPath, { force: true }) : Effect.void)),
          Effect.ignore,
        )

      const publish = (launchUrl: string) =>
        Effect.acquireRelease(
          Effect.gen(function* () {
            const launchPath = yield* write({ dshHome: paths.dshHome, launchUrl })
            // DSH can exit on a signal without disposing plugins; a stale launch file would point managers at a dead port.
            const onExit = (): void => removeOwnedSync(launchPath)
            process.once('exit', onExit)
            return { launchPath, onExit }
          }),
          published =>
            Effect.andThen(
              Effect.sync(() => process.off('exit', published.onExit)),
              removeIfOwned(published.launchPath),
            ),
        ).pipe(
          Effect.asVoid,
          Effect.catchCause(cause => Effect.logWarning('multi-host could not publish its launch file', cause)),
        )

      return LaunchFile.of({ write, removeIfOwned, publish })
    }),
  )
}
