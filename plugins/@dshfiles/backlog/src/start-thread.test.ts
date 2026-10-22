import { describe, expect, it } from 'vitest'

import type { BacklogSummaryView } from './api.js'
import { BacklogViews } from './api.js'
import { StartThreadForm } from './start-thread.js'

const item = (fields: Partial<BacklogSummaryView> = {}): BacklogSummaryView =>
  BacklogViews.summary({
    id: 103,
    title: 'right click backlog item -> start a thread',
    kind: 'task',
    status: 'doing',
    project: null,
    tags: [],
    links: [],
    actors: [{ id: 'user', role: 'owner' }],
    pinned: false,
    freshness: 'fresh',
    createdAt: 1,
    lastActivityAt: 2,
    preview: '',
    proposal: null,
    attention: 'none',
    acknowledgedAt: null,
    snoozedUntil: null,
    activity: { count: 0, agents: 0, comments: 0, last: null },
    match: null,
    ...fields,
  })

const catalog = {
  default: { provider: 'opencode-go', model: 'deepseek-v4.1-flash', reasoningEffort: 'medium' },
  routableProviders: ['opencode-go', 'codex'],
  failures: [],
  groups: [
    {
      id: 'opencode-go',
      name: 'OpenCode Go',
      models: [
        {
          id: 'deepseek-v4.1-flash',
          name: 'deepseek-v4.1-flash',
          reasoning: {
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'medium', name: 'Medium' },
            ],
            defaultEffort: 'medium',
          },
        },
        { id: 'grok-code', name: 'grok-code' },
      ],
    },
    { id: 'codex', name: 'Codex', models: [{ id: 'grok-code', name: 'grok-code' }] },
  ],
}

const projects = [
  { id: 'ws-dshfiles' as never, title: 'dshfiles', path: '/Users/astahmer/dev/dshfiles' },
  { id: 'ws-other' as never, title: 'other', path: '/Users/astahmer/dev/other' },
]

describe('start thread form', () => {
  it('decodes the Host catalog and keeps advertised efforts only', () => {
    const decoded = StartThreadForm.catalog(catalog)
    expect(decoded.defaultProvider).toBe('opencode-go')
    expect(decoded.defaultReasoningEffort).toBe('medium')
    expect(decoded.providers[0]?.models[0]?.efforts.map(effort => effort.id)).toEqual(['low', 'medium'])
    expect(decoded.providers[0]?.models[1]?.efforts).toEqual([])
  })

  it('lists one row per provider and model so equal model ids stay distinct', () => {
    const rows = StartThreadForm.rows(StartThreadForm.catalog(catalog))
    expect(rows.map(row => row.key)).toEqual(['opencode-go/deepseek-v4.1-flash', 'opencode-go/grok-code', 'codex/grok-code'])
  })

  it('preselects the default model and falls back to the first when it left the catalog', () => {
    const decoded = StartThreadForm.catalog(catalog)
    expect(StartThreadForm.defaultModelKey(decoded)).toBe('opencode-go/deepseek-v4.1-flash')
    const withoutDefault = { ...decoded, defaultProvider: 'gone', defaultModel: 'gone' }
    expect(StartThreadForm.defaultModelKey(withoutDefault)).toBe('opencode-go/deepseek-v4.1-flash')
  })

  it('preselects the item project, a bare folder for an unregistered path, and the Host default without one', () => {
    expect(StartThreadForm.defaultTargetValue([item({ project: '/Users/astahmer/dev/dshfiles' })], projects)).toBe('project:ws-dshfiles')
    expect(StartThreadForm.defaultTargetValue([item({ project: '/Users/astahmer/dev/unregistered' })], projects)).toBe('cwd:/Users/astahmer/dev/unregistered')
    expect(StartThreadForm.defaultTargetValue([item()], projects)).toBe('default')
    expect(StartThreadForm.targets([item({ project: '/Users/astahmer/dev/unregistered' })], projects).map(option => option.value)).toEqual([
      'cwd:/Users/astahmer/dev/unregistered',
      'default',
      'project:ws-dshfiles',
      'project:ws-other',
    ])
  })

  it('offers the registered project target instead of a bare folder for a registered path', () => {
    const targets = StartThreadForm.targets([item({ project: '/Users/astahmer/dev/dshfiles' })], projects)
    expect(targets.map(option => option.value)).toEqual(['default', 'project:ws-dshfiles', 'project:ws-other'])
  })

  it('follows the first selected item when a selection spans projects', () => {
    const selection = [item({ project: '/Users/astahmer/dev/dshfiles' }), item({ id: 104, project: '/Users/astahmer/dev/other' })]
    expect(StartThreadForm.defaultTargetValue(selection, projects)).toBe('project:ws-dshfiles')
  })

  it('prefers the model default effort and otherwise the first advertised one', () => {
    const rows = StartThreadForm.rows(StartThreadForm.catalog(catalog))
    expect(StartThreadForm.defaultEffort(rows[0]!)).toBe('medium')
    expect(
      StartThreadForm.defaultEffort({
        ...rows[0]!,
        model: { id: 'x', name: 'x', description: undefined, defaultEffort: undefined, efforts: [{ id: 'high', name: 'High' }] },
      }),
    ).toBe('high')
    expect(StartThreadForm.defaultEffort(rows[1]!)).toBeUndefined()
  })

  it('opens with the item heading and appends the preview once', () => {
    expect(StartThreadForm.message([item()])).toBe('Work on b:103: right click backlog item -> start a thread')
    expect(StartThreadForm.message([item({ preview: 'pick account and model' })])).toBe(
      'Work on b:103: right click backlog item -> start a thread\n\npick account and model',
    )
    expect(StartThreadForm.message([item({ preview: 'right click backlog item -> start a thread' })])).toBe(
      'Work on b:103: right click backlog item -> start a thread',
    )
  })

  it('names every selected item in one opening message', () => {
    const selection = [item(), item({ id: 104, title: 'start a thread from the selection' }), item({ id: 105, title: 'with right click' })]
    expect(StartThreadForm.message(selection)).toBe(
      'Work on b:103: right click backlog item -> start a thread\n\nAlso b:104: start a thread from the selection\n\nAlso b:105: with right click',
    )
  })

  it('generates a separate opening message with only that item and shared instructions', () => {
    expect(StartThreadForm.itemMessage(item(), '  Keep the change focused  ')).toBe(
      'Work on b:103: right click backlog item -> start a thread\n\nKeep the change focused',
    )
  })

  it('creates one request per selected item only for per-item mode', () => {
    const items = [
      { id: 103, title: 'First item', preview: '', project: null },
      { id: 104, title: 'Second item', preview: '', project: null },
    ]
    const request = {
      items,
      mode: 'per-item' as const,
      target: { kind: 'default' as const },
      provider: null,
      model: null,
      reasoningEffort: undefined,
      message: 'Keep changes focused',
      send: true,
      open: false,
    }
    const separate = StartThreadForm.requests(request)
    expect(separate.map(one => one.items.map(selected => selected.id))).toEqual([[103], [104]])
    expect(separate.map(one => one.message)).toEqual([
      'Work on b:103: First item\n\nKeep changes focused',
      'Work on b:104: Second item\n\nKeep changes focused',
    ])
    expect(StartThreadForm.requests({ ...request, mode: 'together' })).toEqual([{ ...request, mode: 'together' }])
  })

  it('clips the thread title to the Session title limit', () => {
    expect(StartThreadForm.title([item({ title: 'x'.repeat(400) })])).toHaveLength(200)
  })

  it('titles a batch with the first item and the number of extras', () => {
    expect(StartThreadForm.title([item({ title: 'first' }), item({ id: 104 }), item({ id: 105 })])).toBe('first +2')
  })

  it('reports a started thread by the items it works on', () => {
    expect(StartThreadForm.started([item()])).toBe('Thread started for b:103')
    expect(StartThreadForm.started([item(), item({ id: 104 })])).toBe('Thread started for b:103, b:104')
  })

  it('reports the work in progress while the workspace and the Session are created', () => {
    expect(StartThreadForm.starting([item()])).toBe('Starting a thread for b:103…')
    expect(StartThreadForm.refs([item(), item({ id: 104 })])).toBe('b:103, b:104')
  })
})
