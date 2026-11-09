// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { BulkSelectList } from './bulk-select-list.js'

afterEach(cleanup)

const items = [
  { id: 'a', title: 'thread-a1b2c3', meta: '1m ago', tag: 'WS' },
  { id: 'b', title: 'thread-ffeedd', tag: 'DIR' },
] as const

test('compact rows size to their text: no 40px tag tile, one line without meta, two with it', () => {
  render(<BulkSelectList density="compact" heading="Empty" items={items} onSelectionChange={() => {}} selectedIds={[]} showHeader={false} />)
  const [twoLine, oneLine] = screen.getAllByRole('option')
  for (const row of [twoLine, oneLine]) {
    expect(row?.dataset.density).toBe('compact')
    expect(row?.className).toContain('dshx:py-1.5')
    expect(row?.querySelector('.dshx\\:size-10')).toBeNull()
  }
  expect(twoLine?.textContent).toContain('1m ago')
  // The title-only row renders just its title line: no empty meta line is reserved.
  expect(oneLine?.querySelectorAll('.dshx\\:truncate')).toHaveLength(1)
})

test('comfortable stays the default and keeps the tag tile', () => {
  render(<BulkSelectList heading="Files" items={items} onSelectionChange={() => {}} selectedIds={[]} />)
  const [row] = screen.getAllByRole('option')
  expect(row?.dataset.density).toBe('comfortable')
  expect(row?.querySelector('.dshx\\:size-10')?.textContent).toBe('WS')
})
