// @vitest-environment jsdom

import { fireEvent } from '@testing-library/dom'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeBlock } from '../src/components/code-block.js'
import { locationFrame, StackTrace } from '../src/components/stack-trace.js'
import { StackFrames } from '../src/lib/stack-frames.js'

afterEach(cleanup)

describe('CodeBlock', () => {
  it('numbers lines from startLine, marks highlighted lines and toggles wrapping', () => {
    const view = render(<CodeBlock code={'const a = 1\n\nconst b = a + 1\n'} highlightLines={[30]} path="src/cart/pricing.ts" startLine={28} />)
    const lines = view.container.querySelectorAll('[data-line]')
    expect([...lines].map(line => line.getAttribute('data-line'))).toEqual(['28', '29', '30'])
    expect(lines[2]?.className).toContain('dshx:bg-muted')
    expect(lines[0]?.className).not.toContain('dshx:bg-muted')
    expect(view.getByText('pricing.ts')).toBeTruthy()

    const wrap = view.getByRole('button', { name: 'Wrap lines' })
    expect(wrap.getAttribute('aria-pressed')).toBe('false')
    expect(lines[0]?.className).toContain('dshx:whitespace-pre')
    fireEvent.click(wrap)
    expect(wrap.getAttribute('aria-pressed')).toBe('true')
    expect(view.container.querySelector('[data-line="28"]')?.className).toContain('dshx:whitespace-pre-wrap')
  })

  it('downloads the code under its file name, and hides the gutter and download on request', () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:code')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const view = render(<CodeBlock code="print('hi')" path="scripts/hello.py" />)
    fireEvent.click(view.getByRole('button', { name: 'Download' }))
    expect(createObjectURL).toHaveBeenCalledOnce()
    const anchor = click.mock.contexts[0]
    expect(anchor instanceof HTMLAnchorElement ? anchor.download : undefined).toBe('hello.py')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:code')
    click.mockRestore()
    cleanup()

    const bare = render(<CodeBlock code="echo hi" downloadable={false} lang="bash" startLine={false} />)
    expect(bare.queryByRole('button', { name: 'Download' })).toBeNull()
    expect(bare.container.querySelector('[data-line]')).toBeNull()
    expect(bare.getByText('bash')).toBeTruthy()
  })
})

describe('StackTrace', () => {
  const report = StackFrames.extract(
    [
      'TypeError: price is not a number',
      '    at total (/srv/app/src/cart.js:12:9)',
      '    at Module._compile (node:internal/modules/cjs/loader:1554:14)',
      '    at Object.<anonymous> (/srv/app/src/server.js:9:3)',
    ].join('\n'),
  )

  it('folds library frames into one row, with no heading, and opens a frame at its line', () => {
    const openFile = vi.fn()
    const view = render(<StackTrace frames={report?.frames ?? []} openFile={openFile} />)
    const list = view.getByRole('list', { name: 'Stack frames' })
    expect(list.textContent).toContain('total')
    expect(list.textContent).toContain('cart.js:12')
    expect(list.textContent).not.toContain('_compile')
    expect(view.queryByRole('heading')).toBeNull()

    const library = view.getByRole('button', { name: '1 library frame' })
    expect(library.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(library)
    expect(library.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByRole('list', { name: 'Stack frames' }).textContent).toContain('_compile')

    fireEvent.click(view.getByRole('button', { name: /^total/ }))
    expect(openFile).toHaveBeenCalledWith('/srv/app/src/cart.js', { line: 12 })
  })

  it('shows vitest locations as bare file:line frames', () => {
    const view = render(<StackTrace frames={[locationFrame({ file: 'src/cart/sync.test.ts', line: 3, column: 1 }, 0)]} />)
    expect(view.getByRole('list', { name: 'Stack frames' }).textContent).toContain('src/cart/sync.test.ts:3:1')
    expect(view.getByRole('list', { name: 'Stack frames' }).textContent).not.toContain('()')
  })
})
