// @vitest-environment jsdom
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { cleanup, render } from '@testing-library/react'
import { useRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The native renderer needs its whole browser dependency graph, so this stand-in keeps the two properties the
 * transform relies on: it renders blocks as host elements with string text children (inline code as `code`, fences
 * as `pre`, links as `a`), and while streaming every block but the last keeps its element identity across chunks.
 */
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  const inline = (text: string, key: string): ReactNode[] =>
    text
      .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/u)
      .filter(part => part !== '')
      .map((part, index) => {
        if (part.startsWith('`')) return React.createElement('code', { key: `${key}:${index}` }, part.slice(1, -1))
        if (part.startsWith('**')) return React.createElement('strong', { key: `${key}:${index}` }, [part.slice(2, -2)])
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(part)
        if (link !== null) return React.createElement('a', { key: `${key}:${index}`, href: link[2] }, [link[1]])
        return part
      })
  const block = (source: string, index: number): ReactNode =>
    source.startsWith('```')
      ? React.createElement('pre', { key: index }, React.createElement('code', null, source.split('\n').slice(1, -1).join('\n')))
      : React.createElement('p', { key: index }, inline(source, String(index)))
  const MarkdownText = React.memo(function MarkdownText(props: { readonly text: string; readonly streaming?: boolean }) {
    const frozen = React.useRef(new Map<string, ReactNode>())
    const sources = props.text.split('\n\n')
    const children = sources.map((source, index) => {
      const key = `${String(index)}\u0000${source}`
      if (props.streaming !== true || index === sources.length - 1) return block(source, index)
      const cached = frozen.current.get(key) ?? block(source, index)
      frozen.current.set(key, cached)
      return cached
    })
    return React.createElement('div', { 'data-markdown': '' }, children)
  })
  return { MarkdownText }
})

import { InlineReferenceModel, type InlineReference, type InlineReferenceContext, type InlineReferencePiece } from '../src/inline-references.tsx'

afterEach(cleanup)

const prose: InlineReferenceContext = { sessionId: undefined, cwd: undefined, surface: 'prose', before: '' }

/** A provider over one regular expression, rendering a marked span that carries its id. */
const pattern = (
  id: string,
  expression: RegExp,
  options: { readonly priority?: number; readonly surfaces?: InlineReference['surfaces'] } = {},
): InlineReference =>
  InlineReferenceModel.define({
    id,
    // The same defaults define() applies to an omitted priority and surface list.
    priority: options.priority ?? 0,
    surfaces: options.surfaces ?? ['prose'],
    match: text =>
      [...text.matchAll(new RegExp(expression.source, 'gu'))].map(match => ({ start: match.index, end: match.index + match[0].length, value: match[0] })),
    render: input => (
      <span data-reference={id} data-value={input.value}>
        {input.text}
      </span>
    ),
  })

const shape = (pieces: readonly InlineReferencePiece[]): readonly string[] =>
  pieces.map(piece => (piece.kind === 'text' ? piece.text : `[${piece.id}:${piece.text}]`))

describe('inline reference segmentation', () => {
  it('splits text around every provider match and keeps plain text untouched', () => {
    const pieces = InlineReferenceModel.segment('see b:1 and b:22.', [pattern('backlog', /b:\d+/u)], prose)
    expect(shape(pieces)).toEqual(['see ', '[backlog:b:1]', ' and ', '[backlog:b:22]', '.'])
  })

  it('lets the higher priority win an overlap, whatever the registration order', () => {
    const wide = pattern('wide', /memory: n:\d+/u)
    const narrow = pattern('narrow', /n:\d+/u, { priority: 5 })
    expect(shape(InlineReferenceModel.segment('memory: n:3', [wide, narrow], prose))).toEqual(['memory: ', '[narrow:n:3]'])
    expect(shape(InlineReferenceModel.segment('memory: n:3', [narrow, wide], prose))).toEqual(['memory: ', '[narrow:n:3]'])
  })

  it('prefers the earlier, then the longer, then the first registered match at equal priority', () => {
    const short = pattern('short', /ab/u)
    const long = pattern('long', /abc/u)
    const late = pattern('late', /bcd/u)
    expect(shape(InlineReferenceModel.segment('abcd', [short, long, late], prose))).toEqual(['[long:abc]', 'd'])
    const first = pattern('first', /ab/u)
    const second = pattern('second', /ab/u)
    expect(shape(InlineReferenceModel.segment('ab', [first, second], prose))).toEqual(['[first:ab]'])
  })

  it('offers a provider only the surfaces it asked for, and ignores invalid ranges and failing matchers', () => {
    const codeOnly = pattern('code', /jj:\w+/u, { surfaces: ['code'] })
    expect(shape(InlineReferenceModel.segment('jj:main', [codeOnly], prose))).toEqual(['jj:main'])
    expect(shape(InlineReferenceModel.segment('jj:main', [codeOnly], { ...prose, surface: 'code' }))).toEqual(['[code:jj:main]'])
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = InlineReferenceModel.define({
      id: 'broken',
      match: () => {
        throw new Error('nope')
      },
      render: () => null,
    })
    const outOfRange = InlineReferenceModel.define({ id: 'range', match: () => [{ start: 3, end: 99, value: 1 }], render: () => null })
    expect(shape(InlineReferenceModel.segment('b:1 x', [broken, outOfRange, pattern('backlog', /b:\d+/u)], prose))).toEqual(['[backlog:b:1]', ' x'])
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})

const labels: MarkdownLabels = { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' }
const renderMarkdownText = MarkdownText.type

/** The same composition InlineReferenceMarkdown uses, over explicit providers instead of the registry. */
const Referenced = (props: {
  readonly text: string
  readonly streaming?: boolean
  readonly items: readonly InlineReference[]
  readonly onBlock?: (node: ReactNode) => void
}): ReactNode => {
  const state = useRef(InlineReferenceModel.state(props.items))
  const output = renderMarkdownText({ text: props.text, streaming: props.streaming ?? false, labels })
  return InlineReferenceModel.transform(output, state.current)
}

describe('inline references in rendered Markdown', () => {
  const backlog = pattern('backlog', /b:\d+/u)
  const jj = pattern('jj', /jj:[\w-]+/u, { surfaces: ['code'] })

  it('renders references as React children in prose and inline code, never in fenced code or links', () => {
    const text = ['Working on b:1 and `jj:main`.', '', '```', 'b:2 `jj:main`', '```', '', '[b:3](https://example.com) **b:4**'].join('\n')
    const { container } = render(<Referenced text={text} items={[backlog, jj]} />)
    const values = [...container.querySelectorAll('[data-reference]')].map(element => `${element.getAttribute('data-reference')}=${element.textContent}`)
    expect(values).toEqual(['backlog=b:1', 'jj=jj:main', 'backlog=b:4'])
    expect(container.querySelector('code [data-reference="jj"]')).not.toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('b:2 `jj:main`')
    expect(container.querySelector('a [data-reference]')).toBeNull()
  })

  it('offers inline code the text before it in the same block', () => {
    const seen: string[] = []
    const citation = InlineReferenceModel.define({
      id: 'memory',
      surfaces: ['code'],
      match: (text, context) => {
        seen.push(context.before)
        return /memory:\s*$/u.test(context.before) && /^n:\d+$/u.test(text) ? [{ start: 0, end: text.length, value: text }] : []
      },
      render: input => <span data-reference="memory">{input.text}</span>,
    })
    const { container } = render(<Referenced text={'Fixed it. memory: `n:3`\n\nOther `n:4`'} items={[citation]} />)
    expect([...container.querySelectorAll('[data-reference="memory"]')].map(element => element.textContent)).toEqual(['n:3'])
    expect(seen).toEqual(['Fixed it. memory: ', 'Other '])
  })

  it('follows a streaming message: a reference completes as its text grows and frozen blocks keep their nodes', () => {
    const items = [backlog]
    const { container, rerender } = render(<Referenced streaming text="First b:1 here.\n\nNext b:" items={items} />)
    const frozen = container.querySelector('[data-reference="backlog"]')
    expect(frozen?.textContent).toBe('b:1')
    rerender(<Referenced streaming text="First b:1 here.\n\nNext b:2" items={items} />)
    rerender(<Referenced streaming text="First b:1 here.\n\nNext b:23 and more\n\nTail" items={items} />)
    const references = [...container.querySelectorAll('[data-reference="backlog"]')]
    expect(references.map(element => element.textContent)).toEqual(['b:1', 'b:23'])
    // The first paragraph froze: the reference node is the one rendered before the stream grew.
    expect(references[0]).toBe(frozen)
    rerender(<Referenced text="First b:1 here.\n\nNext b:23 and more\n\nTail" items={items} />)
    expect([...container.querySelectorAll('[data-reference="backlog"]')].map(element => element.textContent)).toEqual(['b:1', 'b:23'])
  })

  it('renders exactly the native tree when no provider is registered', () => {
    const plain = render(<MarkdownText text="b:1 `jj:main`" labels={labels} />).container.innerHTML
    cleanup()
    const referenced = render(<Referenced text="b:1 `jj:main`" items={[]} />).container.innerHTML
    expect(referenced).toBe(plain)
  })

  it('falls back to the written text when a renderer throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = (): ReactNode => {
      throw new Error('render failed')
    }
    const failing = InlineReferenceModel.define({
      id: 'failing',
      match: text => (text.includes('b:9') ? [{ start: text.indexOf('b:9'), end: text.indexOf('b:9') + 3, value: 9 }] : []),
      render: () => <Broken />,
    })
    const { container } = render(<Referenced text="Look at b:9 now" items={[failing]} />)
    expect(container.textContent).toBe('Look at b:9 now')
    error.mockRestore()
  })
})
