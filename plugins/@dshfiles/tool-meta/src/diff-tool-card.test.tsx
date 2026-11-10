// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FileToolCall } from './file-tool-models.js'
import { DiffToolCard, type DiffTranslate } from './diff-tool-card.js'

afterEach(cleanup)

const labels = {
  'tool.title.edit': 'Edit',
  'tool.title.write': 'Write',
  'diff.expandAria': 'Expand diff',
  'diff.collapseAria': 'Collapse diff',
} as const
const t: DiffTranslate = key => labels[key]

const useDisclosure = () => {
  const [expanded, setExpanded] = useState(false)
  return { expanded, setExpanded, toggle: () => setExpanded(value => !value) }
}

const editCall = (hunks: readonly { readonly oldText: string | null; readonly newText: string }[]): FileToolCall => ({
  phase: 'result',
  toolName: 'edit',
  cwd: '/repo',
  block: {
    isError: false,
    call: { argsRaw: JSON.stringify({ file_path: 'src/cart/pricing.ts' }) },
    content: [{ type: 'text', text: 'Edited src/cart/pricing.ts' }],
    meta: { path: '/repo/src/cart/pricing.ts', diffs: hunks.map(hunk => ({ path: '/repo/src/cart/pricing.ts', ...hunk })) },
  },
})

const card = (call: FileToolCall, native: JSX.Element | null = null) => <DiffToolCard call={call} native={native} t={t} useDisclosure={useDisclosure} />

describe('DiffToolCard', () => {
  it('summarizes the applied lines and keeps the diff closed until the card is opened', () => {
    const view = render(card(editCall([{ oldText: 'a\nb\nc', newText: 'a\nB\nc' }])))
    expect(view.getByText('Edit')).toBeTruthy()
    expect(view.getByText('+1 −1')).toBeTruthy()
    expect(view.container.querySelector('[data-diff-path]')).toBeNull()
  })

  it('renders one collapsible unified diff per hunk, each hunk closing on its own', () => {
    const view = render(card(editCall([{ oldText: 'a\nb\nc', newText: 'a\nB\nc' }])))
    fireEvent.click(view.getByRole('button', { name: /Edit/ }))
    expect(view.container.querySelectorAll('[data-diff-path]')).toHaveLength(1)

    fireEvent.click(view.getByRole('button', { name: 'Collapse diff' }))
    expect(view.container.querySelector('[data-diff-path]')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Expand diff' }))
    expect(view.container.querySelectorAll('[data-diff-path]')).toHaveLength(1)
  })

  it('keeps the native row for a call the diff model declines', () => {
    const failed: FileToolCall = {
      phase: 'result',
      toolName: 'edit',
      cwd: '/repo',
      block: { isError: true, content: [{ type: 'text', text: 'old_string not found' }], call: { argsRaw: JSON.stringify({ file_path: 'src/a.ts' }) } },
    }
    expect(render(card(failed, <span>native edit row</span>)).getByText('native edit row')).toBeTruthy()
  })

  it('shows every hunk of an apply_patch call, which has no native row to fall back to', () => {
    const patch: FileToolCall = {
      phase: 'result',
      toolName: 'apply_patch',
      cwd: '/repo',
      block: {
        isError: false,
        call: {
          argsRaw: JSON.stringify({
            path: '/repo/src/a.ts',
            edits: [
              { old: 'x', new: 'y' },
              { old: 'p\nq', new: 'p\nQ' },
            ],
          }),
        },
        content: [{ type: 'text', text: 'Applied 2 edits.' }],
      },
    }
    const view = render(card(patch))
    expect(view.getByText('apply_patch')).toBeTruthy()
    expect(view.getByText('+2 −2')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: /apply_patch/ }))
    expect(view.container.querySelectorAll('[data-diff-path]')).toHaveLength(2)
    expect(view.getAllByRole('button', { name: 'Collapse diff' })).toHaveLength(2)
  })

  it('shows the rejection text of a failed patch', () => {
    const rejected: FileToolCall = {
      phase: 'result',
      toolName: 'apply_patch',
      cwd: '/repo',
      block: {
        isError: true,
        call: { argsRaw: JSON.stringify({ path: '/repo/src/a.ts', edits: [{ old: 'x', new: 'y' }] }) },
        content: [{ type: 'text', text: 'old text not found' }],
      },
    }
    const view = render(card(rejected))
    fireEvent.click(view.getByRole('button', { name: /apply_patch/ }))
    expect(view.getByText('old text not found')).toBeTruthy()
  })
})
