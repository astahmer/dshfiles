// @vitest-environment jsdom

import { defineClientPlugin, LinkHandler, type LinkTarget } from '@dshfiles/dshx/client'
import { createTestClient } from '@dshfiles/dshx/testing'
import { fireEvent } from '@testing-library/dom'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Code } from '../src/components/code.js'
import { Markdown } from '../src/components/markdown.js'

afterEach(cleanup)

describe('Markdown', () => {
  it('opens a custom-scheme link through its LinkHandler, also on a modified click', async () => {
    const client = await createTestClient()
    const opened: LinkTarget[] = []
    try {
      const view = render(<Markdown text="See [main](jj:main) and [docs](https://example.com)" />)
      expect(view.queryByRole('link', { name: 'main' })).toBeNull()

      await act(async () => {
        await client.mount(
          defineClientPlugin({
            id: 'links',
            uses: ['ui'],
            setup: api => void api.add(LinkHandler, { id: 'jj', scheme: 'jj', open: link => opened.push(link) }),
          }),
          { packageId: '@test/links' },
        )
      })
      const link = view.getByRole('link', { name: 'main' })
      fireEvent.click(link)
      fireEvent.click(link, { metaKey: true })
      expect(opened.map(target => target.href)).toEqual(['jj:main', 'jj:main'])
      expect(view.getByRole('link', { name: 'docs' }).getAttribute('href')).toBe('https://example.com')
    } finally {
      await client.dispose()
    }
  })
})

describe('Code', () => {
  it('renders the code with English copy chrome by default', () => {
    const view = render(<Code code="const a = 1" lang="ts" />)
    expect(view.getByLabelText('Copy').textContent).toBe('const a = 1')
  })
})
