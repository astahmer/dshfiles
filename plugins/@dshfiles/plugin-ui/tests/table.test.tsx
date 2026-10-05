import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DataTable, createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable } from '../src/table.js'

afterEach(cleanup)

interface Alias {
  readonly name: string
  readonly scope: string
}

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { alphanumeric: sortFn_alphanumeric } })
const helper = createColumnHelper<typeof features, Alias>()
const columns = helper.columns([helper.accessor('name', { header: 'Name', sortFn: 'alphanumeric' }), helper.accessor('scope', { header: 'Scope', enableSorting: false })])

const AliasTable = (props: { readonly data: readonly Alias[] }): JSX.Element => {
  const table = useTable({ features, columns, data: [...props.data] })
  return <DataTable empty="No aliases" table={table} />
}

const bodyNames = (): readonly string[] =>
  within(screen.getAllByRole('rowgroup')[1] ?? document.body)
    .getAllByRole('row')
    .map(row => within(row).getAllByRole('cell')[0]?.textContent ?? '')

describe('DataTable', () => {
  it('sorts through an accessible header button', () => {
    render(
      <AliasTable
        data={[
          { name: 'b', scope: 'user' },
          { name: 'a', scope: 'project' },
        ]}
      />,
    )
    expect(bodyNames()).toEqual(['b', 'a'])
    const nameHeader = screen.getByRole('columnheader', { name: /Name/ })
    fireEvent.click(within(nameHeader).getByRole('button'))
    expect(nameHeader.getAttribute('aria-sort')).toBe('ascending')
    expect(bodyNames()).toEqual(['a', 'b'])
    expect(within(screen.getByRole('columnheader', { name: 'Scope' })).queryByRole('button')).toBeNull()
  })

  it('renders the empty row across every column', () => {
    render(<AliasTable data={[]} />)
    const cell = screen.getByRole('cell', { name: 'No aliases' })
    expect(cell.getAttribute('colspan')).toBe('2')
  })
})
