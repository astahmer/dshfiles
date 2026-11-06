import { describe, expect, it } from 'vitest'
import {
  PICK_FLOW_MENU,
  pickFlowBusy,
  pickFlowError,
  pickFlowOpen,
  pickFlowPicking,
  pickFlowReduce,
  type PickFlowState,
} from '../src/native/workspace-pick-flow.ts'

const flow: PickFlowState = { kind: 'flow' }
const adopting: PickFlowState = { kind: 'adopting' }
const error: PickFlowState = { kind: 'error', message: 'That folder is not readable.' }

describe('workspace pick flow', () => {
  it('opens the flow from the menu and from the auto-open rule', () => {
    expect(pickFlowReduce(PICK_FLOW_MENU, { type: 'add.select' })).toEqual(flow)
    expect(pickFlowReduce(PICK_FLOW_MENU, { type: 'owner.auto-open' })).toEqual(flow)
    expect(pickFlowReduce(flow, { type: 'owner.auto-open' })).toBe(flow)
    expect(pickFlowReduce(adopting, { type: 'add.select' })).toBe(adopting)
  })

  it('reports the flow busy while it is open or adopting a pick', () => {
    expect(pickFlowOpen(PICK_FLOW_MENU)).toBe(false)
    expect(pickFlowBusy(flow)).toBe(true)
    expect(pickFlowBusy(adopting)).toBe(true)
    expect(pickFlowPicking(adopting)).toBe(true)
    expect(pickFlowPicking(flow)).toBe(false)
  })

  it('adopts a pick and returns to the menu once the Host answers', () => {
    expect(pickFlowReduce(flow, { type: 'flow.picked' })).toEqual(adopting)
    expect(pickFlowReduce(adopting, { type: 'flow.adopted' })).toEqual(PICK_FLOW_MENU)
    expect(pickFlowReduce(PICK_FLOW_MENU, { type: 'flow.adopted' })).toBe(PICK_FLOW_MENU)
  })

  it('lands a failure in the error dialog and reopens the flow from it', () => {
    expect(pickFlowReduce(adopting, { type: 'flow.failed', message: 'That folder is not readable.' })).toEqual(error)
    expect(pickFlowError(error)).toBe('That folder is not readable.')
    expect(pickFlowError(flow)).toBeNull()
    expect(pickFlowReduce(error, { type: 'error.close' })).toEqual(PICK_FLOW_MENU)
    expect(pickFlowReduce(error, { type: 'add.select' })).toEqual(flow)
  })

  it('snaps back when the flow loses its occupant, and keeps the error dialog', () => {
    expect(pickFlowReduce(flow, { type: 'occupant.lost' })).toEqual(PICK_FLOW_MENU)
    expect(pickFlowReduce(adopting, { type: 'occupant.lost' })).toEqual(PICK_FLOW_MENU)
    expect(pickFlowReduce(error, { type: 'occupant.lost' })).toBe(error)
    expect(pickFlowReduce(PICK_FLOW_MENU, { type: 'occupant.lost' })).toBe(PICK_FLOW_MENU)
  })

  it('cancels the flow, and ignores a cancel outside it', () => {
    expect(pickFlowReduce(flow, { type: 'flow.cancel' })).toEqual(PICK_FLOW_MENU)
    expect(pickFlowReduce(adopting, { type: 'flow.cancel' })).toEqual(PICK_FLOW_MENU)
    expect(pickFlowReduce(PICK_FLOW_MENU, { type: 'flow.cancel' })).toBe(PICK_FLOW_MENU)
    expect(pickFlowReduce(PICK_FLOW_MENU, { type: 'flow.picked' })).toBe(PICK_FLOW_MENU)
  })
})
