import { describe, expect, it } from 'vitest'
import { JiraMapping, type JiraStatus, type JiraTransition } from './jira-mapping.js'

const status = (name: string, key: 'new' | 'indeterminate' | 'done'): JiraStatus => ({ name, statusCategory: { key } })
const transition = (id: string, to: JiraStatus): JiraTransition => ({ id, name: `to ${to.name}`, to })

const backlog = status('Backlog', 'new')
const progress = status('In Progress', 'indeterminate')
const review = status('In Review', 'indeterminate')
const done = status('Done', 'done')
const wontDo = status("Won't Do", 'done')

describe('Jira mapping', () => {
  it('reads statuses by category, and Won’t Do or Triage by name', () => {
    expect(JiraMapping.statusOf(backlog)).toEqual({ category: 'todo', label: 'Backlog', equivalents: ['todo', 'inbox'] })
    expect(JiraMapping.statusOf(status('Triage', 'new'))).toEqual({ category: 'inbox', label: 'Triage', equivalents: ['inbox'] })
    expect(JiraMapping.statusOf(review).category).toBe('doing')
    expect(JiraMapping.statusOf(done).category).toBe('done')
    expect(JiraMapping.statusOf(wontDo).category).toBe('dropped')
    expect(JiraMapping.statusOf(status('Declined', 'done')).category).toBe('dropped')
  })

  it.each([
    { name: 'already there', current: progress, transitions: [transition('1', done)], target: { status: 'doing' as const }, expected: 'already' },
    { name: 'lossy inbox', current: backlog, transitions: [transition('1', progress)], target: { status: 'inbox' as const }, expected: 'already' },
    {
      name: 'direct',
      current: backlog,
      transitions: [transition('1', progress), transition('2', wontDo)],
      target: { status: 'doing' as const },
      expected: 'direct 1',
    },
    {
      name: 'prefers the named status',
      current: progress,
      transitions: [transition('1', done), transition('2', wontDo)],
      target: { status: 'dropped' as const },
      expected: 'direct 2',
    },
    {
      name: 'done never lands on Won’t Do',
      current: backlog,
      transitions: [transition('2', wontDo), transition('1', progress)],
      target: { status: 'done' as const },
      expected: 'hop 1',
    },
    {
      name: 'binding status name',
      current: progress,
      transitions: [transition('1', done), transition('3', review)],
      target: { status: 'doing' as const, label: 'in review' },
      expected: 'direct 3',
    },
    {
      name: 'lateral before crossing Done',
      current: review,
      transitions: [transition('1', done), transition('4', progress)],
      target: { status: 'todo' as const },
      expected: 'hop 4',
    },
    {
      name: 'dropped stays at Done without a Won’t Do',
      current: done,
      transitions: [transition('1', backlog)],
      target: { status: 'dropped' as const },
      expected: 'already',
    },
    { name: 'unreachable', current: status('Archived', 'done'), transitions: [], target: { status: 'todo' as const }, expected: 'unreachable' },
  ])('plans a transition: $name', ({ current, transitions, target, expected }) => {
    const step = JiraMapping.nextTransition({ current, transitions, target, visited: [current.name] })
    expect(step.kind === 'direct' || step.kind === 'hop' ? `${step.kind} ${step.transition.id}` : step.kind).toBe(expected)
  })

  it('never hops back to a visited status', () => {
    const step = JiraMapping.nextTransition({
      current: progress,
      transitions: [transition('9', backlog)],
      target: { status: 'done' },
      visited: ['Backlog', 'In Progress'],
    })
    expect(step).toEqual({ kind: 'unreachable', available: ['Backlog'] })
  })

  it('writes JQL dates to the minute in the account time zone, and reads Jira timestamps', () => {
    const instant = Date.UTC(2026, 6, 1, 22, 59, 30)
    expect(JiraMapping.jqlDate(instant, 'Europe/Paris')).toBe('2026-07-02 00:59')
    expect(JiraMapping.jqlDate(instant, 'America/Los_Angeles')).toBe('2026-07-01 15:59')
    expect(JiraMapping.jqlDate(instant, 'Not/AZone')).toBe('2026-07-01 22:59')
    expect(JiraMapping.instantOf('2026-07-01T22:59:30.000+0000')).toBe(instant)
    expect(JiraMapping.instantOf('2026-07-02T00:59:30.000+0200')).toBe(instant)
    expect(JiraMapping.searchJql({ project: 'ENG', extra: 'labels = backlog', since: '2026-07-02 00:59', openOnly: true })).toBe(
      'project = "ENG" AND (labels = backlog) AND updated >= "2026-07-02 00:59" AND statusCategory != Done ORDER BY updated ASC, key ASC',
    )
  })

  it('maps links from either side and plans link writes from inwardIssue to outwardIssue', () => {
    const blocks = { id: '1', type: { name: 'Blocks' }, outwardIssue: { id: '20', key: 'ENG-2' } }
    const blockedBy = { id: '2', type: { name: 'Blocks' }, inwardIssue: { id: '30', key: 'ENG-3' } }
    const duplicatedBy = { id: '3', type: { name: 'Duplicate' }, inwardIssue: { id: '40', key: 'ENG-4' } }
    expect([blocks, blockedBy, duplicatedBy].map(JiraMapping.relationOf)).toEqual([
      { relation: 'blocks', key: '20' },
      { relation: 'depends-on', key: '30' },
      undefined,
    ])
    expect(
      JiraMapping.linkChanges({
        self: '10',
        current: [blocks, blockedBy, duplicatedBy],
        wanted: [
          { relation: 'blocks', key: '20' },
          { relation: 'related', key: '50' },
          { relation: 'depends-on', key: '60' },
        ],
      }),
    ).toEqual({
      create: [
        { type: { name: 'Relates' }, inwardIssue: { id: '10' }, outwardIssue: { id: '50' } },
        { type: { name: 'Blocks' }, inwardIssue: { id: '60' }, outwardIssue: { id: '10' } },
      ],
      remove: ['2'],
    })
  })

  it('validates keys, project keys and custom field ids, and recognizes references', () => {
    expect(['ENG-12', '10042', 'eng-12', 'ENG-0', '../x', 'ENG-1/comment'].map(JiraMapping.issueRef)).toEqual([
      'ENG-12',
      '10042',
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(['eng', 'ENG_2', 'E N G', ''].map(JiraMapping.projectKeyOf)).toEqual(['ENG', 'ENG_2', undefined, undefined])
    expect(['customfield_10050', 'summary', 'customfield_x'].map(JiraMapping.customFieldOf)).toEqual(['customfield_10050', undefined, undefined])
    expect(
      [
        'eng-12',
        'https://acme.atlassian.net/browse/ENG-12',
        'https://acme.atlassian.net/issues/?selectedIssue=ENG-7',
        'https://acme.atlassian.net/browse/ENG',
      ].map(JiraMapping.keyOfReference),
    ).toEqual(['ENG-12', 'ENG-12', 'ENG-7', undefined])
  })

  it('reads acceptance criteria from a list, a task list or text, and writes them back as a list', () => {
    expect(JiraMapping.criteriaOf('- [x] Ships\n- [ ] Documented\nplain')).toEqual([
      { text: 'Ships', done: true },
      { text: 'Documented', done: false },
      { text: 'plain', done: false },
    ])
    const written = JiraMapping.criteriaValue([{ text: 'Ships', done: true }], false)
    expect(JiraMapping.criteriaOf(written)).toEqual([{ text: 'Ships', done: true }])
    expect(JiraMapping.criteriaValue([{ text: 'Ships', done: true }], true)).toBe('[x] Ships')
  })

  it('maps priorities through the binding names or Jira defaults, and labels without spaces', () => {
    expect(['Highest', 'High', 'Medium', 'Lowest', 'Weird'].map(name => JiraMapping.priorityOf(name, undefined))).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
      'none',
    ])
    expect(JiraMapping.priorityOf('P0', { priorityValues: 'urgent=P0' })).toBe('urgent')
    expect(JiraMapping.priorityNameFor('urgent', undefined)).toBe('Highest')
    expect(JiraMapping.priorityNameFor('none', undefined)).toBeUndefined()
    expect(JiraMapping.labelsFor(['needs review', ' x ', 'needs-review', ''])).toEqual(['needs-review', 'x'])
  })
})
