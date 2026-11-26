// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnTriggerNodeView } from '../src/native/chat/TurnTriggerNodeView.tsx'
import { en } from '../src/native/locale.ts'

// The notice body (closed here) renders through the Host primitives, which need the browser's icon packages.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({}))

afterEach(cleanup)

// SAFETY: the view translates only its own keys through the English table.
const t = ((key: keyof typeof en, params?: Record<string, string | number>) =>
  Object.entries(params ?? {}).reduce<string>((text, [name, value]) => text.replace(`{${name}}`, String(value)), en[key] ?? key)) as never

const PARENT = 'session-parent'
const CHILD = 'session-child'
const list = {
  byId: {},
  projectionsBySession: { [PARENT]: { values: { subagentCatalog: [{ id: CHILD, mode: 'continuable', label: 'Diff the ledger export against totals' }] } } },
}

// SAFETY: the view reads the node's time, content and source; the fixture holds those.
const notice = (stopReason: string) =>
  ({
    data: {
      time: Date.UTC(2026, 10, 26, 17, 51),
      content: [{ type: 'text', text: 'Background subagent ledger-diff failed before it finished.' }],
      source: { kind: 'subagent-settled', form: 'notice', summary: 'x', stopReason, senderSessionId: CHILD },
    },
  }) as never

const renderNotice = (stopReason: string) =>
  render(
    <TurnTriggerNodeView
      node={notice(stopReason)}
      t={t}
      sessionId={PARENT as never}
      // SAFETY: the view reads only the parent's subagent catalog of the session list.
      useSessions={((select: (value: never) => unknown) => select(list as never)) as never}
    />,
  )

describe('a failed subagent run notice (council round 22, item 2)', () => {
  it('names the child and the reason, with the red cross, and keeps the notice title in its name', () => {
    renderNotice('error')
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('Diff the ledger export against totals · failed before it finished')
    expect(button.getAttribute('aria-label')).toMatch(/^Subagent run failed: Diff the ledger export against totals · failed before it finished, /u)
    expect(button.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('failed')
  })

  it('words each failure reason, and leaves a stopped or finished run as it was', () => {
    renderNotice('max-tokens')
    expect(screen.getByRole('button').textContent).toContain('· ran out of tokens')
    cleanup()
    renderNotice('aborted')
    expect(screen.getByRole('button').textContent).toContain('Subagent run stopped')
    expect(screen.getByRole('button').querySelector('[data-slot="status-glyph"]')).toBeNull()
  })

  it('keeps the notice title when the catalog does not name the child', () => {
    render(<TurnTriggerNodeView node={notice('error')} t={t} />)
    expect(screen.getByRole('button').textContent).toContain('Subagent run failed')
    expect(screen.getByRole('button').querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('failed')
  })
})
