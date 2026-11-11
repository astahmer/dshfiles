import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeServices } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import { PackControls, type PackManagerSurface } from './pack-controls.js'

const scratch = mkdtempSync(join(tmpdir(), 'onboarding-packs-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const home = join(scratch, 'dsh-home')
const calls = join(scratch, 'dshx-calls.log')

/** A dshfiles checkout whose dshx CLI records each call and answers like `dshx add --json`; `session-undo` fails. */
const checkout = (): string => {
  const root = join(scratch, 'dshfiles')
  mkdirSync(join(root, 'plugins', '@dshfiles', 'onboarding'), { recursive: true })
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'scripts', 'profile-sync.ts'), '')
  const bin = join(root, 'tooling', 'dshx', 'packages', 'dshx', 'dist', 'cli')
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, 'bin.js'),
    `const fs = require('node:fs')
const [, , command, pkg, , profile, , dshHome] = process.argv
fs.appendFileSync(${JSON.stringify(calls)}, [command, pkg, profile].join(' ') + '\\n')
if (pkg === '@dshfiles/session-undo') {
  console.log(JSON.stringify({ schemaVersion: 1, command, ok: false, error: { message: 'pnpm install failed in ' + dshHome + '/profiles/' + profile, hint: 'Check the network.' } }))
  process.exit(1)
}
console.log(JSON.stringify({ schemaVersion: 1, command, ok: true, data: { files: [{ path: dshHome, change: 'updated' }], restart: 'Restart the DSH host process', warnings: [] } }))
`,
  )
  return root
}

interface Row {
  readonly entryId: string
  readonly moduleName: string
  enabled: boolean
}

/** A plugin manager over rows in memory; `setPluginEnabled` answers with the verdict the test names. */
const manager = (input: {
  readonly rows: Row[]
  readonly verdict?: 'applied' | 'restart-required' | 'overridden'
  readonly source?: string | undefined
}): PackManagerSurface<string> & { readonly writes: string[] } => {
  const writes: string[] = []
  const source = input.source
  return {
    writes,
    listPlugins: async () => input.rows.map(row => ({ ...row })),
    setPluginEnabled: async (id, enabled) => {
      writes.push(`${id}=${String(enabled)}`)
      const row = input.rows.find(candidate => candidate.entryId === id)
      if (row !== undefined) row.enabled = enabled
      const verdict = input.verdict ?? 'applied'
      return verdict === 'restart-required' ? { changed: true, application: verdict, restartReason: 'no-hmr' } : { changed: true, application: verdict }
    },
    listBundles: async () => (source === undefined ? [{ name: '@dshfiles/onboarding' }] : [{ name: '@dshfiles/onboarding', source }]),
  }
}

const versioningRows = (): Row[] => [
  { entryId: 'include:dshfiles-jj-integration', moduleName: '@dshfiles/jj-integration', enabled: true },
  { entryId: 'include:dshfiles-jujutsu', moduleName: '@dshfiles/jujutsu', enabled: false },
]

const run = <A>(input: { readonly found: PackManagerSurface<string> }, use: (controls: PackControls['Service']) => Effect.Effect<A>) =>
  Effect.runPromise(
    PackControls.use(use).pipe(
      Effect.provide(
        PackControls.layerFrom({
          manager: () => input.found,
          profile: () => ({ name: 'scratch', home }),
          homeFromEnv: false,
          nodeExecutable: process.execPath,
        }).pipe(Layer.provide(NodeServices.layer)),
      ),
      Effect.provide(DshxEffect.tracerLayer),
    ),
  )

const prerequisites = new Map<string, 'done' | 'todo' | 'unknown' | 'off'>()
const linked = () => `link:${join(checkout(), 'plugins', '@dshfiles', 'onboarding')}`

describe('pack controls', () => {
  it('previews without changing a row or running dshx', async () => {
    rmSync(calls, { force: true })
    const found = manager({ rows: versioningRows(), source: linked() })
    const preview = await run({ found }, controls => controls.preview({ pack: 'versioning', action: 'enable', prerequisites }))
    expect(preview).toMatchObject({ installMode: 'automatic', change: [{ plugin: 'jujutsu' }] })
    expect(preview.install.map(step => step.plugin)).toEqual(['diff-viewed', 'session-undo'])
    expect(found.writes).toEqual([])
    expect(existsSync(calls)).toBe(false)
  })

  it('switches rows through the plugin manager, installs one package at a time and reports a partial install as partial', async () => {
    rmSync(calls, { force: true })
    using recorder = recordSpans()
    const found = manager({ rows: versioningRows(), source: linked() })
    const outcome = await run({ found }, controls => controls.apply({ pack: 'versioning', action: 'enable', prerequisites }))
    expect(found.writes).toEqual(['include:dshfiles-jujutsu=true'])
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(['add @dshfiles/diff-viewed scratch', 'add @dshfiles/session-undo scratch'])
    expect(outcome.results.map(result => [result.plugin, result.status, result.restartReason])).toEqual([
      ['jujutsu', 'applied', null],
      ['diff-viewed', 'restart-required', 'Restart the DSH host process'],
      ['session-undo', 'failed', null],
    ])
    expect(outcome.summary.kind).toBe('partial')
    expect(outcome.summary.message).toContain('Installed now: diff-viewed. Not installed: session-undo.')
    const failure = outcome.results.at(-1)?.detail ?? ''
    expect(failure).toContain('$DSH_HOME/profiles/scratch')
    expect(failure).not.toContain(home)
    expect(recorder.span('onboarding dshx add').attributes).toMatchObject({ 'onboarding.plugin': 'diff-viewed', 'process.executable.name': 'dshx' })
  })

  it('relays the plugin manager verdict instead of inventing one, and enable then disable restores the rows', async () => {
    const rows = versioningRows()
    const later = manager({ rows, verdict: 'restart-required' })
    const enabled = await run({ found: later }, controls => controls.apply({ pack: 'versioning', action: 'enable', prerequisites, plugins: ['jujutsu'] }))
    expect(enabled.results).toEqual([{ plugin: 'jujutsu', step: 'enable', status: 'restart-required', restartReason: 'no-hmr', detail: null }])
    const overridden = await run({ found: manager({ rows: versioningRows(), verdict: 'overridden' }) }, controls =>
      controls.apply({ pack: 'versioning', action: 'enable', prerequisites, plugins: ['jujutsu'] }),
    )
    expect(overridden.results[0]?.status).toBe('overridden')
    const disabled = await run({ found: manager({ rows }) }, controls => controls.apply({ pack: 'versioning', action: 'disable', prerequisites }))
    expect(disabled.results.map(result => [result.plugin, result.status])).toEqual([
      ['jj-integration', 'applied'],
      ['jujutsu', 'applied'],
    ])
    const restored = await run({ found: manager({ rows }) }, controls =>
      controls.apply({ pack: 'versioning', action: 'enable', prerequisites, plugins: ['jj-integration'] }),
    )
    expect(restored.summary.kind).toBe('applied')
    expect(rows.map(row => row.enabled)).toEqual([true, false])
  })

  it('degrades to the exact command to copy when the profile is not linked from a checkout, and runs nothing', async () => {
    rmSync(calls, { force: true })
    const found = manager({ rows: versioningRows() })
    const outcome = await run({ found }, controls => controls.apply({ pack: 'versioning', action: 'enable', prerequisites, plugins: ['session-undo'] }))
    expect(outcome.preview).toMatchObject({ installMode: 'manual', manualReason: expect.stringMatching(/not link Getting started/u) })
    expect(outcome.results).toEqual([
      { plugin: 'session-undo', step: 'install', status: 'manual', restartReason: null, detail: expect.stringMatching(/not link/u) },
    ])
    expect(outcome.summary).toMatchObject({ kind: 'manual' })
    expect(outcome.summary.nextActions[0]).toContain('node tooling/dshx/packages/dshx/dist/cli/bin.js add @dshfiles/session-undo --profile scratch')
    expect(existsSync(calls)).toBe(false)
    expect(found.writes).toEqual([])
  })

  it('does nothing for an up-to-date pack', async () => {
    const rows = ['traces', 'activity-timeline', 'preview', 'hmr-gate'].map(name => ({
      entryId: `include:dshfiles-${name}`,
      moduleName: `@dshfiles/${name}`,
      enabled: true,
    }))
    const found = manager({ rows })
    const outcome = await run({ found }, controls => controls.apply({ pack: 'observe', action: 'enable', prerequisites }))
    expect(outcome).toMatchObject({ results: [], summary: { kind: 'up-to-date' } })
    expect(found.writes).toEqual([])
  })
})
