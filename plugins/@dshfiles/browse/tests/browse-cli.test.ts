import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { DshxPlugin, HostContext, tracerLayer } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Schedule } from 'effect'
import { BrowseCli } from '../src/browse-cli.js'
import type { Pairing } from '../src/model.js'
import { BrowsePairing } from '../src/pairing.js'
import { Browse } from '../src/service.js'
import { BROWSE_SETTINGS_DEFAULTS, browseSettings, type BrowseSettings } from '../src/settings.js'

/**
 * A stand-in `browse` on PATH: it answers the verbs the plugin runs with captured 0.1.5 output, logs every argv, and its
 * `pair` behaviour comes from a `mode` file so one script covers paired, expired, failed and waiting runs.
 */
const FAKE_BROWSE = `#!/bin/sh
dir=$(/usr/bin/dirname "$0")
mode=$(/bin/cat "$dir/mode" 2>/dev/null)
echo "$*" >> "$dir/calls"
case "$1 $2" in
  "status --json") /bin/cat "$dir/status.json"; exit 0 ;;
  "pair --list") /bin/cat "$dir/pair-list.txt"; exit 0 ;;
  "pair --revoke") if [ "$3" = "brave-clements-macbook-pro" ]; then echo "✓ Unpaired Brave"; exit 0; fi; echo "No paired browser"; exit 1 ;;
  "pair --wait-seconds")
    if [ "$mode" = "nocode" ]; then echo "Error: the relay did not start" >&2; exit 3; fi
    echo "Pairing code: K7QD-M2XP"
    echo "Open the Extensions menu → browse → Options, expand advanced (or click Pair with a code), enter K7QD-M2XP as the pairing code, then click Connect. It works once, within 10 minutes."
    echo "Waiting up to $3s for that browser. Later, \\\`browse pair --list\\\` shows paired browsers."
    case "$mode" in
      paired) /bin/sleep 0.3; echo "✓ Paired Fake Browser."; exit 0 ;;
      expire) /bin/sleep 0.3; echo "! Pairing not confirmed. For a fresh code run \\\`browse pair\\\`."; exit 1 ;;
      *) /bin/sleep 30; exit 1 ;;
    esac ;;
esac
exit 2
`

let fakeDirectory = ''
let originalPath: string | undefined

const fixture = (name: string): string => new URL(`./fixtures/${name}`, import.meta.url).pathname

beforeAll(() => {
  fakeDirectory = mkdtempSync(join(tmpdir(), 'dshfiles-browse-fake-'))
  writeFileSync(join(fakeDirectory, 'browse'), FAKE_BROWSE)
  chmodSync(join(fakeDirectory, 'browse'), 0o755)
  copyFileSync(fixture('status-running.json'), join(fakeDirectory, 'status.json'))
  copyFileSync(fixture('pair-list.txt'), join(fakeDirectory, 'pair-list.txt'))
  originalPath = process.env.PATH
  process.env.PATH = `${fakeDirectory}:${originalPath ?? ''}`
})

afterAll(() => {
  process.env.PATH = originalPath
  rmSync(fakeDirectory, { recursive: true, force: true })
})

const setMode = (mode: 'paired' | 'expire' | 'wait' | 'nocode') => Effect.sync(() => writeFileSync(join(fakeDirectory, 'mode'), mode))
const calls = (): readonly string[] => {
  try {
    return readFileSync(join(fakeDirectory, 'calls'), 'utf8').trim().split('\n')
  } catch {
    return []
  }
}
const clearCalls = Effect.sync(() => writeFileSync(join(fakeDirectory, 'calls'), ''))

/** The plugin's real services over a real in-memory DSH Host and its local subprocess runtime. */
const services = (command: string) =>
  Effect.gen(function* () {
    const host = yield* Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      created => Effect.promise(() => created.dispose()),
    )
    yield* Effect.promise(() => host.ctx.plugin(LocalSubprocessRuntime))
    const built = yield* Layer.build(
      Browse.layer.pipe(
        Layer.provideMerge(BrowsePairing.layer),
        Layer.provideMerge(BrowseCli.layer),
        Layer.provide(
          Layer.mergeAll(
            DshChildProcessSpawner.layer,
            NodeFileSystem.layer,
            NodePath.layer,
            Settings.layerTest<BrowseSettings>(browseSettings.namespace, { ...BROWSE_SETTINGS_DEFAULTS, command }),
          ),
        ),
        Layer.provide(HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/browse' })),
      ),
    )
    return { browse: Context.get(built, Browse), pairing: Context.get(built, BrowsePairing) }
  }).pipe(Effect.provide(DshxPlugin.processEnvConfig))

const settled = (pairing: Effect.Effect<Pairing>) =>
  pairing.pipe(Effect.repeat({ until: current => current.state !== 'pending' && current.state !== 'idle', schedule: Schedule.spaced('50 millis') }))

describe('browse status through the CLI', () => {
  it.live('reads the relay from the browse on PATH, runs only `status --json` and records one span', () =>
    Effect.gen(function* () {
      using recorder = recordSpans()
      yield* clearCalls
      const { browse } = yield* services('browse')
      const status = yield* browse.status.pipe(Effect.provide(tracerLayer))
      expect(status).toMatchObject({ kind: 'ready', version: '0.1.5', relay: { running: true }, browsers: [{ id: 'brave-clements-macbook-pro' }] })
      expect(calls()).toEqual(['status --json'])
      expect(recorder.span('browse status').attributes).toMatchObject({ 'dshx.browse.verb': 'status', 'process.exit.code': 0 })
    }).pipe(Effect.scoped),
  )

  it.live('says browse is not installed, with the install recovery, when the command is nowhere', () =>
    Effect.gen(function* () {
      const { browse } = yield* services('browse-not-a-real-command')
      const status = yield* browse.status
      expect(status.kind).toBe('not-installed')
      if (status.kind !== 'not-installed') return
      expect(status.command).toBe('browse-not-a-real-command')
      expect(status.recovery).toContain('curl -fsSL https://opencode.ai/browse/install | bash')
    }).pipe(Effect.scoped),
  )

  it.live('lists paired browsers and unpairs only a browser that exists', () =>
    Effect.gen(function* () {
      using recorder = recordSpans()
      const { browse } = yield* services('browse')
      const pairings = yield* browse.pairings.pipe(Effect.provide(tracerLayer))
      expect(pairings.browsers.map(browser => browser.id)).toEqual(['brave-clements-macbook-pro'])
      expect(recorder.span('browse pair list').attributes['process.exit.code']).toBe(0)
      expect((yield* browse.revoke('brave-clements-macbook-pro')).revoked).toBe(true)
      expect(yield* browse.revoke('nobody')).toMatchObject({ revoked: false })
    }).pipe(Effect.scoped),
  )
})

describe('pairing lifecycle', () => {
  it.live('returns the code at once, then reports the paired browser', () =>
    Effect.gen(function* () {
      using recorder = recordSpans()
      yield* setMode('paired')
      const { browse, pairing } = yield* services('browse')
      const started = yield* pairing.start.pipe(Effect.provide(tracerLayer))
      expect(started).toMatchObject({ state: 'pending', code: 'K7QD-M2XP' })
      expect(started.instructions).toContain('Extensions menu')
      const ended = yield* settled(pairing.current)
      expect(ended).toMatchObject({ state: 'paired', browser: 'Fake Browser', code: null })
      expect((yield* browse.status).pairing.state).toBe('paired')
      expect(recorder.span('browse pair').attributes).toMatchObject({ 'process.exit.code': 0, 'dshx.browse.paired': true })
    }).pipe(Effect.scoped),
  )

  it.live('reports an expired code when no browser redeemed it', () =>
    Effect.gen(function* () {
      yield* setMode('expire')
      const { pairing } = yield* services('browse')
      expect((yield* pairing.start).state).toBe('pending')
      expect(yield* settled(pairing.current)).toMatchObject({ state: 'expired', code: 'K7QD-M2XP' })
    }).pipe(Effect.scoped),
  )

  it.live('keeps one pairing at a time, cancels it, and can start again', () =>
    Effect.gen(function* () {
      yield* setMode('wait')
      yield* clearCalls
      const { pairing } = yield* services('browse')
      const first = yield* pairing.start
      const second = yield* pairing.start
      expect(second).toEqual(first)
      expect(calls().filter(call => call.startsWith('pair --wait-seconds'))).toEqual(['pair --wait-seconds 600'])
      expect(yield* pairing.cancel).toMatchObject({ state: 'cancelled' })
      expect((yield* pairing.start).state).toBe('pending')
      yield* pairing.cancel
    }).pipe(Effect.scoped),
  )

  it.live('fails with a recovery when browse pair prints no code', () =>
    Effect.gen(function* () {
      yield* setMode('nocode')
      const { pairing } = yield* services('browse')
      const error = yield* Effect.flip(pairing.start)
      expect(error._tag).toBe('BrowsePairingFailed')
      const current = yield* pairing.current
      expect(current.state).toBe('failed')
      expect(current.message).toContain('browse pair')
    }).pipe(Effect.scoped),
  )
})
