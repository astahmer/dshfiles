// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnTriggerNodeView } from '../src/native/chat/TurnTriggerNodeView.tsx'
import { RunFoldKinds } from '../src/run-fold-kinds.ts'
import type { RunFoldKind } from '../src/run-folds.ts'

/**
 * Council round 23, item 7: the failed subagent notice read "✕ Diff the ledger export against totals · failed before it
 * finished  7:37 PM" and named no model. It reads on two lines: the child, then its model and "Turn failed".
 */

// The notice's body prints the raw notification through the native JSON block; the primitives bundle loads icon sets
// this test does not need.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ JsonBlock: () => null }))

type Props = Parameters<typeof TurnTriggerNodeView>[0]

const CHILD = 'child-1'
const LABEL = 'Diff the ledger export against totals'

// SAFETY: the notice translates its own keys; an identity translator with the one word under test covers them.
const t = ((key: string) => (key === 'message.turnProcess.turnFailed' ? 'Turn failed' : key)) as Props['t']

// SAFETY: the notice reads only the trigger's source, content and time of its node.
const node = {
  key: 'trigger-1',
  kind: 'turn-trigger',
  data: { time: Date.UTC(2026, 10, 26, 18, 37), content: [], source: { kind: 'subagent-settled', stopReason: 'error', senderSessionId: CHILD } },
} as unknown as Props['node']

const list = {
  byId: {},
  projectionsBySession: { 'session-1': { values: { subagentCatalog: [{ id: CHILD, name: 'agent-1', mode: 'continuable', label: LABEL, createdAt: 1 }] } } },
}

// SAFETY: the notice reads only the parent's subagent catalog of the session list.
const useSessions = (selector => selector(list as never)) as NonNullable<Props['useSessions']>

const routeKind: RunFoldKind = {
  id: 'agent',
  Icon: () => null,
  claims: () => false,
  useStates: () => [],
  useText: () => ({ count: String, active: 'working', done: 'finished' }),
  useChildRoute: ({ childSessionId }) => (childSessionId === CHILD ? { provider: 'anthropic', model: 'claude-sonnet-5-5' } : undefined),
}

let unfollow: () => void = () => undefined

afterEach(() => {
  cleanup()
  unfollow()
})

const view = () =>
  render(
    <TurnTriggerNodeView
      node={node}
      t={t}
      // SAFETY: a fixture session id; nothing validates it.
      sessionId={'session-1' as SessionId}
      useSessions={useSessions}
    />,
  )

describe('the failed subagent notice (council round 23, item 7)', () => {
  it('names the child on line 1 and its model with "Turn failed" on line 2, the time inside the disclosure', () => {
    unfollow = RunFoldKinds.follow({ get: () => [routeKind], subscribe: () => () => undefined })
    view()
    // Read aloud, the notice still starts with what happened.
    const header = screen.getByRole('button', { name: /^message\.trigger\.subagent\.error: Diff the ledger export against totals/u })
    expect(header.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('failed')
    expect(screen.getByText(LABEL)).not.toBeNull()
    const detail = header.querySelector('[data-turn-trigger-detail]')
    const model = detail?.querySelector('[data-slot="route-model"]')
    expect(model?.textContent).toBe('claude-sonnet-5-5')
    expect(model?.getAttribute('data-model-family')).toBe('claude')
    expect(detail?.textContent).toBe('claude-sonnet-5-5·Turn failed')
    // The header holds no clock; the disclosure does.
    expect(header.querySelector('time')).toBeNull()
    fireEvent.click(header)
    expect(document.querySelector('[data-turn-trigger] time')).not.toBeNull()
  })

  it('says only why when no provider knows the model, never a guess', () => {
    view()
    const detail = screen.getByRole('button').querySelector('[data-turn-trigger-detail]')
    expect(detail?.querySelector('[data-slot="route-model"]')).toBeNull()
    expect(detail?.textContent).toBe('Turn failed')
  })
})
