// @vitest-environment jsdom
/**
 * Council round 8 A6: a wrapped code line continues 2ch right of its own statement's indent, not 2ch from column 0.
 * CSS cannot count a line's leading whitespace, so `CodeIndent` measures it and hands it to the wrap rule as
 * `--dshx-line-indent` (the transcript's `.line` rule in ui-styles, the kit CodeBlock's own style).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeBlock } from '../src/components/code-block.js'
import { CodeIndent } from '../src/lib/code-indent.js'

afterEach(cleanup)

describe('CodeIndent (council round 8 A6)', () => {
  it('counts the leading columns of a line, expanding tabs to the tab stop', () => {
    expect(CodeIndent.columns('    item.unitPriceCents', 4)).toBe(4)
    expect(CodeIndent.columns('\titem', 4)).toBe(4)
    expect(CodeIndent.columns('  \titem', 4)).toBe(4)
    expect(CodeIndent.columns('\t\titem', 2)).toBe(4)
    expect(CodeIndent.columns('item', 4)).toBe(0)
    // A blank or whitespace-only line has no statement to hang from.
    expect(CodeIndent.columns('', 4)).toBe(0)
    expect(CodeIndent.columns('      ', 4)).toBe(0)
  })

  it('marks each highlighted `.line` with its indent and clears a stale one', () => {
    const code = document.createElement('code')
    code.innerHTML = '<span class="line"><span>    </span><span>total +=</span></span><span class="line"><span>return</span></span>'
    const [first, second] = [...code.querySelectorAll<HTMLElement>('.line')]
    second!.style.setProperty('--dshx-line-indent', '6ch')
    expect(CodeIndent.mark(code, 4)).toBe(2)
    expect(first!.style.getPropertyValue('--dshx-line-indent')).toBe('4ch')
    expect(second!.style.getPropertyValue('--dshx-line-indent')).toBe('')
  })

  it('feeds the transcript wrap rule, which falls back to the plain 2ch hang without it', () => {
    const transcript = readFileSync(join(process.cwd(), '../ui-styles/src/transcript.css'), 'utf8')
    const at = transcript.indexOf(".md-code-block[data-code-wrap='true'] pre code > .line {")
    const rule = transcript.slice(at, transcript.indexOf('}', at))
    expect(rule).toContain('padding-inline-start: calc(var(--dshx-line-indent, 0ch) + 2ch);')
    expect(rule).toContain('text-indent: calc(-1 * (var(--dshx-line-indent, 0ch) + 2ch));')
  })

  it('hangs a wrapped kit CodeBlock line from its own indent', () => {
    const view = render(<CodeBlock code={'for (const item of items) {\n    total += item.unitPriceCents * item.quantity\n}'} defaultWrap startLine={false} />)
    const texts = [...view.container.querySelectorAll<HTMLElement>('[data-line-text]')]
    expect(texts).toHaveLength(3)
    expect(texts[0]!.style.getPropertyValue('--dshx-line-indent')).toBe('0ch')
    expect(texts[1]!.style.getPropertyValue('--dshx-line-indent')).toBe('4ch')
    expect(texts[1]!.style.paddingInlineStart).toBe('calc(var(--dshx-line-indent) + 2ch)')
    expect(texts[1]!.style.textIndent).toBe('calc(-1 * (var(--dshx-line-indent) + 2ch))')
    // Unwrapped, nothing hangs.
    cleanup()
    const flat = render(<CodeBlock code={'    total'} startLine={false} />)
    expect(flat.container.querySelector<HTMLElement>('[data-line-text]')!.style.textIndent).toBe('')
  })
})
