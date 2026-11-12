// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codeLineCount } from '../src/code-fold.tsx'
import { MarkdownProse } from '../src/markdown-prose.tsx'

// The native primitives bundle pulls browser-only dependencies; the card's tooltip only needs to render its anchor.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Tooltip: (props: { readonly children: ReactNode }) => props.children }))

afterEach(cleanup)

/**
 * A stand-in for the native `CodeBlock`: a card whose toolbar (`data-code-block-banner`) ends with its action group,
 * and whose `wrap` prop the owner may set, as the native card does when it receives `toolbarLabels`.
 */
const CodeBlock = (props: {
  readonly code: string
  readonly streaming?: boolean | undefined
  readonly wrap?: boolean | undefined
  readonly toolbarLabels?: { readonly wrapLabel: string; readonly unwrapLabel: string; readonly codeLabel: string } | undefined
}): ReactNode => (
  <div className="md-code-block" data-code-wrap={props.wrap === undefined ? 'local' : String(props.wrap)}>
    <div data-code-block-banner="">
      <span>ts</span>
      <div data-actions="">
        <button type="button">Copy</button>
      </div>
    </div>
    <pre>{props.code}</pre>
  </div>
)
const labels = { wrapLabel: 'Wrap', unwrapLabel: 'Unwrap', codeLabel: 'Code' }
const lines = (count: number): string => `${Array.from({ length: count }, (_, index) => `line ${String(index + 1)}`).join('\n')}\n`

const Prose = (props: { readonly tree: ReactNode }): ReactNode => {
  const state = useRef(MarkdownProse.state(CodeBlock))
  return MarkdownProse.transform(props.tree, state.current, 'answer')
}

describe('MarkdownProse', () => {
  it('marks the native root so transcript styles reach it', () => {
    const { container } = render(
      <Prose
        tree={
          <div className="hashed">
            <p>Hello</p>
          </div>
        }
      />,
    )
    expect(container.querySelector('[data-dsh-markdown="answer"]')?.className).toBe('hashed')
  })

  it('defaults a code card to no-wrap and toggles it from a button in the card toolbar', () => {
    const { container, getByRole } = render(
      <Prose
        tree={
          <div>
            <CodeBlock key="a" code={lines(3)} toolbarLabels={labels} />
          </div>
        }
      />,
    )
    expect(container.querySelector('.md-code-block')?.getAttribute('data-code-wrap')).toBe('false')
    const toggle = getByRole('button', { name: 'Wrap' })
    expect(toggle.closest('[data-actions]')).not.toBeNull()
    fireEvent.click(toggle)
    expect(container.querySelector('.md-code-block')?.getAttribute('data-code-wrap')).toBe('true')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('folds a settled card after 24 lines and shows it all on request', () => {
    const { container, getByRole } = render(
      <Prose
        tree={
          <div>
            <CodeBlock key="a" code={lines(40)} toolbarLabels={labels} />
          </div>
        }
      />,
    )
    expect(container.querySelector('[data-code-fold]')?.getAttribute('data-code-fold')).toBe('closed')
    fireEvent.click(getByRole('button', { name: 'Show all · 40 lines' }))
    expect(container.querySelector('[data-code-fold]')?.getAttribute('data-code-fold')).toBe('open')
    expect(getByRole('button', { name: 'Show less' })).toBeTruthy()
  })

  it('never folds a short card or one still streaming', () => {
    const { container } = render(
      <Prose
        tree={
          <div>
            <CodeBlock key="a" code={lines(24)} toolbarLabels={labels} />
            <CodeBlock key="b" code={lines(60)} streaming toolbarLabels={labels} />
          </div>
        }
      />,
    )
    expect(container.querySelector('[data-code-fold]')).toBeNull()
  })

  it('counts the lines the card shows', () => {
    expect(codeLineCount('a\nb\n')).toBe(2)
    expect(codeLineCount('a')).toBe(1)
    expect(codeLineCount('')).toBe(0)
  })
  it('labels file mentions by name and line, adding the parent only when names collide', () => {
    const mention = (key: string, value: string): ReactNode => (
      <code key={key}>
        <button type="button" title={value} onClick={() => {}}>
          <svg />
          {value}
        </button>
      </code>
    )
    const { container } = render(
      <Prose
        tree={
          <div>
            <p key="p">
              {mention('a', 'notes/pricing.ts:2')} {mention('b', 'lib/pricing.ts')} {mention('c', 'src/README.md')}
            </p>
          </div>
        }
      />,
    )
    const labels = [...container.querySelectorAll('code[data-file-chip] > button')].map(button => button.textContent)
    expect(labels).toEqual(['notes/pricing.ts:2', 'lib/pricing.ts', 'README.md'])
    expect(container.querySelector('code[data-file-chip] > button')?.getAttribute('title')).toBe('notes/pricing.ts:2')
  })

  it("keeps punctuation after a chip on the chip's line", () => {
    const { container } = render(
      <Prose
        tree={
          <div>
            <p key="p">
              {'See '}
              <code key="c">
                <button type="button" onClick={() => {}}>
                  {'a/b.ts'}
                </button>
              </code>
              {', then go.'}
            </p>
          </div>
        }
      />,
    )
    expect(container.querySelector('[data-chip-keep]')?.textContent).toBe('b.ts,')
    expect(container.querySelector('p')?.textContent).toBe('See b.ts, then go.')
  })

  it('parses line suffixes and keeps a bare path whole', () => {
    expect(MarkdownProse.parseFileReference('a/b.ts:24')).toEqual({ path: 'a/b.ts', line: '24' })
    expect(MarkdownProse.parseFileReference('a/b.ts#L24-L30')).toEqual({ path: 'a/b.ts', line: '24' })
    expect(MarkdownProse.parseFileReference('a/b.ts')).toEqual({ path: 'a/b.ts', line: undefined })
    expect(MarkdownProse.fileChipLabel('plugins/chat/src/a.ts:9', new Set())).toBe('a.ts:9')
  })
  it('renders a GitHub alert as a titled callout and leaves a plain quote alone', () => {
    const { container } = render(
      <Prose
        tree={
          <div>
            <blockquote key="w">{['\n', <p key="p">{'[!WARNING]\nThe live DSH keeps old styles.'}</p>, '\n']}</blockquote>
            <blockquote key="q">{['\n', <p key="p">{'A plain quote.'}</p>, '\n']}</blockquote>
          </div>
        }
      />,
    )
    const callout = container.querySelector('blockquote[data-callout]')
    expect(callout?.getAttribute('data-callout')).toBe('warning')
    expect(callout?.querySelector('[data-callout-title]')?.textContent).toBe('Warning')
    expect(callout?.textContent).not.toContain('[!WARNING]')
    expect(callout?.textContent).toContain('The live DSH keeps old styles.')
    expect(container.querySelectorAll('blockquote[data-callout]')).toHaveLength(1)
  })

  it('wraps top-level blocks between raw details tags in a closed disclosure', () => {
    const { container } = render(
      <Prose
        tree={
          <div>
            {[
              <p key="a">Before</p>,
              '\n',
              '<details>\n<summary>Build log</summary>',
              '\n',
              <CodeBlock key="c" code={lines(3)} toolbarLabels={labels} />,
              '\n',
              '</details>',
              '\n',
              <p key="b">After</p>,
            ]}
          </div>
        }
      />,
    )
    const details = container.querySelector('details[data-md-details]')
    expect(details?.hasAttribute('open')).toBe(false)
    expect(details?.querySelector('summary')?.textContent).toBe('Build log')
    expect(details?.querySelector('.md-code-block')).not.toBeNull()
    expect(container.textContent).not.toContain('<details>')
    expect(container.textContent).toContain('After')
  })

  it('keeps an unclosed details tag as the text it was', () => {
    const { container } = render(<Prose tree={<div>{[<p key="a">x</p>, '\n', '<details>', '\n', <p key="b">y</p>]}</div>} />)
    expect(container.querySelector('details')).toBeNull()
    expect(container.textContent).toContain('<details>')
  })
})
