import { Context, Duration, Effect, FiberMap, FileSystem, Layer, Ref, Stream } from 'effect'
import { PreviewBrowsers, type PreviewSettingsView } from './browser-pool-promise.js'
import { PreviewRefused } from './preview-errors.js'
import { previewSettingsTag } from './preview-settings.js'

const SETTLE_TIMEOUT = Duration.seconds(3)

const refused = (tool: string, cause: unknown): PreviewRefused =>
  new PreviewRefused({ tool, recovery: cause instanceof Error ? cause.message : 'The preview call failed.', cause })

/**
 * The Promise edge of the Playwright page driver: every browser call is one interruption-aware Effect failing with
 * `PreviewRefused`, and a thread's idle close is a forked sleep the next page use restarts.
 */
export class PreviewPages extends Context.Service<
  PreviewPages,
  {
    readonly open: (input: Parameters<PreviewBrowsers['open']>[0]) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['open']>>, PreviewRefused>
    readonly navigate: (input: Parameters<PreviewBrowsers['navigate']>[0]) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['navigate']>>, PreviewRefused>
    readonly revealRequest: (input: Parameters<PreviewBrowsers['revealRequest']>[0]) => Effect.Effect<number | null>
    readonly snapshot: (input: Parameters<PreviewBrowsers['snapshot']>[0]) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['snapshot']>>, PreviewRefused>
    readonly frame: (input: Parameters<PreviewBrowsers['frame']>[0]) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['frame']>>, PreviewRefused>
    readonly input: (input: Parameters<PreviewBrowsers['input']>[0]) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['input']>>, PreviewRefused>
    readonly click: (input: Parameters<PreviewBrowsers['click']>[0]) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['click']>>, PreviewRefused>
    readonly type: (input: Parameters<PreviewBrowsers['type']>[0]) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['type']>>, PreviewRefused>
    readonly evaluate: (input: Parameters<PreviewBrowsers['evaluate']>[0]) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['evaluate']>>, PreviewRefused>
    readonly screenshot: (
      input: Parameters<PreviewBrowsers['screenshot']>[0],
    ) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['screenshot']>>, PreviewRefused>
    readonly renderHtml: (
      input: Parameters<PreviewBrowsers['renderHtml']>[0],
    ) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['renderHtml']>>, PreviewRefused>
    readonly close: (input: Parameters<PreviewBrowsers['close']>[0]) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['close']>>, PreviewRefused>
    readonly list: (sessionId: string) => Effect.Effect<Awaited<ReturnType<PreviewBrowsers['list']>>, PreviewRefused>
    readonly closeThread: (sessionId: string) => Effect.Effect<number>
  }
>()('@dshfiles/preview/PreviewPages') {
  static readonly layer = Layer.effect(
    PreviewPages,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const settings = yield* previewSettingsTag
      const idle = yield* FiberMap.make<string>()
      const current = yield* Ref.make<PreviewSettingsView>(yield* settings.get)
      const browsers = new PreviewBrowsers({
        settings: () => Effect.runSync(Ref.get(current)),
        touchThread: (sessionId, idleMinutes) =>
          Effect.runFork(
            Effect.scoped(
              FiberMap.run(idle, sessionId, Effect.sleep(Duration.minutes(idleMinutes)).pipe(Effect.andThen(browsers.closeThreadEffect(sessionId)))),
            ),
          ),
        settle: work =>
          Effect.runPromise(
            Effect.raceFirst(
              Effect.tryPromise(() => work).pipe(Effect.catchCause(() => Effect.succeed(undefined as never))),
              Effect.sleep(SETTLE_TIMEOUT).pipe(Effect.as(undefined as never)),
            ),
          ),
        exists: path => Effect.runSync(fs.exists(path).pipe(Effect.orElseSucceed(() => false))),
      })

      yield* settings.changes.pipe(
        Stream.runForEach(next => Ref.set(current, next)),
        Effect.forkScoped,
      )

      const call = <Value>(tool: string, run: () => Promise<Value>) => Effect.tryPromise({ try: run, catch: cause => refused(tool, cause) })

      return PreviewPages.of({
        open: input => call('preview_open', () => browsers.open(input)),
        navigate: input => call('preview_navigate', () => browsers.navigate(input)),
        revealRequest: input => Effect.sync(() => browsers.revealRequest(input)),
        snapshot: input => call('preview_snapshot', () => browsers.snapshot(input)),
        frame: input => call('preview mirror', () => browsers.frame(input)),
        input: input => call('preview mirror', () => browsers.input(input)),
        click: input => call('preview_click', () => browsers.click(input)),
        type: input => call('preview_type', () => browsers.type(input)),
        evaluate: input => call('preview_evaluate', () => browsers.evaluate(input)),
        screenshot: input => call('preview_screenshot', () => browsers.screenshot(input)),
        renderHtml: input => call('preview render', () => browsers.renderHtml(input)),
        close: input => call('preview_close', () => browsers.close(input)),
        list: sessionId => call('preview_list', () => browsers.list(sessionId)),
        closeThread: sessionId => browsers.closeThreadEffect(sessionId),
      })
    }),
  )
}
