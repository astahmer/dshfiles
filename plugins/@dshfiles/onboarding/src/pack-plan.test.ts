import { describe, expect, it } from 'vitest'
import { PackChangeFlow, type PackChangeState } from './pack-change-flow.js'
import { PackPlan, type PluginEntryFact, type PreviewInput, type StepResult } from './pack-plan.js'

const entry = (plugin: string, enabled: boolean, readOnlyReason: string | null = null): PluginEntryFact => ({
  entryId: `include:dshfiles-${plugin}`,
  plugin,
  moduleName: `@dshfiles/${plugin}`,
  enabled,
  readOnlyReason,
})

const input = (overrides: Partial<PreviewInput> = {}): PreviewInput => ({
  pack: 'versioning',
  action: 'enable',
  entries: [entry('jj-integration', true), entry('jujutsu', false), entry('diff-viewed', true, 'management-required')],
  toolchain: { kind: 'automatic' },
  profile: 'scratch',
  homeFromEnv: false,
  prerequisites: new Map([['project', 'done']]),
  ...overrides,
})

describe('pack preview', () => {
  it('names the packages to install, the rows to enable, the rows already fine and the prerequisites', () => {
    const preview = PackPlan.preview(input())
    expect(preview).toMatchObject({
      unavailable: null,
      upToDate: false,
      installMode: 'automatic',
      install: [{ plugin: 'session-undo', command: 'node tooling/dshx/packages/dshx/dist/cli/bin.js add @dshfiles/session-undo --profile scratch' }],
      change: [{ plugin: 'jujutsu', entryIds: ['include:dshfiles-jujutsu'] }],
      fine: [
        { plugin: 'jj-integration', state: 'enabled' },
        { plugin: 'diff-viewed', state: 'enabled' },
      ],
      prerequisites: [
        { id: 'project', state: 'done' },
        { id: 'repository', state: 'unknown' },
      ],
      restart: 'required',
    })
    expect(PackPlan.stepsOf(preview)).toEqual(['jujutsu', 'session-undo'])
  })

  it('is up to date when every plugin already runs, and does nothing', () => {
    const preview = PackPlan.preview(input({ pack: 'observe', entries: ['traces', 'activity-timeline', 'preview', 'hmr-gate'].map(name => entry(name, true)) }))
    expect(preview).toMatchObject({ upToDate: true, restart: 'none', install: [], change: [] })
    expect(PackPlan.stepsOf(preview)).toEqual([])
    expect(PackPlan.summarize({ preview, results: [] })).toMatchObject({ kind: 'up-to-date' })
  })

  it('never disables Core, and disables only what runs', () => {
    expect(PackPlan.preview(input({ pack: 'core', action: 'disable' })).unavailable).toMatch(/Core pack stays on/u)
    const planning = ['backlog', 'backlog-jira', 'backlog-notion', 'goal-tool', 'schedule', 'queue-reorder']
    const preview = PackPlan.preview(
      input({
        pack: 'planning',
        action: 'disable',
        entries: [...planning.map(name => entry(name, true)), entry('thread-sidebar', true), entry('memory', false)],
      }),
    )
    expect(preview.change.map(step => step.plugin)).toEqual(planning)
    const partly = PackPlan.preview(input({ pack: 'accounts', action: 'disable', entries: [entry('ai-accounts', true), entry('usage', false)] }))
    expect(partly.change.map(step => step.plugin)).toEqual(['ai-accounts'])
    expect(partly.fine).toEqual([
      { plugin: 'usage', state: 'disabled' },
      { plugin: 'context-compaction', state: 'not-installed' },
      { plugin: 'tool-search', state: 'not-installed' },
    ])
    expect(PackPlan.preview(input({ pack: 'nope' })).unavailable).toMatch(/No pack named nope/u)
    expect(PackPlan.preview(input({ entries: null })).unavailable).toMatch(/no plugin manager/u)
  })

  it('lists the exact command to copy when the toolchain cannot be reached, naming $DSH_HOME and never a path', () => {
    const preview = PackPlan.preview(input({ toolchain: { kind: 'manual', reason: 'Not linked.' }, homeFromEnv: true }))
    expect(preview).toMatchObject({ installMode: 'manual', manualReason: 'Not linked.' })
    expect(preview.install[0]?.command).toBe('node tooling/dshx/packages/dshx/dist/cli/bin.js add @dshfiles/session-undo --profile scratch --home "$DSH_HOME"')
  })
})

const result = (plugin: string, status: StepResult['status'], restartReason: string | null = null): StepResult => ({
  plugin,
  step: 'install',
  status,
  restartReason,
  detail: null,
})

describe('pack outcome', () => {
  const preview = PackPlan.preview(input())

  it('reports a partial install as partial, with what is installed now and the command for the rest', () => {
    const summary = PackPlan.summarize({ preview, results: [{ ...result('jujutsu', 'applied'), step: 'enable' }, result('session-undo', 'failed')] })
    expect(summary.kind).toBe('partial')
    expect(summary.message).toMatch(/^Partly done: 1 of 2/u)
    expect(summary.message).toContain('Not installed: session-undo.')
    expect(summary.nextActions[0]).toContain('add @dshfiles/session-undo --profile scratch')
  })

  it('relays restart-required with the reason it was given, and claims no restart for live changes', () => {
    const live = PackPlan.summarize({ preview, results: [{ ...result('jujutsu', 'applied'), step: 'enable' }] })
    expect(live).toMatchObject({ kind: 'applied', nextActions: [] })
    const later = PackPlan.summarize({ preview, results: [{ ...result('jujutsu', 'restart-required', 'no-hmr'), step: 'enable' }] })
    expect(later.kind).toBe('restart-required')
    expect(later.nextActions.at(-1)).toMatch(/Restart DSH \(bottom of the sidebar\)/u)
    expect(PackPlan.renderOutcome({ preview, results: [{ ...result('jujutsu', 'restart-required', 'no-hmr'), step: 'enable' }], summary: later })).toContain(
      'restart reason: no-hmr',
    )
  })

  it('reports manual installs as manual, and an overridden row with its recovery', () => {
    expect(PackPlan.summarize({ preview, results: [result('session-undo', 'manual')] }).kind).toBe('manual')
    const overridden = PackPlan.summarize({ preview, results: [{ ...result('jujutsu', 'overridden'), step: 'enable' }] })
    expect(overridden.kind).toBe('failed')
    expect(overridden.nextActions[0]).toMatch(/cordis\.patch\.yml/u)
  })
})

describe('pack change flow', () => {
  const preview = PackPlan.preview(input())
  const send = (state: PackChangeState, ...events: Parameters<typeof PackChangeFlow.transition>[1][]) => events.reduce(PackChangeFlow.transition, state)

  it('changes nothing before confirm, and works through each plugin in order', () => {
    expect(send(PackChangeFlow.initial, { type: 'cancel' })).toEqual({ phase: 'reviewing' })
    const done = send(
      PackChangeFlow.initial,
      { type: 'confirm', preview },
      { type: 'step-done', plugin: 'jujutsu', results: [{ ...result('jujutsu', 'applied'), step: 'enable' }] },
      { type: 'step-done', plugin: 'session-undo', results: [result('session-undo', 'restart-required', 'Restart the DSH host process')] },
    )
    expect(done.phase === 'finished' ? done.summary.kind : null).toBe('restart-required')
  })

  it('stops after the running plugin when cancelled, and the rest read as not started', () => {
    const stopped = send(
      PackChangeFlow.initial,
      { type: 'confirm', preview },
      { type: 'cancel' },
      { type: 'step-done', plugin: 'jujutsu', results: [{ ...result('jujutsu', 'applied'), step: 'enable' }] },
    )
    expect(stopped.phase === 'finished' ? [stopped.summary.kind, stopped.results.map(each => each.status)] : null).toEqual([
      'partial',
      ['applied', 'cancelled'],
    ])
  })

  it('stops at an unanswered call instead of stacking more changes on an unknown state', () => {
    const failed = send(PackChangeFlow.initial, { type: 'confirm', preview }, { type: 'step-failed', plugin: 'jujutsu', reason: 'offline' })
    expect(failed.phase === 'finished' ? failed.results.map(each => [each.plugin, each.status]) : null).toEqual([
      ['jujutsu', 'failed'],
      ['session-undo', 'cancelled'],
    ])
  })
})
