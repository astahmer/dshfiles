import { describe, expect, it } from 'vitest'

import type { BacklogEvent } from './item.js'
import { ItemTimeline } from './item-timeline.js'

let clock = 0
const event = (fields: Partial<BacklogEvent> & Pick<BacklogEvent, 'actor' | 'kind'>): BacklogEvent => {
  clock += 1
  return { at: clock, detail: '', ...fields }
}
const agentA = 'agent:session-a'
const agentB = 'agent:session-b'

describe('item timeline lanes', () => {
  it('keeps everything the user did in the conversation', () => {
    const events = [
      event({ actor: 'user', kind: 'created', detail: 'ship it' }),
      event({ actor: 'user', kind: 'moved', detail: 'inbox → doing' }),
      event({ actor: 'user', kind: 'commented', detail: 'please look' }),
      event({ actor: 'user', kind: 'triaged', detail: 'dismissed a suggestion' }),
    ]
    expect(ItemTimeline.lanes(events)).toEqual(['conversation', 'conversation', 'conversation', 'conversation'])
  })

  it('puts agent progress, moves, links, triage and system events in the work log', () => {
    const events = [
      event({ actor: 'user', kind: 'created', detail: 'ship it' }),
      event({ actor: agentA, kind: 'moved', detail: 'inbox → doing' }),
      event({ actor: agentA, kind: 'linked', detail: 'revision:abc' }),
      event({ actor: agentA, kind: 'commented', detail: 'read the schema' }),
      event({ actor: 'system', kind: 'triaged', detail: 'applied title' }),
      event({ actor: 'system', kind: 'commented', detail: 'Sync conflict with Linear ENG-1' }),
    ]
    expect(ItemTimeline.lanes(events)).toEqual(['conversation', 'work', 'work', 'work', 'work', 'work'])
  })

  it('treats the agent comment right after a user comment as its answer', () => {
    const events = [
      event({ actor: 'user', kind: 'commented', detail: 'why is it flaky?' }),
      event({ actor: agentA, kind: 'commented', detail: 'a race in setup' }),
      event({ actor: agentA, kind: 'commented', detail: 'fixed the race' }),
    ]
    expect(ItemTimeline.lanes(events)).toEqual(['conversation', 'conversation', 'work'])
  })

  it('treats the first comment of a thread the user started as its answer, and only that thread', () => {
    const events = [
      event({ actor: 'user', kind: 'linked', detail: 'thread:session-a', threadId: 'session-a' }),
      event({ actor: agentB, kind: 'commented', detail: 'unrelated progress' }),
      event({ actor: agentA, kind: 'commented', detail: 'done: see jj:abc' }),
      event({ actor: agentA, kind: 'commented', detail: 'follow-up progress' }),
    ]
    expect(ItemTimeline.lanes(events)).toEqual(['conversation', 'work', 'conversation', 'work'])
  })

  it('keeps attention requests, reverts, remote comments and smart-reply answers in the conversation', () => {
    const events = [
      event({ actor: agentA, kind: 'edited', detail: 'attention', fieldChanges: [{ field: 'attention', before: '', after: 'needs-input' }] }),
      event({ actor: agentA, kind: 'edited', detail: 'attention', fieldChanges: [{ field: 'attention', before: 'needs-input', after: 'none' }] }),
      event({ actor: agentA, kind: 'moved', detail: 'reverted status' }),
      event({ actor: 'system', kind: 'commented', detail: 'Linear · Ada: looks good' }),
      event({ actor: 'system', kind: 'commented', detail: 'remote', origin: 'remote:github' }),
      event({ actor: 'system', kind: 'commented', detail: '**@reply-helper**\n\nAnswered.' }),
    ]
    expect(ItemTimeline.lanes(events)).toEqual(['conversation', 'work', 'conversation', 'conversation', 'conversation', 'conversation'])
  })

  it('splits the lanes in order', () => {
    const created = event({ actor: 'user', kind: 'created', detail: 'x' })
    const progress = event({ actor: agentA, kind: 'commented', detail: 'progress' })
    expect(ItemTimeline.split([created, progress])).toEqual({ conversation: [created], work: [progress] })
  })
})

describe('work log summary', () => {
  it('counts agents and updates and keeps the latest time', () => {
    const work = [
      { at: 5, actor: agentA, kind: 'moved', detail: '' },
      { at: 9, actor: agentB, kind: 'commented', detail: '' },
      { at: 7, actor: agentA, kind: 'linked', detail: '' },
      { at: 8, actor: 'system', kind: 'triaged', detail: '' },
    ] satisfies BacklogEvent[]
    const summary = ItemTimeline.summarize(work)
    expect(summary).toEqual({ agents: 2, updates: 4, lastAt: 9 })
    expect(ItemTimeline.summaryText({ summary, ago: at => `${String(at)}h` })).toBe('2 agents · 4 updates · last 9h')
  })

  it('names a system-only log without agents and in the singular', () => {
    const summary = ItemTimeline.summarize([{ at: 3, actor: 'system', kind: 'triaged', detail: '' }])
    expect(ItemTimeline.summaryText({ summary, ago: () => 'now' })).toBe('1 update · last now')
    expect(ItemTimeline.summaryText({ summary: ItemTimeline.summarize([]), ago: () => 'now' })).toBe('0 updates')
  })
})
