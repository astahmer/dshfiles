import { describe, expect, it } from 'vitest'
import { JiraAdf, type AdfNode } from './jira-adf.js'

const doc = (...content: AdfNode[]): AdfNode => ({ version: 1, type: 'doc', content })
const paragraph = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content })
const text = (value: string, ...marks: AdfNode['marks'] & object): AdfNode =>
  marks.length === 0 ? { type: 'text', text: value } : { type: 'text', text: value, marks }
const item = (...content: AdfNode[]): AdfNode => ({ type: 'listItem', content })

/** Markdown that survives a trip through ADF unchanged, with the document it stands for. */
const roundTrips: readonly { readonly name: string; readonly markdown: string; readonly adf: AdfNode }[] = [
  { name: 'paragraphs', markdown: 'One\n\nTwo', adf: doc(paragraph(text('One')), paragraph(text('Two'))) },
  { name: 'hard break', markdown: 'line one\nline two', adf: doc(paragraph(text('line one'), { type: 'hardBreak' }, text('line two'))) },
  {
    name: 'headings',
    markdown: '# Title\n\n### Smaller',
    adf: doc({ type: 'heading', attrs: { level: 1 }, content: [text('Title')] }, { type: 'heading', attrs: { level: 3 }, content: [text('Smaller')] }),
  },
  {
    name: 'bold, italic, strike, inline code',
    markdown: '**bold** _italic_ ~~gone~~ `code`',
    adf: doc(
      paragraph(
        text('bold', { type: 'strong' }),
        text(' '),
        text('italic', { type: 'em' }),
        text(' '),
        text('gone', { type: 'strike' }),
        text(' '),
        text('code', { type: 'code' }),
      ),
    ),
  },
  {
    name: 'nested marks share one delimiter',
    markdown: '**bold _both_**',
    adf: doc(paragraph(text('bold ', { type: 'strong' }), text('both', { type: 'strong' }, { type: 'em' }))),
  },
  {
    name: 'link with marked text',
    markdown: 'see [the **docs**](https://example.com/a_b?x=1)',
    adf: doc(
      paragraph(
        text('see '),
        text('the ', { type: 'link', attrs: { href: 'https://example.com/a_b?x=1' } }),
        text('docs', { type: 'link', attrs: { href: 'https://example.com/a_b?x=1' } }, { type: 'strong' }),
      ),
    ),
  },
  {
    name: 'bullet list',
    markdown: '- one\n- two',
    adf: doc({ type: 'bulletList', content: [item(paragraph(text('one'))), item(paragraph(text('two')))] }),
  },
  {
    name: 'ordered list from 3',
    markdown: '3. three\n4. four',
    adf: doc({ type: 'orderedList', attrs: { order: 3 }, content: [item(paragraph(text('three'))), item(paragraph(text('four')))] }),
  },
  {
    name: 'nested lists',
    markdown: '- parent\n  1. first\n  2. second\n     - deep\n- sibling',
    adf: doc({
      type: 'bulletList',
      content: [
        item(paragraph(text('parent')), {
          type: 'orderedList',
          content: [item(paragraph(text('first'))), item(paragraph(text('second')), { type: 'bulletList', content: [item(paragraph(text('deep')))] })],
        }),
        item(paragraph(text('sibling'))),
      ],
    }),
  },
  {
    name: 'list item with two paragraphs and a break',
    markdown: '- first\n  still first\n\n  second paragraph\n- next',
    adf: doc({
      type: 'bulletList',
      content: [item(paragraph(text('first'), { type: 'hardBreak' }, text('still first')), paragraph(text('second paragraph'))), item(paragraph(text('next')))],
    }),
  },
  {
    name: 'code block with language',
    markdown: '```ts\nconst a = `x` * 2\n```',
    adf: doc({ type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = `x` * 2')] }),
  },
  { name: 'code block holding a fence', markdown: '````\n```\n````', adf: doc({ type: 'codeBlock', content: [text('```')] }) },
  {
    name: 'blockquote with a list',
    markdown: '> quoted\n>\n> - item',
    adf: doc({ type: 'blockquote', content: [paragraph(text('quoted')), { type: 'bulletList', content: [item(paragraph(text('item')))] }] }),
  },
  { name: 'rule', markdown: 'above\n\n---\n\nbelow', adf: doc(paragraph(text('above')), { type: 'rule' }, paragraph(text('below'))) },
  {
    name: 'markup characters stay text',
    markdown: '\\# not a heading \\*not bold\\* a\\_b \\[x\\]\n1\\. not a list\n\\- not a bullet',
    adf: doc(
      paragraph(text('# not a heading *not bold* a_b [x]'), { type: 'hardBreak' }, text('1. not a list'), { type: 'hardBreak' }, text('- not a bullet')),
    ),
  },
]

describe('ADF ↔ markdown', () => {
  it.each(roundTrips)('round-trips $name', ({ markdown, adf }) => {
    expect(JiraAdf.fromMarkdown(markdown)).toEqual(adf)
    expect(JiraAdf.toMarkdown(adf)).toEqual({ markdown, unsupported: [] })
    expect(JiraAdf.normalise(markdown)).toBe(markdown)
  })

  it('reads an empty description as empty markdown', () => {
    expect(JiraAdf.toMarkdown(null).markdown).toBe('')
    expect(JiraAdf.fromMarkdown('')).toEqual(doc())
  })

  it('keeps unknown nodes and marks as text and reports them', () => {
    const rendered = JiraAdf.toMarkdown(
      doc(
        paragraph(text('Hi '), { type: 'mention', attrs: { id: 'u1', text: '@Ada' } }, text(' '), text('red', { type: 'textColor', attrs: { color: '#f00' } })),
        { type: 'panel', attrs: { panelType: 'info' }, content: [paragraph(text('Inside a panel'))] },
        {
          type: 'table',
          content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(text('cell'))] }] }],
        },
        { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'm1', type: 'file' } }] },
      ),
    )
    expect(rendered.markdown).toBe('Hi @Ada red\n\nInside a panel\n\ncell')
    expect(rendered.unsupported).toEqual(['mediaSingle', 'mention', 'panel', 'table', 'tableCell', 'tableRow', 'textColor'])
  })

  it('normalises markdown written another way to what Jira reads back', () => {
    expect(JiraAdf.normalise('* one\n* two\n\n*em* and plain')).toBe('- one\n- two\n\n_em_ and plain')
    expect(JiraAdf.normalise('Line  \nnext')).toBe('Line\nnext')
  })
})
