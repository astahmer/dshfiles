// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { BulkSelectList, type BulkSelectDensity } from './bulk-select-list.js'

afterEach(cleanup)

const renderList = (density?: BulkSelectDensity) =>
  render(
    <BulkSelectList
      heading="Workspaces"
      items={[{ id: 'a', title: 'thread-a', meta: '3h ago', tag: 'WS' }]}
      onSelectionChange={() => undefined}
      selectedIds={[]}
      showHeader={false}
      {...(density === undefined ? {} : { density })}
    />,
  )

test('compact rows put the title and meta on one short line', () => {
  renderList('compact')
  const row = screen.getByRole('option')
  expect(row.dataset.density).toBe('compact')
  expect(row.className).toContain('dshx:py-1')
  expect(screen.getByText('thread-a').parentElement?.className).not.toContain('dshx:flex-col')
  expect(screen.getByText('WS').className).not.toContain('dshx:size-10')
})

test('rows stay comfortable by default', () => {
  renderList()
  const row = screen.getByRole('option')
  expect(row.dataset.density).toBe('comfortable')
  expect(screen.getByText('thread-a').parentElement?.className).toContain('dshx:flex-col')
  expect(screen.getByText('WS').className).toContain('dshx:size-10')
})
