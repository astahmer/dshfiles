import { describe, expect, it } from 'vitest'

import type { BacklogItem } from './item.js'
import { BacklogTriage, type TriageServices } from './triage.js'

const item = (id: number, title: string, fields: Partial<BacklogItem> = {}): BacklogItem => ({
  id,
  title,
  body: '',
  kind: 'task',
  status: 'inbox',
  project: null,
  tags: [],
  links: [],
  actors: [{ id: 'user', role: 'owner' }],
  pinned: false,
  humanFields: [],
  createdAt: id,
  lastActivityAt: id,
  events: [],
  ...fields,
})

const jevAnswering =
  (answers: { readonly actionable: number; readonly duplicate?: number }): TriageServices['jev'] =>
  async request =>
    request.question.instructions.startsWith('Is `content` an actionable') ? answers.actionable : (answers.duplicate ?? 0)

describe('triage', () => {
  it('moves work out of the inbox with Jev alone and reports its confidence', async () => {
    const proposal = await BacklogTriage.run({
      item: item(1, 'Fix the paste handler'),
      others: [],
      services: { jev: jevAnswering({ actionable: 0.9 }) },
      now: 5,
    })
    expect(proposal).toEqual({ status: 'todo', confidence: 0.9, reason: 'Reads as work to do.', source: 'jev', at: 5 })
  })

  it('turns a plain capture Jev reads as knowledge into a note', async () => {
    const proposal = await BacklogTriage.run({
      item: item(1, 'Kodiak rebases FIFO, never click Update branch'),
      others: [],
      services: { jev: jevAnswering({ actionable: 0.1 }) },
      now: 5,
    })
    expect(proposal?.kind).toBe('note')
    expect(proposal?.confidence).toBe(0.9)
  })

  it('flags the closest open item as a duplicate when Jev says it is the same work', async () => {
    const others = [
      item(1, 'Wire jj revision signals to auto-move items'),
      item(2, 'Rotate the Doppler token'),
      item(3, 'Wire jj signals to move items', { status: 'done' }),
    ]
    const proposal = await BacklogTriage.run({
      item: item(4, 'Auto-move items from jj revision signals'),
      others,
      services: { jev: jevAnswering({ actionable: 0.8, duplicate: 0.85 }) },
      now: 5,
    })
    expect(proposal?.duplicateOf).toBe(1)
  })

  it('takes the model answer, dropping invalid fields and duplicates it was not shown', async () => {
    const complete: TriageServices['complete'] = async () =>
      'Sure: {"kind": "bug", "status": "sideways", "title": "Composer drops chips on paste", "tags": ["composer"], "duplicateOf": 99, "confidence": 0.92, "reason": "Something is broken."}'
    const proposal = await BacklogTriage.run({ item: item(1, 'composer drops chips on paste'), others: [], services: { complete }, now: 5 })
    expect(proposal).toEqual({
      kind: 'bug',
      title: 'Composer drops chips on paste',
      tags: ['composer'],
      confidence: 0.92,
      reason: 'Something is broken.',
      source: 'model',
      at: 5,
    })
  })

  it('lowers confidence when Jev and the model disagree on the kind', async () => {
    const complete: TriageServices['complete'] = async () => '{"kind": "idea", "status": "todo", "confidence": 0.95, "reason": "A possible feature."}'
    const proposal = await BacklogTriage.run({
      item: item(1, 'A weekly digest of dormant items'),
      others: [],
      services: { jev: jevAnswering({ actionable: 0.4 }), complete },
      now: 5,
    })
    expect(proposal?.kind).toBe('idea')
    expect(proposal?.source).toBe('jev+model')
    expect(proposal?.confidence).toBe(0.6)
  })

  it('proposes nothing when every service fails or nothing would change', async () => {
    const failing: TriageServices = { jev: async () => Promise.reject(new Error('down')), complete: async () => 'not json' }
    expect(await BacklogTriage.run({ item: item(1, 'Anything'), others: [], services: failing, now: 5 })).toBeNull()
    const agreeing: TriageServices = { jev: jevAnswering({ actionable: 0.9 }) }
    expect(await BacklogTriage.run({ item: item(1, 'Anything', { status: 'todo' }), others: [], services: agreeing, now: 5 })).toBeNull()
  })

  it('learns from items whose applied triage the user corrected by hand', () => {
    const corrected = item(1, 'Kodiak note', {
      kind: 'note',
      status: 'todo',
      events: [
        { at: 1, actor: 'system', kind: 'triaged', detail: 'applied kind bug, status todo' },
        { at: 2, actor: 'user', kind: 'edited', detail: 'kind' },
      ],
    })
    const untouched = item(2, 'Fine as is', { events: [{ at: 1, actor: 'system', kind: 'triaged', detail: 'applied status todo' }] })
    expect(BacklogTriage.correctionsFrom([corrected, untouched])).toEqual([
      { title: 'Kodiak note', suggested: 'kind bug, status todo', chosen: 'kind note, status todo' },
    ])
  })
})
