import { describe, expect, it } from 'vitest'
import { FIELD, WhatsNewModel, type WhatsNewReady } from './whats-new-model.js'

const owned = new Set(['backlog', 'onboarding', 'jj-integration', 'home'])
const line = (commit: string, date: string, title: string): string => [commit, date, title].join(FIELD)
const C1 = 'a'.repeat(40)
const C2 = 'b'.repeat(40)
const C3 = 'c'.repeat(40)
const C4 = 'd'.repeat(40)

describe('What’s new history parser', () => {
  it('reads jj lines (UTC) and git lines (offset) into one newest-first list', () => {
    const jj = [line(C1, '2026-11-10T09:00:00Z', 'feat(backlog): capture from the composer')].join('\n')
    const git = [line(C2, '2026-11-11T10:30:00+01:00', 'fix(onboarding): keep the wizard closed')].join('\n')
    expect(WhatsNewModel.parseLog({ output: `${jj}\n${git}\n`, owned })).toEqual([
      { commit: 'bbbbbbbbbbbb', plugin: 'onboarding', kind: 'fix', breaking: false, summary: 'keep the wizard closed', date: '2026-11-11T09:30:00.000Z' },
      { commit: 'aaaaaaaaaaaa', plugin: 'backlog', kind: 'feat', breaking: false, summary: 'capture from the composer', date: '2026-11-10T09:00:00.000Z' },
    ])
  })

  it('keeps feat and fix scoped to an owned plugin, one entry per owned scope, and drops everything else', () => {
    const output = [
      line(C1, '2026-11-10T09:00:00Z', 'fix(jj-integration,home): resolve a draft workspace'),
      line(C2, '2026-11-10T08:00:00Z', 'feat(backlog)!: rename the item kinds'),
      line(C3, '2026-11-10T07:00:00Z', 'chore(backlog): regenerate the catalog'),
      line(C3, '2026-11-10T07:00:00Z', 'docs(onboarding): describe packs'),
      line(C3, '2026-11-10T07:00:00Z', 'refactor(backlog): split the store'),
      line(C4, '2026-11-10T06:00:00Z', 'feat(dshx): not an owned plugin directory'),
      line(C4, '2026-11-10T06:00:00Z', 'feat: no scope at all'),
    ].join('\n')
    expect(WhatsNewModel.parseLog({ output, owned }).map(entry => [entry.plugin, entry.kind, entry.breaking])).toEqual([
      ['jj-integration', 'fix', false],
      ['home', 'fix', false],
      ['backlog', 'feat', true],
    ])
  })

  it('drops malformed lines instead of guessing', () => {
    const output = [
      'not a history line',
      line('zzzz', '2026-11-10T09:00:00Z', 'feat(backlog): bad commit id'),
      line(C1, 'yesterday', 'feat(backlog): bad date'),
      [C1, '2026-11-10T09:00:00Z'].join(FIELD),
      [C1, '2026-11-10T09:00:00Z', 'feat(backlog): one field too many', 'extra'].join(FIELD),
      line(C1, '2026-11-10T09:00:00Z', 'feat(backlog):'),
      '',
      line(C2, '2026-11-10T09:00:00Z', 'feat(backlog): the only good line'),
    ].join('\n')
    expect(WhatsNewModel.parseLog({ output, owned }).map(entry => entry.summary)).toEqual(['the only good line'])
  })
})

describe('What’s new upstream detection', () => {
  it('compares the local trunk with each remote of the same name, whatever the remotes are called', () => {
    const refs = WhatsNewModel.parseJjRefs(
      [
        `main${FIELD}${FIELD}${C1}`,
        `main${FIELD}git${FIELD}${C1}`,
        `main${FIELD}origin${FIELD}${C1}`,
        `main${FIELD}fork-source${FIELD}${C2}`,
        `feature${FIELD}fork-source${FIELD}${C3}`,
        `main${FIELD}bad remote${FIELD}${C3}`,
        `garbage`,
      ].join('\n'),
    )
    expect(WhatsNewModel.upstreamTargets({ refs, current: null })).toEqual({ bookmark: 'main', targets: [{ remote: 'fork-source', bookmark: 'main' }] })
  })

  it('reads git refs by the remote names git lists, and follows the checked-out branch', () => {
    const refs = WhatsNewModel.parseGitRefs({
      refs: [
        `refs/heads/main${FIELD}${C1}`,
        `refs/heads/work${FIELD}${C2}`,
        `refs/remotes/team/upstream/work${FIELD}${C3}`,
        `refs/remotes/team/upstream/HEAD${FIELD}${C3}`,
        `refs/remotes/stranger/work${FIELD}${C4}`,
      ].join('\n'),
      remotes: 'team/upstream\nteam\n',
    })
    expect(WhatsNewModel.upstreamTargets({ refs, current: 'work' })).toEqual({ bookmark: 'work', targets: [{ remote: 'team/upstream', bookmark: 'work' }] })
  })

  it('has no upstream without a local trunk or when every remote matches it', () => {
    expect(WhatsNewModel.upstreamTargets({ refs: [{ name: 'feature', remote: 'origin', commit: C1 }], current: null })).toEqual({ bookmark: null, targets: [] })
    expect(
      WhatsNewModel.upstreamTargets({
        refs: [
          { name: 'master', remote: null, commit: C1 },
          { name: 'master', remote: 'origin', commit: C1 },
        ],
        current: null,
      }),
    ).toEqual({ bookmark: 'master', targets: [] })
  })
})

const ready = (dates: readonly [string, string][]): WhatsNewReady => ({
  state: 'ready',
  vcs: 'jj',
  bookmark: 'main',
  entries: dates.map(([plugin, date], index) => ({
    commit: String(index).padStart(12, '0'),
    plugin,
    kind: 'feat',
    breaking: false,
    summary: `change ${String(index)}`,
    date,
  })),
  more: false,
  upstream: [],
  plugins: [
    { name: 'backlog', description: 'Backlog items.', features: 3 },
    { name: 'onboarding', description: 'Getting started.', features: 5 },
  ],
  commitsUrl: 'https://example.invalid/commits',
})

describe('What’s new windows', () => {
  const value = ready([
    ['onboarding', '2026-11-11T10:00:00.000Z'],
    ['backlog', '2026-11-10T10:00:00.000Z'],
    ['onboarding', '2026-11-09T10:00:00.000Z'],
  ])

  it('marks nothing new on a first visit, and groups by plugin newest first with its description', () => {
    const first = WhatsNewModel.window({ value, lastSeen: null })
    expect(first.newCount).toBe(0)
    expect(first.newest).toBe('2026-11-11T10:00:00.000Z')
    expect(first.groups.map(group => [group.plugin, group.description, group.entries.map(entry => entry.summary)])).toEqual([
      ['onboarding', 'Getting started.', ['change 0', 'change 2']],
      ['backlog', 'Backlog items.', ['change 1']],
    ])
    expect(first.groups.flatMap(group => group.entries).some(entry => entry.isNew)).toBe(false)
  })

  it('marks only what landed after the last seen instant, and nothing once the newest was seen', () => {
    const later = WhatsNewModel.window({ value, lastSeen: '2026-11-09T12:00:00.000Z' })
    expect(later.newCount).toBe(2)
    expect(later.groups.flatMap(group => group.entries.filter(entry => entry.isNew).map(entry => entry.summary))).toEqual(['change 0', 'change 1'])
    expect(WhatsNewModel.window({ value, lastSeen: later.newest }).newCount).toBe(0)
  })

  it('slices by plugin, since and limit on the Host', () => {
    expect(WhatsNewModel.select({ entries: value.entries, request: { plugin: 'onboarding', limit: 1 } })).toMatchObject({
      entries: [{ summary: 'change 0' }],
      more: true,
    })
    expect(WhatsNewModel.select({ entries: value.entries, request: { since: '2026-11-10T11:00:00+02:00' } }).entries.map(entry => entry.summary)).toEqual([
      'change 0',
      'change 1',
    ])
  })
})
