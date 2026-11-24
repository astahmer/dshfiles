import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const rule = (css: string, selector: string): string =>
  new RegExp(`(?:^|\\n)\\s*${selector.replaceAll('.', '\\.').replaceAll(':', '\\:')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('small transcript fixes (round three C15, C16, C7, F11)', () => {
  it('sets "Worked for" in the tool rows\' size, so a turn\'s rows share one size', () => {
    const root = rule(read('../src/native/chat/TurnProcessNodeView.module.css'), '.root')
    expect(root).toContain('font-size: max(var(--dsh-content-font-size-secondary, 13px), var(--dshx-density-text-ui, 13px));')
  })

  it('leads the failure card with the red cross of the list and the tabs, and keeps its words ink', () => {
    const item = read('../src/native/chat/MessageItem.tsx')
    expect(item).toContain('<StatusGlyph')
    expect(item).not.toContain('<StateDot state="error"')
    const title = rule(read('../src/native/chat/MessageItem.module.css'), '.turnErrorTitle')
    expect(title).not.toContain('state-error')
    expect(title).toContain('color: var(--dsw-alias-label-primary);')
  })

  it('calls a background job a job', () => {
    expect(read('../src/native/locale.ts')).toContain("'message.trigger.job': 'Background job updated',")
  })

  it('gives "Back to bottom" a 44px target on a touch screen', () => {
    const css = read('../src/native/chat/ChatView.module.css')
    const coarse = /@media \(pointer: coarse\) \{\s*\.toBottom::after \{([^}]*)\}/.exec(css)?.[1] ?? ''
    // 34px plus 5px on each side.
    expect(coarse).toContain('inset: -5px;')
  })
})
