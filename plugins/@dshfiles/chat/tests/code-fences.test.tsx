// @vitest-environment jsdom
import { MarkdownDelegateProvider, type MarkdownDelegateFenceInfo } from '@deepseek-ai/dsh-client-ui-primitives'
import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeFenceSeat } from '../src/code-fence-seat.tsx'
import type { CodeFenceProps, CodeFenceRenderer } from '../src/code-fences.tsx'

/**
 * The native primitives bundle pulls browser-only dependencies, so this stands in for the DSH 0.2.2 contract the seat
 * relies on: the delegate context, and a renderer that draws every fence with a language in a seat which asks the
 * nearest delegate's `renderCode` (language lower-cased) and otherwise draws its built-in `FenceCodeBlock`.
 */
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  const Delegate = React.createContext<{ readonly renderCode?: ((fence: MarkdownDelegateFenceInfo) => ReactNode) | undefined }>({})
  const MarkdownDelegateProvider = ({ children, ...delegate }: { readonly children: ReactNode; readonly renderCode?: (fence: MarkdownDelegateFenceInfo) => ReactNode }) =>
    React.createElement(Delegate.Provider, { value: delegate }, children)
  const useMarkdownDelegate = () => React.useContext(Delegate)
  const CodeBlock = (props: { readonly code: string; readonly lang?: string | undefined; readonly showHeader?: boolean | undefined }) =>
    React.createElement('pre', { 'data-native-code': props.lang ?? '', 'data-header': String(props.showHeader ?? true) }, props.code)
  const FenceCodeBlock = (props: { readonly code: string; readonly lang?: string | undefined }) => React.createElement(CodeBlock, { code: `${props.code}\n`, lang: props.lang })
  const FenceMathBlock = (props: { readonly code: string }) => React.createElement('math', null, props.code)
  const Seat = (props: { readonly lang: string; readonly code: string; readonly streaming: boolean }) => {
    const { renderCode } = useMarkdownDelegate()
    return renderCode === undefined
      ? React.createElement(FenceCodeBlock, props)
      : React.createElement('div', { 'data-seat': '' }, renderCode({ lang: props.lang.toLowerCase(), code: props.code, streaming: props.streaming }))
  }
  /** Fences are `lang:code` lines; anything else is a paragraph. */
  const MarkdownText = (props: { readonly text: string; readonly streaming?: boolean }) =>
    React.createElement('div', { 'data-markdown': '' }, props.text.split('\n').map((line, index) => {
      const fence = /^(\w+):(.*)$/.exec(line)
      return fence === null
        ? React.createElement('p', { key: index }, line)
        : React.createElement(Seat, { key: index, lang: fence[1] ?? '', code: fence[2] ?? '', streaming: props.streaming ?? false })
    }))
  return { CodeBlock, FenceCodeBlock, FenceMathBlock, MarkdownDelegateProvider, MarkdownText, useMarkdownDelegate }
})

const { MarkdownText } = await import('@deepseek-ai/dsh-client-ui-primitives')

afterEach(cleanup)

const labels = { copyLabel: 'Copy', copiedLabel: 'Copied' }

/** The native renderer under the seat, as `FencedMarkdown` and `InlineReferenceMarkdown` mount it. */
const Fenced = (props: { readonly text: string; readonly renderers: readonly CodeFenceRenderer[]; readonly streaming?: boolean }): ReactNode => (
  <CodeFenceSeat renderers={props.renderers} labels={labels}>
    <MarkdownText text={props.text} streaming={props.streaming ?? false} labels={{ code: labels, footnotes: 'Footnotes' }} />
  </CodeFenceSeat>
)

const Diagram = (props: CodeFenceProps): ReactNode => (props.streaming ? props.fallback : <figure data-diagram={props.lang}>{props.code}</figure>)
const diagrams: CodeFenceRenderer = { id: 'diagram', languages: ['Mermaid'], Component: Diagram }

const diagramTexts = (container: HTMLElement): readonly (string | null)[] =>
  [...container.querySelectorAll('[data-diagram]')].map(element => element.textContent)

describe('code fence renderers', () => {
  it('hands a claimed fence to its renderer, whatever its case, and leaves other fences native', () => {
    const { container } = render(<Fenced text={'mermaid:flowchart\nts:const a = 1\nMERMAID:pie'} renderers={[diagrams]} />)
    expect(diagramTexts(container)).toEqual(['flowchart', 'pie'])
    expect([...container.querySelectorAll('[data-native-code]')].map(element => element.getAttribute('data-native-code'))).toEqual(['ts'])
  })

  it('offers the code without the native header as source, and the native card as fallback', () => {
    const Both = (props: CodeFenceProps): ReactNode => (
      <figure data-diagram={props.lang}>
        <div data-part="source">{props.source}</div>
        <div data-part="fallback">{props.fallback}</div>
      </figure>
    )
    const { container } = render(<Fenced text="mermaid:pie" renderers={[{ id: 'both', languages: ['mermaid'], Component: Both }]} />)
    expect(container.querySelector('[data-part="source"] [data-native-code="mermaid"]')?.getAttribute('data-header')).toBe('false')
    expect(container.querySelector('[data-part="fallback"] [data-native-code="mermaid"]')?.getAttribute('data-header')).toBe('true')
  })

  it('tells the renderer while the message still streams', () => {
    const { container, rerender } = render(<Fenced text="mermaid:pie" renderers={[diagrams]} streaming />)
    expect(container.querySelector('[data-diagram]')).toBeNull()
    expect(container.querySelector('[data-native-code="mermaid"]')?.textContent).toBe('pie\n')
    rerender(<Fenced text="mermaid:pie" renderers={[diagrams]} />)
    expect(diagramTexts(container)).toEqual(['pie'])
  })

  it('falls back to the enclosing delegate, which keeps rendering every fence the renderers do not claim', () => {
    const outer = (fence: MarkdownDelegateFenceInfo): ReactNode => <pre data-outer={fence.lang}>{fence.code}</pre>
    const Fallback = (props: CodeFenceProps): ReactNode => <figure data-diagram={props.lang}>{props.fallback}</figure>
    const { container } = render(
      <MarkdownDelegateProvider renderCode={outer}>
        <Fenced text={'mermaid:pie\ndiff:+b'} renderers={[{ id: 'fallback', languages: ['mermaid'], Component: Fallback }]} />
      </MarkdownDelegateProvider>,
    )
    expect(container.querySelector('[data-diagram="mermaid"] [data-outer="mermaid"]')?.textContent).toBe('pie')
    expect(container.querySelector('[data-outer="diff"]')?.closest('[data-diagram]')).toBeNull()
  })

  it('shows the native card when a renderer throws, and tries again for new source', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = (props: CodeFenceProps): ReactNode => {
      if (props.code === 'boom') throw new Error('nope')
      return <figure data-diagram={props.lang}>{props.code}</figure>
    }
    const renderers = [{ id: 'broken', languages: ['mermaid'], Component: Broken }]
    const { container, rerender } = render(<Fenced text="mermaid:boom" renderers={renderers} />)
    expect(container.querySelector('[data-native-code="mermaid"]')?.textContent).toBe('boom\n')
    rerender(<Fenced text="mermaid:pie" renderers={renderers} />)
    expect(diagramTexts(container)).toEqual(['pie'])
    error.mockRestore()
  })

  it('adds nothing without renderers', () => {
    const text = 'text\nts:const a = 1'
    const native = render(<MarkdownText text={text} streaming={false} labels={{ code: labels, footnotes: 'Footnotes' }} />).container.innerHTML
    cleanup()
    expect(render(<Fenced text={text} renderers={[]} />).container.innerHTML).toBe(native)
  })
})
