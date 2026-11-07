// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeFenceModel } from '../src/code-fence-transform.tsx'
import type { CodeFenceProps, CodeFenceRenderer } from '../src/code-fences.tsx'

afterEach(cleanup)

/**
 * The trees are built the way the native renderer builds them: one root `div` whose children are the top-level blocks
 * with newline strings between them, and each fence a `CodeBlock` element carrying its source with a trailing newline,
 * the first word of its info string as `lang`, and the message-wide `streaming` flag. This stand-in plays `CodeBlock`;
 * the transform matches whatever component the caller passes, as Chat passes the native one.
 */
const CodeBlock = (props: { readonly code: string; readonly lang?: string | undefined; readonly streaming?: boolean | undefined; readonly showHeader?: boolean | undefined }): ReactNode => (
  <pre data-native-code={props.lang ?? ''} data-header={String(props.showHeader ?? true)}>
    {props.code}
  </pre>
)
const fence = (key: string, lang: string, code: string, streaming = false): ReactNode => <CodeBlock key={key} code={`${code}\n`} lang={lang} streaming={streaming} />
const paragraph = (key: string, text: string): ReactNode => <p key={key}>{text}</p>
const root = (...blocks: readonly ReactNode[]): ReactNode => <div data-markdown="">{blocks.flatMap((block, index) => (index === 0 ? [block] : ['\n', block]))}</div>

/** One transform state per mounted message, as `InlineReferenceMarkdown` keeps it. */
const Fenced = (props: { readonly tree: ReactNode; readonly items: readonly CodeFenceRenderer[] }): ReactNode => {
  const state = useRef(CodeFenceModel.state(props.items, CodeBlock))
  return CodeFenceModel.transform(props.tree, state.current)
}

const Diagram = (props: CodeFenceProps): ReactNode => (props.streaming ? props.fallback : <figure data-diagram={props.lang}>{props.code}</figure>)
const diagrams: CodeFenceRenderer = { id: 'diagram', languages: ['Mermaid'], Component: Diagram }

describe('code fence renderers', () => {
  it('hands a claimed fence to its renderer, nested ones included, and leaves other fences native', () => {
    const tree = root(
      fence('a', 'mermaid', 'flowchart LR\n  A --> B'),
      fence('b', 'ts', 'const a = 1'),
      <ul key="c">
        <li>{fence('nested', 'MERMAID', 'pie')}</li>
      </ul>,
    )
    const { container } = render(<Fenced tree={tree} items={[diagrams]} />)
    expect([...container.querySelectorAll('[data-diagram]')].map(element => element.textContent)).toEqual(['flowchart LR\n  A --> B', 'pie'])
    expect([...container.querySelectorAll('[data-native-code]')].map(element => element.getAttribute('data-native-code'))).toEqual(['ts'])
    expect(container.querySelector('li [data-diagram="mermaid"]')).not.toBeNull()
  })

  it('offers the code without the native header as source', () => {
    const Source = (props: CodeFenceProps): ReactNode => <figure data-diagram={props.lang}>{props.source}</figure>
    const { container } = render(<Fenced tree={root(fence('a', 'mermaid', 'pie'))} items={[{ id: 'source', languages: ['mermaid'], Component: Source }]} />)
    expect(container.querySelector('[data-diagram] [data-native-code="mermaid"]')?.getAttribute('data-header')).toBe('false')
  })

  it('renders a fence as soon as another block follows it, while the last block of a streaming message stays native', () => {
    const { container, rerender } = render(<Fenced tree={root(fence('a', 'mermaid', 'pie', true))} items={[diagrams]} />)
    expect(container.querySelector('[data-diagram]')).toBeNull()
    expect(container.querySelector('[data-native-code="mermaid"]')).not.toBeNull()
    rerender(<Fenced tree={root(fence('a', 'mermaid', 'pie', true), paragraph('b', 'More text'), fence('c', 'mermaid', 'flowchart', true))} items={[diagrams]} />)
    expect([...container.querySelectorAll('[data-diagram]')].map(element => element.textContent)).toEqual(['pie'])
    expect(container.querySelector('[data-native-code="mermaid"]')?.textContent).toBe('flowchart\n')
  })

  it('keeps a frozen streaming block rendered once while the tail grows', () => {
    const renders = vi.fn()
    const Counting = (props: CodeFenceProps): ReactNode => {
      renders(props.code)
      return <figure data-diagram={props.lang}>{props.code}</figure>
    }
    const items = [{ id: 'count', languages: ['mermaid'], Component: Counting }]
    const frozen = fence('a', 'mermaid', 'pie', true)
    const { rerender } = render(<Fenced tree={root(frozen, paragraph('b', 'first'))} items={items} />)
    rerender(<Fenced tree={root(frozen, paragraph('b', 'first words'))} items={items} />)
    rerender(<Fenced tree={root(frozen, paragraph('b', 'first words more'))} items={items} />)
    expect(renders).toHaveBeenCalledTimes(1)
  })

  it('shows the native card when a renderer throws, and tries again for new source', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = (props: CodeFenceProps): ReactNode => {
      if (props.code === 'boom') throw new Error('nope')
      return <figure data-diagram={props.lang}>{props.code}</figure>
    }
    const items = [{ id: 'broken', languages: ['mermaid'], Component: Broken }]
    const { container, rerender } = render(<Fenced tree={root(fence('a', 'mermaid', 'boom'))} items={items} />)
    expect(container.querySelector('[data-native-code="mermaid"]')?.textContent).toBe('boom\n')
    rerender(<Fenced tree={root(fence('a', 'mermaid', 'pie'))} items={items} />)
    expect(container.querySelector('[data-diagram]')?.textContent).toBe('pie')
    error.mockRestore()
  })

  it('renders exactly the native tree without renderers or claimed fences', () => {
    const tree = root(paragraph('a', 'text'), fence('b', 'ts', 'const a = 1'))
    expect(CodeFenceModel.transform(tree, CodeFenceModel.state([], CodeBlock))).toBe(tree)
    expect(CodeFenceModel.transform(tree, CodeFenceModel.state([diagrams], CodeBlock))).toBe(tree)
  })
})
