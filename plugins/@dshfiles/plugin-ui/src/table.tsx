import type { Column, ReactTable, RowData, SortDirection, TableFeatures } from '@tanstack/react-table'
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table.js'
import { cn } from './lib/utils.js'

export * from '@tanstack/react-table'

interface SortableColumn {
  readonly getCanSort: () => boolean
  readonly getIsSorted: () => false | SortDirection
  readonly getToggleSortingHandler: () => ((event: unknown) => void) | undefined
}

const isSortable = (column: object): column is SortableColumn => 'getCanSort' in column && 'getToggleSortingHandler' in column

const ariaSort = (direction: false | SortDirection): 'ascending' | 'descending' | undefined =>
  direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined

export interface DataTableProps<TFeatures extends TableFeatures, TData extends RowData> {
  readonly table: ReactTable<TFeatures, TData, unknown>
  readonly caption?: ReactNode
  /** Rendered in one full-width row when the row model is empty and nothing is appended. */
  readonly empty?: ReactNode
  /** `TableRow`s rendered after the row model, such as editable draft rows; they keep the table's column widths. */
  readonly append?: ReactNode
  readonly className?: string
  readonly rowClassName?: (row: TData) => string | undefined
  readonly cellClassName?: (columnId: string) => string | undefined
}

/**
 * shadcn `Table` in a bordered card (BB Secret Catalog) for any TanStack Table v9 instance.
 * Headers become sort buttons with `aria-sort` when the table registers `rowSortingFeature`.
 */
export const DataTable = <TFeatures extends TableFeatures, TData extends RowData>(props: DataTableProps<TFeatures, TData>): JSX.Element => {
  const { table } = props
  const rows = table.getRowModel().rows
  const columnCount = table.getAllLeafColumns().length
  return (
    <div className={cn('dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:bg-card', props.className)}>
      <Table>
        {props.caption !== undefined && <TableCaption>{props.caption}</TableCaption>}
        <TableHeader className="dshx:bg-muted/60">
          {table.getHeaderGroups().map(group => (
            <TableRow className="dshx:hover:bg-transparent" key={group.id}>
              {group.headers.map(header => {
                const column: Column<TFeatures, TData, unknown> = header.column
                const sortable = isSortable(column) && column.getCanSort()
                const direction = isSortable(column) ? column.getIsSorted() : false
                const content = header.isPlaceholder ? null : <table.FlexRender header={header} />
                const SortIcon = direction === 'asc' ? ArrowUpIcon : direction === 'desc' ? ArrowDownIcon : ArrowUpDownIcon
                return (
                  <TableHead
                    aria-sort={ariaSort(direction)}
                    className={cn(
                      'dshx:h-9 dshx:px-4 dshx:text-[11px] dshx:font-semibold dshx:tracking-wider dshx:text-muted-foreground dshx:uppercase',
                      props.cellClassName?.(column.id),
                    )}
                    colSpan={header.colSpan}
                    key={header.id}
                    scope="col"
                  >
                    {sortable && isSortable(column) ? (
                      <button
                        className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:uppercase dshx:hover:text-foreground"
                        onClick={column.getToggleSortingHandler()}
                        type="button"
                      >
                        {content}
                        <SortIcon aria-hidden className="dshx:size-3" />
                      </button>
                    ) : (
                      content
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map(row => (
            <TableRow className={props.rowClassName?.(row.original)} key={row.id}>
              {row.getAllCells().map(cell => (
                <TableCell className={cn('dshx:px-4 dshx:py-3', props.cellClassName?.(cell.column.id))} key={cell.id}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
          {props.append}
          {rows.length === 0 && props.empty !== undefined && props.append === undefined && (
            <TableRow className="dshx:hover:bg-transparent">
              <TableCell className="dshx:py-8 dshx:text-center dshx:text-muted-foreground" colSpan={columnCount}>
                {props.empty}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
