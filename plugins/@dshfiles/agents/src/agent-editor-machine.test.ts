import { describe, expect, it } from 'vitest'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { Schema } from 'effect'

import { agentSchema, type Agent, type AgentDraft } from './agent.js'
import { agentEditorMachine } from './agent-editor-machine.js'

const agent = (handle: string): Agent =>
  Schema.decodeUnknownSync(agentSchema)({
    handle,
    name: handle,
    glyph: handle.slice(0, 1).toUpperCase(),
    description: '',
    instructions: '',
    preset: null,
    route: null,
    enabled: true,
    builtIn: false,
    createdAt: 0,
    updatedAt: 0,
    lastUsedAt: null,
    threadCount: 2,
  })

const setup = () => {
  const actor = createActor(agentEditorMachine).start()
  return actor
}

describe('agent editor navigation', () => {
  it('asks before leaving a dirty editor and returns to it when the person keeps editing', () => {
    const actor = setup()
    actor.send({ type: 'OPEN', selection: { kind: 'agent', handle: 'first' }, dirty: false })
    actor.send({ type: 'OPEN', selection: { kind: 'agent', handle: 'second' }, dirty: true })

    expect(actor.getSnapshot().value).toBe('confirmLeave')
    expect(actor.getSnapshot().context.leavingTo).toEqual({ kind: 'agent', handle: 'second' })

    actor.send({ type: 'KEEP_EDITING' })
    expect(actor.getSnapshot().value).toBe('editing')
    expect(actor.getSnapshot().context.selection).toEqual({ kind: 'agent', handle: 'first' })
  })

  it('applies the requested selection once the edits are discarded', () => {
    const actor = setup()
    const applied: unknown[] = []
    actor.on('applied', event => applied.push(event.selection))
    actor.send({ type: 'OPEN', selection: { kind: 'agent', handle: 'first' }, dirty: false })
    actor.send({ type: 'OPEN', selection: { kind: 'new', base: baseOf('third') }, dirty: true })
    actor.send({ type: 'DISCARD' })

    expect(actor.getSnapshot().value).toBe('editing')
    expect(actor.getSnapshot().context.selection).toEqual({ kind: 'new', base: baseOf('third') })
    expect(applied).toEqual([
      { kind: 'agent', handle: 'first' },
      { kind: 'new', base: baseOf('third') },
    ])
  })

  it('keeps at most one dialog open', () => {
    const actor = setup()
    actor.send({ type: 'ASK_REMOVE', agent: agent('one') })
    expect(actor.getSnapshot().context.modal.kind).toBe('remove')

    actor.send({ type: 'ASK_START', agent: agent('one') })
    expect(actor.getSnapshot().context.modal).toMatchObject({ kind: 'start', pending: false, error: null })

    actor.send({ type: 'CANCEL_REMOVE' })
    expect(actor.getSnapshot().context.modal).toEqual({ kind: 'none' })
  })

  it('tracks a start thread that is still dispatching, then reports why it failed', () => {
    const actor = setup()
    actor.send({ type: 'ASK_START', agent: agent('one') })
    actor.send({ type: 'START_PENDING' })
    expect(actor.getSnapshot().context.modal).toMatchObject({ kind: 'start', pending: true, error: null })

    actor.send({ type: 'START_FAILED', message: 'No project to start in.' })
    expect(actor.getSnapshot().context.modal).toMatchObject({ kind: 'start', pending: false, error: 'No project to start in.' })

    actor.send({ type: 'STARTED' })
    expect(actor.getSnapshot().context.modal).toEqual({ kind: 'none' })
  })

  it('applies a landed save or removal over an open dialog', () => {
    const actor = setup()
    actor.send({ type: 'OPEN', selection: { kind: 'agent', handle: 'first' }, dirty: false })
    actor.send({ type: 'ASK_REMOVE', agent: agent('first') })

    actor.send({ type: 'APPLY', selection: { kind: 'none' } })
    expect(actor.getSnapshot().context.selection).toEqual({ kind: 'none' })
    expect(actor.getSnapshot().context.modal).toEqual({ kind: 'none' })
  })
})

const baseOf = (handle: string): AgentDraft => ({
  handle,
  name: handle,
  glyph: 'A',
  description: '',
  instructions: '',
  preset: null,
  route: null,
  memoryScope: null,
  routine: '',
  delegation: { messaging: 'any', handles: [], subagents: true },
  enabled: true,
})
