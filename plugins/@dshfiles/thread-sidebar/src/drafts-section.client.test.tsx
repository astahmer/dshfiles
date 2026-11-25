// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { DraftsSection } from './drafts-section.js'
import { threadSidebarDictionaries } from './locales.js'
import type { ThreadSidebarTranslate } from './thread-view-manager.js'

// The test primitives stub has no relative-time formatter.
vi.mock('./relative-age.js', () => ({ formatAge: () => '1m' }))

const english: Readonly<Record<string, string>> = threadSidebarDictionaries.en

/** The native `t`: a missing key reads back as itself, which is how `plural` probes variants. */
const translate: ThreadSidebarTranslate = (key, params) =>
  (english[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))

const drafts = Array.from({ length: 6 }, (_, index) => ({
  id: `session-${String(index + 1)}`,
  displayTitle: `thread-00${String(index + 1)}`,
  updatedAt: Date.now() - 60_000,
}))

const fill = (cleanable: boolean) => {
  const onConfirm = vi.fn()
  render(
    <TooltipProvider>
      <DraftsSection
      drafts={drafts}
      open={false}
      onOpenChange={vi.fn()}
      cleanable={cleanable}
      cleaning={false}
      onConfirm={onConfirm}
      renderRow={row => <div key={row.id}>{row.displayTitle}</div>}
      headerClassName=""
      t={translate}
      />
    </TooltipProvider>,
  )
  return { onConfirm }
}

afterEach(cleanup)

describe('Empty drafts clean up', () => {
  it('is not offered while the list is not loaded or DSH is away', () => {
    fill(false)
    expect(screen.getByText('Empty drafts')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Clean up empty drafts' })).toBeNull()
  })

  it('asks first, naming the drafts, and archives nothing before Confirm', () => {
    const { onConfirm } = fill(true)
    fireEvent.click(screen.getByRole('button', { name: 'Clean up empty drafts' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('Archive 6 empty drafts?')
    for (const name of ['thread-001', 'thread-002', 'thread-003', 'thread-004', 'thread-005']) expect(dialog.textContent).toContain(name)
    expect(dialog.textContent).not.toContain('thread-006')
    expect(dialog.textContent).toContain('and 1 more')
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Archive 6 drafts' }))
    expect(onConfirm).toHaveBeenCalledWith(drafts.map(draft => draft.id))
  })

  it('archives nothing on Cancel', () => {
    const { onConfirm } = fill(true)
    fireEvent.click(screen.getByRole('button', { name: 'Clean up empty drafts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
