import { describe, expect, it } from 'vitest'

import { backlogItemMarkdown } from './item-markdown.js'

const item = {
  id: 316,
  title: 'Need a way to copy an item as markdown',
  kind: 'task',
  status: 'doing',
  project: '/projects/dshfiles',
  tags: ['backlog', 'ux'],
  links: [{ type: 'revision', target: 'abc123' }],
  pinned: false,
  attention: 'none',
  preview: 'Short summary',
} as const

describe('backlogItemMarkdown', () => {
  it('renders item metadata, body, tags, and links as Markdown', () => {
    expect(backlogItemMarkdown({ ...item, body: 'Full **description**.' })).toBe(
      [
        '# Need a way to copy an item as markdown',
        '',
        '- **ID:** `b:316`',
        '- **Kind:** task',
        '- **Status:** doing',
        '- **Project:** `/projects/dshfiles`',
        '- **Tags:** #backlog #ux',
        '',
        'Full **description**.',
        '',
        '## Links',
        '- revision: abc123',
      ].join('\n'),
    )
  })

  it('uses the available preview when the full body is not available', () => {
    expect(backlogItemMarkdown(item)).toContain('\n\nShort summary')
  })

  it('omits empty optional sections', () => {
    expect(backlogItemMarkdown({ ...item, project: null, tags: [], links: [], preview: '', body: '' })).toBe(
      ['# Need a way to copy an item as markdown', '', '- **ID:** `b:316`', '- **Kind:** task', '- **Status:** doing'].join('\n'),
    )
  })
})
