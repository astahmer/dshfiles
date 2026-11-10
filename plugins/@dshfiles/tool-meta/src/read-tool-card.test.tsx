// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileToolCall } from './file-tool-models.js'
import { ReadToolCard, type ReadTranslate } from './read-tool-card.js'

afterEach(cleanup)

const labels = { 'tool.title.read': 'Read', 'read.window': 'Showing {shown} of {total} lines' } as const
const t: ReadTranslate = (key, params) => (labels[key] ?? key).replaceAll(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name] ?? ''))

const useDisclosure = () => {
  const [expanded, setExpanded] = useState(false)
  return { expanded, setExpanded, toggle: () => setExpanded(value => !value) }
}

const readCall = (lines: readonly (readonly [number, string])[], totalLines: number): FileToolCall => ({
  phase: 'result',
  toolName: 'read',
  cwd: '/repo',
  block: {
    isError: false,
    call: { argsRaw: '{}' },
    content: [
      {
        type: 'text',
        text: `<path>/repo/src/cart/pricing.ts</path>\n<type>file</type>\n<content>\n${lines.map(([number, text]) => `${number}: ${text}`).join('\n')}\n\n(End of file - total ${totalLines} lines)\n</content>`,
      },
    ],
    meta: {
      path: '/repo/src/cart/pricing.ts',
      offset: lines[0]?.[0] ?? 1,
      lines: lines.map(([number, text]) => ({ number, text })),
      totalLines,
      lang: 'ts',
    },
  },
})

describe('ReadToolCard', () => {
  it('keeps the file closed behind its path and line count until opened', () => {
    const view = render(
      <ReadToolCard
        call={readCall(
          [
            [27, 'const unit = 1'],
            [28, 'const price = 2'],
          ],
          120,
        )}
        native={null}
        openFile={() => undefined}
        t={t}
        useDisclosure={useDisclosure}
      />,
    )
    expect(view.getByText('pricing.ts')).toBeTruthy()
    expect(view.getByText('Showing 2 of 120 lines')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-line]')).toHaveLength(0)
  })

  it('numbers the window from the offset once opened, and opens the file where the call looked', () => {
    const openFile = vi.fn()
    const view = render(
      <ReadToolCard
        call={readCall(
          [
            [27, 'const unit = 1'],
            [28, 'const price = 2'],
          ],
          120,
        )}
        native={null}
        openFile={openFile}
        t={t}
        useDisclosure={useDisclosure}
      />,
    )
    fireEvent.click(view.getByRole('button', { name: /Read/ }))
    expect([...view.container.querySelectorAll('[data-line]')].map(line => line.getAttribute('data-line'))).toEqual(['27', '28'])
    fireEvent.click(view.getByRole('button', { name: 'Open src/cart/pricing.ts' }))
    expect(openFile).toHaveBeenCalledWith('/repo/src/cart/pricing.ts', { line: 27 })
  })

  it('renders the native row for a call whose metadata cannot carry a code view', () => {
    const failed: FileToolCall = {
      phase: 'result',
      toolName: 'read',
      cwd: '/repo',
      block: { isError: true, content: [{ type: 'text', text: 'ENOENT' }], call: { argsRaw: '{}' } },
    }
    const view = render(<ReadToolCard call={failed} native={<span>native read row</span>} openFile={() => undefined} t={t} useDisclosure={useDisclosure} />)
    expect(view.getByText('native read row')).toBeTruthy()
  })
})
