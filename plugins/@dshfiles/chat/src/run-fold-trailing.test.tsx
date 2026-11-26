// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatNodeStore } from './native/contract/snapshot.ts'
import { RunFoldContext, RunFoldStore, RunFoldSummary, useRunFoldAbsorbed, useRunFoldHidden, useRunFoldPlacements, type RunFoldScope } from './native/chat/RunFold.tsx'
import { RunFoldKinds } from './run-fold-kinds.ts'
import type { RunFoldKind, RunFoldStatus } from './run-folds.ts'

/**
 * Round 21 D6: a subagent call that failed to start is kept outside "Worked for", right after the group whose run folds
 * the other calls. The run's summary counted only the rows inside the group ("6 subagents") while 7 rows showed.
 */

const status = new Map<string, RunFoldStatus>()
const agentKind: RunFoldKind = {
  id: 'agent',
  Icon: () => null,
  claims: call => call.toolName === 'subagent',
  useStates: ({ calls }) => calls.map(call => ({ status: status.get(call.callId) ?? 'working' })),
  useText: () => ({ count: count => `${String(count)} ${count === 1 ? 'subagent' : 'subagents'}`, active: 'working', done: 'finished' }),
}

// SAFETY: the fold reads only `kind` and the root call's name, phase, error flag and content of a tool-call node.
const toolNode = (key: string, isError: boolean) =>
  ({ kind: 'tool-call', data: { root: { kind: 'result', callId: key, name: 'subagent', call: { name: 'subagent', argsRaw: '{}' }, isError, content: [] } } }) as never

const store = (keys: readonly string[], failed: ReadonlySet<string>): ChatNodeStore => {
  const nodes = new Map(keys.map(key => [key, toolNode(key, failed.has(key))]))
  // SAFETY: the fold reads nodes and subscribes to them; nothing else of the store.
  return { get: (key: string) => nodes.get(key), source: () => ({ getSnapshot: () => undefined, subscribe: () => () => undefined }) } as unknown as ChatNodeStore
}

// SAFETY: the summary only translates its own keys; the identity translator covers them.
const t = ((key: string) => (key === 'message.runFold.failed' ? 'failed' : key === 'message.runFold.stopped' ? 'stopped' : key)) as never

const scope: RunFoldScope = {
  // SAFETY: a fixture session id; nothing validates it.
  sessionId: 'session-1' as SessionId,
  enabled: true,
  runtime: { useSessions: (() => undefined) as never, useSessionStatus: (() => undefined) as never },
}

/** The group's rows with their fold, then the row the Turn keeps outside the group, as the flow lays them out. */
const Group = (props: { readonly nodeStore: ChatNodeStore; readonly inside: readonly string[]; readonly trailing: readonly string[] }) => {
  const placements = useRunFoldPlacements(props.nodeStore, props.inside, props.trailing)
  return (
    <>
      {props.inside.map((key, index) => (
        <Seat key={key} nodeKey={key} placement={placements[index]} nodeStore={props.nodeStore} />
      ))}
    </>
  )
}

const Seat = (props: { readonly nodeKey: string; readonly placement: ReturnType<typeof useRunFoldPlacements>[number]; readonly nodeStore: ChatNodeStore }) => {
  const hidden = useRunFoldHidden(props.placement, props.nodeKey)
  return (
    <>
      {props.placement?.head === undefined ? null : (
        <RunFoldSummary runKey={props.placement.runKey} memberKeys={props.placement.head.memberKeys} nodeStore={props.nodeStore} t={t} />
      )}
      {hidden ? null : <div data-testid="row">{props.nodeKey}</div>}
    </>
  )
}

/** The flow: the group, then its kept-outside rows, folded by the flow only when the group did not take them. */
const Flow = (props: { readonly nodeStore: ChatNodeStore; readonly inside: readonly string[]; readonly trailing: readonly string[] }) => {
  const absorbed = useRunFoldAbsorbed()
  const flowKeys = props.trailing.map(key => (absorbed.has(key) ? undefined : key))
  const placements = useRunFoldPlacements(props.nodeStore, flowKeys)
  return (
    <RunFoldContext.Provider value={scope}>
      <Group nodeStore={props.nodeStore} inside={props.inside} trailing={props.trailing} />
      {props.trailing.map((key, index) => (
        <Seat key={key} nodeKey={key} placement={placements[index]} nodeStore={props.nodeStore} />
      ))}
    </RunFoldContext.Provider>
  )
}

const summary = (): string => screen.getAllByRole('button').map(button => button.getAttribute('aria-label') ?? '').join(' | ')
const rows = (): readonly string[] => screen.queryAllByTestId('row').map(row => row.textContent ?? '')

let unfollow: () => void = () => undefined
const kinds = (): void => {
  unfollow = RunFoldKinds.follow({ get: () => [agentKind], subscribe: () => () => undefined })
}

afterEach(() => {
  cleanup()
  unfollow()
  status.clear()
})

describe('a run beside a failed call kept outside "Worked for" (round 21 D6)', () => {
  const inside = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']

  it('counts the failed call in the run it sits beside, with the run collapsed and open', () => {
    kinds()
    for (const [key, value] of [['c2', 'stopped'], ['c5', 'stopped'], ['c6', 'done'], ['c7', 'failed']] as const) status.set(key, value)
    render(<Flow nodeStore={store([...inside, 'c7'], new Set(['c7']))} inside={inside} trailing={['c7']} />)
    expect(summary()).toBe('7 subagents · 3 working · 1 failed · 2 stopped · 1 finished')
    // Collapsed: the summary and the failed call, which stays visible beside it.
    expect(rows()).toEqual(['c7'])
    const runKey = `session-1\nc1`
    act(() => RunFoldStore.setExpanded(runKey, true))
    expect(rows()).toEqual([...inside, 'c7'])
    expect(summary()).toBe('7 subagents · 3 working · 1 failed · 2 stopped · 1 finished')
    fireEvent.click(screen.getByRole('button'))
    expect(rows()).toEqual(['c7'])
  })

  it('folds the six failed calls kept outside into the run of the one that started, never twice', () => {
    kinds()
    const failed = ['c2', 'c3', 'c4', 'c5', 'c6', 'c7']
    for (const key of failed) status.set(key, 'failed')
    render(<Flow nodeStore={store(['c1', ...failed], new Set(failed))} inside={['c1']} trailing={failed} />)
    // One summary for all seven; it read "6 subagents · 6 failed" beside a lone seventh row.
    expect(summary()).toBe('7 subagents · 1 working · 6 failed')
    expect(rows()).toEqual(failed)
  })
})
