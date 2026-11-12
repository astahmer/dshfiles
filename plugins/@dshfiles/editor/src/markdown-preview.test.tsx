import { FencedMarkdown } from '@dshfiles/chat/fenced-markdown'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from './markdown-preview.js'

// The Markdown primitives need the Host's browser module table; the wiring under test never renders it.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ MarkdownText: () => null, CodeBlock: () => null }))

/** The b:581 document: a `subgraph`, `<br/>` in its labels and a labeled two-way edge. */
const FLOWCHART = [
  'flowchart LR',
  '  subgraph Host A',
  '    OL[(op-log + item cache<br/>sqlite)] --> Engine',
  '    Engine --> P1[linear adapter]',
  '    Engine --> P2[github adapter]',
  '    Engine --> P3[notion / jira / files / sqlite]',
  '  end',
  '  OL <-- "ops since cursor<br/>multi-host channel" --> OLB[(Host B op-log)]',
].join('\n')

const document = ['## D. Multi-source architecture', '', '```mermaid', FLOWCHART, '```', '', 'Storage. Move from the JSON storage domain to sqlite.'].join('\n')

describe('the editor Markdown preview', () => {
  it('renders through Chat fence renderers, so a Mermaid block becomes a diagram', () => {
    const element = MarkdownPreview({ path: 'plans/multi-source.md', sessionId: 'session-a', text: document })
    expect(element.props.renderText).toBe(FencedMarkdown)
    expect(element.props.text).toBe(document)
  })
})
