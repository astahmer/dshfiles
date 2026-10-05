import type { Column, ReactTable, RowData, SortDirection, TableFeatures } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { joinClassNames } from './field.js'
import styles from './table.module.css'

export * from '@tanstack/react-table'

interface SortableColumn {
  readonly getCanSort: () => boolean
  readonly getIsSorted: () => false | SortDirection
  readonly getToggleSortingHandler: () => ((event: unknown) => void) | undefined
}

const isSortable = (column: object): column is SortableColumn => 'getCanSort' in column && 'getToggleSortingHandler' in column

const ariaSort = (direction: false | SortDirection): 'ascending' | 'descending' | undefined =>
  direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined

const SORT_GLYPH: Record<SortDirection, string> = { asc: '▲', desc: '▼' }

export interface DataTableProps<TFeatures extends TableFeatures, TData extends RowData> {
  readonly table: ReactTable<TFeatures, TData, unknown>
  readonly caption?: ReactNode
  /** Rendered in one full-width row when the row model is empty. */
  readonly empty?: ReactNode
  readonly className?: string
  readonly rowClassName?: (row: TData) => string | undefined
  readonly cellClassName?: (columnId: string) => string | undefined
}

/**
 * Semantic `<table>` for any TanStack Table v9 instance. Headers become sort
 * buttons with `aria-sort` when the table registers `rowSortingFeature`.
 */
export const DataTable = <TFeatures extends TableFeatures, TData extends RowData>(props: DataTableProps<TFeatures, TData>): JSX.Element => {
  const { table } = props
  const rows = table.getRowModel().rows
  const columnCount = table.getAllLeafColumns().length
  return (
    <div className={joinClassNames(styles.wrap, props.className)}>
      <table className={styles.table}>
        {props.caption !== undefined && <caption className={styles.caption}>{props.caption}</caption>}
        <thead>
          {table.getHeaderGroups().map(group => (
            <tr key={group.id}>
              {group.headers.map(header => {
                const column: Column<TFeatures, TData, unknown> = header.column
                const sortable = isSortable(column) && column.getCanSort()
                const direction = isSortable(column) ? column.getIsSorted() : false
                const content = header.isPlaceholder ? null : <table.FlexRender header={header} />
                return (
                  <th aria-sort={ariaSort(direction)} className={joinClassNames(styles.headerCell, props.cellClassName?.(column.id))} colSpan={header.colSpan} key={header.id} scope="col">
                    {sortable && isSortable(column) ? (
                      <button className={styles.sortButton} onClick={column.getToggleSortingHandler()} type="button">
                        {content}
                        <span aria-hidden className={styles.sortIndicator}>
                          {direction === false ? '↕' : SORT_GLYPH[direction]}
                        </span>
                      </button>
                    ) : (
                      content
                    )}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map(row => (
            <tr className={joinClassNames(styles.row, props.rowClassName?.(row.original))} key={row.id}>
              {row.getAllCells().map(cell => (
                <td className={joinClassNames(styles.cell, props.cellClassName?.(cell.column.id))} key={cell.id}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && props.empty !== undefined && (
            <tr>
              <td className={styles.emptyCell} colSpan={columnCount}>
                {props.empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
