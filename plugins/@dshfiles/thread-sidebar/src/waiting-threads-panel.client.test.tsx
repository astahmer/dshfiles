// @vitest-environment jsdom
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxThreadSignal } from './thread-status.js'

const inbox = vi.hoisted(() => ({ act: vi.fn(), done: vi.fn() }))
const SESSION = 'session-ready'
const signal: InboxThreadSignal = { itemId: 'item-land', source: 'jj-integration.land', severity: 'ready', reason: 'Ready to land', verb: 'Land', openedAt: 1 }

vi.mock('./inbox-signals.js', () => ({
  useInboxThreadSignals: () => ({ signals: new Map([[SESSION, signal]]), loaded: true, act: inbox.act, done: inbox.done }),
}))

// The age helper comes from the Host's primitives, which this environment does not load.
vi.mock('./relative-age.js', () => ({ formatAge: () => '1m' }))

const { WaitingThreadsPanel } = await import('./waiting-threads-panel.js')

const snapshot = { byId: { [SESSION]: { id: SESSION, displayTitle: 'Ready thread' } } }
const sessions = { list: { getSnapshot: () => snapshot, subscribe: () => () => undefined } } as unknown as ISessions
const t = ((key: string) => key) as Parameters<typeof WaitingThreadsPanel>[0]['t']

const renderPanel = (props: { readonly confirmLand?: (sessionId: string) => boolean; readonly openThread?: (sessionId: string) => void }) => {
  render(<WaitingThreadsPanel t={t} sessions={sessions} openThread={props.openThread ?? (() => undefined)} confirmLand={props.confirmLand} />)
  fireEvent.mouseDown(screen.getByRole('tab', { name: /waitingThreadsReady/u }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Inbox › Waiting threads Land', () => {
  it('opens the header confirmation for the thread on the first click and lands nothing', () => {
    const confirmLand = vi.fn(() => true)
    renderPanel({ confirmLand })
    fireEvent.click(screen.getByRole('button', { name: 'Land' }))
    expect(confirmLand).toHaveBeenCalledWith(SESSION)
    expect(inbox.act).not.toHaveBeenCalled()
  })

  it('opens the thread when nothing can confirm, still landing nothing', () => {
    const openThread = vi.fn()
    renderPanel({ confirmLand: () => false, openThread })
    fireEvent.click(screen.getByRole('button', { name: 'Land' }))
    expect(openThread).toHaveBeenCalledWith(SESSION)
    expect(inbox.act).not.toHaveBeenCalled()
  })
})
