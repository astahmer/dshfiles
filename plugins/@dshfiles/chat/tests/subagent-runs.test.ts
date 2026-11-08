import { describe, expect, it } from 'vitest'
import type { ChatConversationViewNode } from '../src/native/contract/chat-nodes.ts'
import {
  decodeSubagentSignature,
  encodeSubagentSignature,
  segmentSubagentRuns,
  subagentCallOf,
  workingSubagents,
  type SubagentCall,
} from '../src/native/chat/subagent-runs.ts'

// SAFETY: subagentCallOf reads only `kind` and `data.root`; the fixtures carry exactly those.
const toolNode = (root: unknown): ChatConversationViewNode => ({ kind: 'tool-call', data: { root } }) as unknown as ChatConversationViewNode
const running = (name: string) => toolNode({ phase: 'start', name, callId: 'c' })
const settled = (name: string, text: string, isError = false) =>
  toolNode({ kind: 'tool-result', name, call: { name }, content: [{ type: 'text', text }], isError })

const CALLING: SubagentCall = { calling: true, childId: undefined }
const done = (childId?: string): SubagentCall => ({ calling: false, childId })

describe('subagentCallOf', () => {
  it('reads delegation rows and their child, and ignores every other row', () => {
    expect(subagentCallOf(running('subagent'))).toEqual(CALLING)
    expect(subagentCallOf(settled('subagent_fork', 'started subagent session-7'))).toEqual(done('session-7'))
    expect(subagentCallOf(settled('subagent', 'no route', true))).toEqual(done())
    expect(subagentCallOf(running('send_message'))).toBeUndefined()
    // SAFETY: an assistant row is any non-tool kind; only `kind` is read.
    expect(subagentCallOf({ kind: 'assistant-step' } as unknown as ChatConversationViewNode)).toBeUndefined()
    expect(subagentCallOf(undefined)).toBeUndefined()
  })
})

describe('segmentSubagentRuns', () => {
  it('folds two or more consecutive delegations and leaves lone ones as rows', () => {
    const members = ['read', 'a', 'b', 'c', 'bash', 'd', 'think']
    const calls = [undefined, CALLING, done('x'), done(), undefined, CALLING, undefined]
    expect(segmentSubagentRuns(members, calls)).toEqual([
      { kind: 'member', member: 'read', index: 0 },
      { kind: 'subagents', members: ['a', 'b', 'c'], calls: [CALLING, done('x'), done()] },
      { kind: 'member', member: 'bash', index: 4 },
      { kind: 'member', member: 'd', index: 5 },
      { kind: 'member', member: 'think', index: 6 },
    ])
  })

  it('keeps every member exactly once, in order', () => {
    const members = ['a', 'b']
    expect(segmentSubagentRuns(members, [CALLING, CALLING]).flatMap(s => (s.kind === 'member' ? [s.member] : s.members))).toEqual(members)
    expect(segmentSubagentRuns([], [])).toEqual([])
  })
})

describe('subagent signature', () => {
  it('round-trips the facts a seat subscribes to', () => {
    const calls = [undefined, CALLING, done('session-1'), done()]
    expect(decodeSubagentSignature(encodeSubagentSignature(calls))).toEqual(calls)
    expect(decodeSubagentSignature(encodeSubagentSignature([]))).toEqual([])
  })
})

describe('workingSubagents', () => {
  it('counts open calls and children that still run', () => {
    const calls = [CALLING, done('busy'), done('idle'), done()]
    expect(workingSubagents(calls, id => id === 'busy')).toBe(2)
    expect(workingSubagents([done('idle')], () => false)).toBe(0)
  })
})
