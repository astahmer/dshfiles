// @vitest-environment jsdom
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The live-turns query and the list's projected status are the seat's two inputs; both are stubbed to the state of a
// parent whose own turn ended while one subagent works.
vi.mock('./live-activity.js', async original => ({ ...(await original<typeof import('./live-activity.js')>()), useLiveTurns: () => new Map() }))
vi.mock('./thread-status-client.js', async original => ({
  ...(await original<typeof import('./thread-status-client.js')>()),
  useThreadWorkStatus: () => ({ status: 'working', detail: 'Waiting on 1 subagent' }),
  useThreadWorkStatuses: () => new Map([['parent', { status: 'working', detail: 'Waiting on 1 subagent' }]]),
}))
vi.mock('./snapshots.js', () => ({ HostSnapshotsModel: { selectStableSessionListState: <State,>(state: State): State => state } }))

const { HeaderLiveActivity } = await import('./header-live-activity.js')

afterEach(cleanup)

type Props = Parameters<typeof HeaderLiveActivity>[0]
type SessionsState = Parameters<Parameters<Props['useSessions']>[0]>[0]
type StatusState = Parameters<Parameters<Props['useSessionStatus']>[0]>[0]

const mount = (running: boolean, origin?: 'subagent') => {
  // SAFETY: the stubbed snapshot selector reads only `phase` and `byId[sessionId].running/blank/origin` of this list.
  const state = { phase: 'ready', ids: ['parent'], byId: { parent: { id: 'parent', running, blank: false, origin } } } as unknown as SessionsState
  const statuses: StatusState = new Map()
  const useSessions: Props['useSessions'] = select => select(state)
  const useSessionStatus: Props['useSessionStatus'] = select => select(statuses)
  const t: Props['t'] = key => key
  return render(<HeaderLiveActivity sessionId={SessionId('parent')} useSessions={useSessions} useSessionStatus={useSessionStatus} t={t} />)
}

describe('header live seat', () => {
  it('leaves a subagent\'s state to its title line: no seat in its header\'s middle (council round 22, item 7)', () => {
    const { container } = mount(true, 'subagent')
    expect(container.querySelector('[data-header-live-slot]')).toBeNull()
    expect(container.querySelector('[data-testid="thread-header-live-activity"]')).toBeNull()
  })

  it('says nothing while only subagents work: the header subagent chip already shows them', () => {
    const { container } = mount(false)
    expect(container.textContent).not.toContain('Waiting on 1 subagent')
    expect(container.querySelector('[data-testid="thread-header-live-activity"]')).toBeNull()
    // The seat stays, at its fixed width, so the chips beside it do not move.
    expect(container.querySelector('[data-header-live-slot]')).not.toBeNull()
  })

  it("keeps the turn's own working line while the thread itself runs", () => {
    const { container } = mount(true)
    expect(container.querySelector('[data-testid="thread-header-live-activity"]')).not.toBeNull()
  })
})
