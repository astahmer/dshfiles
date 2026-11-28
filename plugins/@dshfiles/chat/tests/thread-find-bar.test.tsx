// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadFindBar, type ThreadFindBarProps } from '../src/native/chat/ThreadFindBar.tsx'
import { en } from '../src/native/locale.ts'
import { ThreadFindPort, type ThreadFindCall } from '../src/thread-find-port.ts'

// The shipped English table: a label key the bar uses but the locale lacks shows up as the raw key and fails the queries.
const LABELS = new Map<string, string>(Object.entries(en))

const t: ThreadFindBarProps['t'] = (key, params) =>
  Object.entries(params ?? {}).reduce((label, [name, value]) => label.replace(`{${name}}`, String(value)), LABELS.get(key) ?? key)

afterEach(() => {
  cleanup()
  ThreadFindPort.set(null)
  document.body.replaceChildren()
})

describe('ThreadFindBar filters', () => {
  it('passes selected event-type filters to ThreadFindPort and omits types for All', async () => {
    const corpus = [
      { seq: 2, type: 'user/message', snippet: 'quartz prompt' },
      { seq: 5, type: 'tool/result', snippet: 'quartz tool output' },
      { seq: 10, type: 'assistant/message', snippet: 'quartz answer' },
    ]
    const calls: Parameters<ThreadFindCall>[0][] = []
    ThreadFindPort.set(async input => {
      calls.push(input)
      const matches = input.types === undefined ? corpus : corpus.filter(hit => input.types?.includes(hit.type))
      return { ownsService: true, matches, hasMore: false }
    })

    const onClose = vi.fn()
    render(
      <ThreadFindBar
        sessionId="session-index"
        focusRequest={1}
        onClose={onClose}
        list={() => null}
        anchors={[{ turn: 1, seq: 1 }]}
        rowFor={() => null}
        revealTurn={() => {}}
        readerSeq={() => null}
        t={t}
      />,
    )

    const input = screen.getByRole('searchbox', { name: 'Find in thread' })
    fireEvent.change(input, { target: { value: 'quartz' } })

    await waitFor(() => expect(screen.getByText('1 of 3')).toBeTruthy())
    expect(calls[0]?.types).toBeUndefined()

    const agentButton = screen.getByRole('button', { name: 'Agent' })
    fireEvent.click(agentButton)
    expect(agentButton.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeTruthy())
    expect(calls[1]?.types).toEqual(['assistant/message'])

    const userButton = screen.getByRole('button', { name: 'User' })
    fireEvent.click(userButton)
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeTruthy())
    expect(calls[2]?.types).toEqual(['assistant/message', 'user/message'])

    const allButton = screen.getByRole('button', { name: 'All' })
    fireEvent.click(allButton)
    expect(allButton.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(screen.getByText('1 of 3')).toBeTruthy())

    fireEvent.keyDown(agentButton, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows Searching instead of the previous filter matches while a new filter loads', async () => {
    const corpus = [
      { seq: 2, type: 'user/message', snippet: 'quartz prompt' },
      { seq: 10, type: 'assistant/message', snippet: 'quartz answer' },
    ]
    const pending: (() => void)[] = []
    ThreadFindPort.set(input => {
      const matches = input.types === undefined ? corpus : corpus.filter(hit => input.types?.includes(hit.type))
      const reply = { ownsService: true, matches, hasMore: false }
      if (input.types === undefined) return Promise.resolve(reply)
      return new Promise(resolve => pending.push(() => resolve(reply)))
    })

    render(
      <ThreadFindBar
        sessionId="session-pending"
        focusRequest={1}
        onClose={() => {}}
        list={() => null}
        anchors={[{ turn: 1, seq: 1 }]}
        rowFor={() => null}
        revealTurn={() => {}}
        readerSeq={() => null}
        t={t}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in thread' }), { target: { value: 'quartz' } })
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    await waitFor(() => expect(pending).toHaveLength(1))
    expect(screen.getByText('Searching…')).toBeTruthy()
    expect(screen.queryByText('1 of 2')).toBeNull()
    expect(screen.getByRole('button', { name: 'Older match (↵)' }).hasAttribute('disabled')).toBe(true)

    pending[0]?.()
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeTruthy())
  })

  it('filters the newest matches here and says so when the Host refuses event types', async () => {
    const corpus = [
      { seq: 2, type: 'user/message', snippet: 'quartz prompt' },
      { seq: 5, type: 'tool/result', snippet: 'quartz tool output' },
      { seq: 10, type: 'assistant/message', snippet: 'quartz answer' },
    ]
    const calls: Parameters<ThreadFindCall>[0][] = []
    ThreadFindPort.set(async input => {
      calls.push(input)
      if (input.types !== undefined) throw new Error('Unexpected key "types"')
      return { ownsService: true, matches: corpus, hasMore: false }
    })

    render(
      <ThreadFindBar
        sessionId="session-old-host"
        focusRequest={1}
        onClose={() => {}}
        list={() => null}
        anchors={[{ turn: 1, seq: 1 }]}
        rowFor={() => null}
        revealTurn={() => {}}
        readerSeq={() => null}
        t={t}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in thread' }), { target: { value: 'quartz' } })
    await waitFor(() => expect(screen.getByText('1 of 3')).toBeTruthy())
    expect(screen.queryByText(/Filters cover only/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeTruthy())
    expect(screen.getByText(/^Filters cover only the newest 500 matches: update @dshfiles\/session-search/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(calls.slice(1).map(call => call.types)).toEqual([['assistant/message'], undefined])
  })

  it('filters loaded DOM rows when session-search is unavailable', async () => {
    ThreadFindPort.set(null)
    const list = document.createElement('div')
    list.innerHTML = [
      '<div data-chat-node-key="u1" data-chat-flow-kind="user">quartz prompt</div>',
      '<div data-chat-node-key="t1" data-chat-flow-kind="tool-call">quartz tool output</div>',
      '<div data-chat-node-key="a1" data-chat-flow-kind="assistant-step">quartz agent reply</div>',
    ].join('')
    document.body.append(list)

    render(
      <ThreadFindBar
        sessionId="session-loaded"
        focusRequest={1}
        onClose={() => {}}
        list={() => list}
        anchors={[]}
        rowFor={() => null}
        revealTurn={() => {}}
        readerSeq={() => null}
        t={t}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in thread' }), { target: { value: 'quartz' } })
    await waitFor(() => expect(screen.getByText('1 of 3')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    await waitFor(() => expect(screen.getByText('1 of 1')).toBeTruthy())
  })
})
