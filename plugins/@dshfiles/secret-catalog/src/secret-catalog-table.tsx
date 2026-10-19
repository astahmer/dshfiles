import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { Skeleton } from '@dshfiles/plugin-ui/components/ui/skeleton'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CopyIcon, EyeIcon, KeyRoundIcon, PencilIcon, SearchXIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { DataTable, createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable } from '@dshfiles/plugin-ui/table'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { SecretCatalogTranslate } from './locales.js'
import type { SecretMetadata } from './secret-metadata.js'

export interface RevealedSecret {
  readonly id: string
  readonly value: string
}

export interface SecretRowActions {
  readonly t: SecretCatalogTranslate
  readonly revealed: RevealedSecret | null
  readonly canActOnRow: (row: SecretMetadata) => boolean
  readonly isRowBusy: (row: SecretMetadata) => boolean
  readonly copyPending: boolean
  readonly isRevealing: (row: SecretMetadata) => boolean
  readonly onReveal: (row: SecretMetadata) => void
  /** The revealed value lost focus; hide it when the user set hide-on-blur. */
  readonly onRevealedBlur: () => void
  readonly onHide: () => void
  readonly onCopy: (row: SecretMetadata) => void
  readonly onEdit: (row: SecretMetadata) => void
  readonly onRemove: (row: SecretMetadata) => void
}

const SecretRowActionsContext = createContext<SecretRowActions | null>(null)

const useSecretRowActions = (): SecretRowActions => {
  const actions = useContext(SecretRowActionsContext)
  if (actions === null) throw new Error('Secret row cells render inside SecretCatalogTable.')
  return actions
}

const NameCell = (props: { readonly row: SecretMetadata }): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
    <span className="dshx:truncate dshx:font-mono dshx:text-[13px] dshx:font-semibold" title={props.row.variableName}>
      {props.row.variableName}
    </span>
    <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
      {props.row.alias} · {props.row.scope} · {props.row.environment}
      {props.row.field.length > 0 ? ` · ${props.row.field}` : ''}
    </span>
  </div>
)

const DescriptionCell = (props: { readonly row: SecretMetadata }): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
    <span className="dshx:truncate">{props.row.description || props.row.service || props.row.item || props.row.alias}</span>
    <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
      {props.row.service}
      {props.row.item && props.row.service !== props.row.item ? ` · ${props.row.item}` : ''}
    </span>
  </div>
)

const MASK = '••••••••••••'

const RevealedValue = (props: { readonly row: SecretMetadata; readonly value: string }): JSX.Element => {
  const actions = useSecretRowActions()
  const outputRef = useRef<HTMLOutputElement>(null)
  useEffect(() => outputRef.current?.focus(), [])
  return (
    <output
      aria-label={actions.t('revealedValue', { alias: props.row.alias })}
      className="dshx:block dshx:rounded-sm dshx:bg-muted dshx:px-2 dshx:py-1 dshx:font-mono dshx:text-xs dshx:break-all dshx:select-all dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
      onBlur={actions.onRevealedBlur}
      onKeyDown={event => {
        if (event.key === 'Escape') actions.onHide()
      }}
      ref={outputRef}
      tabIndex={0}
      title={actions.t('hideRevealedHint')}
    >
      {props.value}
    </output>
  )
}

const ValueCell = (props: { readonly row: SecretMetadata }): JSX.Element => {
  const actions = useSecretRowActions()
  const t = actions.t
  const row = props.row
  if (actions.revealed?.id === row.id) return <RevealedValue row={row} value={actions.revealed.value} />
  if (actions.isRevealing(row)) {
    return (
      <span className="dshx:inline-flex dshx:items-center dshx:gap-2 dshx:px-2 dshx:py-1 dshx:text-xs dshx:text-muted-foreground" role="status">
        <Spinner />
        {t('revealing')}
      </span>
    )
  }
  if (!actions.canActOnRow(row)) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={t('hiddenValue')}
            className="dshx:inline-block dshx:px-2 dshx:py-1 dshx:font-mono dshx:text-xs dshx:tracking-[0.2em] dshx:text-muted-foreground/60"
            tabIndex={0}
          >
            {MASK}
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('actionBlockedHint')}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <button
      aria-label={t('revealAlias', { alias: row.alias })}
      className="dshx:group dshx:relative dshx:inline-flex dshx:min-w-32 dshx:items-center dshx:rounded-sm dshx:px-2 dshx:py-1 dshx:text-left dshx:outline-none dshx:hover:bg-muted dshx:focus-visible:bg-muted dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
      onClick={() => actions.onReveal(row)}
      type="button"
    >
      <span
        aria-hidden
        className="dshx:font-mono dshx:text-xs dshx:tracking-[0.2em] dshx:text-muted-foreground dshx:transition-opacity dshx:group-hover:opacity-0 dshx:group-focus-visible:opacity-0"
      >
        {MASK}
      </span>
      <span
        aria-hidden
        className="dshx:absolute dshx:inset-0 dshx:flex dshx:items-center dshx:gap-1.5 dshx:px-2 dshx:text-xs dshx:font-medium dshx:opacity-0 dshx:transition-opacity dshx:group-hover:opacity-100 dshx:group-focus-visible:opacity-100"
      >
        <EyeIcon className="dshx:size-3.5" />
        {t('clickToReveal')}
      </span>
    </button>
  )
}

const RowActionButton = (props: {
  readonly label: string
  readonly hint: string | undefined
  readonly disabled: boolean
  readonly onClick: () => void
  readonly destructive?: boolean
  readonly children: ReactNode
}): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="dshx:inline-flex">
        <Button
          aria-label={props.label}
          className={props.destructive === true ? 'dshx:text-muted-foreground dshx:hover:text-destructive' : 'dshx:text-muted-foreground'}
          disabled={props.disabled}
          onClick={props.onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {props.children}
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent>{props.hint ?? props.label}</TooltipContent>
  </Tooltip>
)

const ActionsCell = (props: { readonly row: SecretMetadata }): JSX.Element => {
  const actions = useSecretRowActions()
  const row = props.row
  const t = actions.t
  const allowed = actions.canActOnRow(row)
  const disabled = !allowed || actions.isRowBusy(row)
  const hint = allowed ? undefined : t('actionBlockedHint')
  return (
    <div className="dshx:flex dshx:items-center dshx:justify-end dshx:gap-0.5">
      <RowActionButton
        disabled={disabled || actions.copyPending}
        hint={hint ?? t('copyHint')}
        label={t('copyAlias', { alias: row.alias })}
        onClick={() => actions.onCopy(row)}
      >
        <CopyIcon aria-hidden />
      </RowActionButton>
      <RowActionButton disabled={disabled} hint={hint} label={t('editAlias', { alias: row.alias })} onClick={() => actions.onEdit(row)}>
        <PencilIcon aria-hidden />
      </RowActionButton>
      <RowActionButton destructive disabled={disabled} hint={hint} label={t('removeAlias', { alias: row.alias })} onClick={() => actions.onRemove(row)}>
        <Trash2Icon aria-hidden />
      </RowActionButton>
    </div>
  )
}

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { alphanumeric: sortFn_alphanumeric } })
const column = createColumnHelper<typeof features, SecretMetadata>()

const columnClassNames = {
  name: 'dshx:w-[38%] dshx:max-w-0',
  description: 'dshx:w-[28%] dshx:max-w-0 dshx:@max-pane-compact:hidden',
  value: 'dshx:max-w-0',
  actions: 'dshx:w-px dshx:text-right dshx:whitespace-nowrap',
} as const

/** Width and visibility of a catalog column, so appended draft rows line up with saved ones. */
export const secretColumnClassName = (columnId: keyof typeof columnClassNames): string => columnClassNames[columnId]

const isColumnId = (columnId: string): columnId is keyof typeof columnClassNames => columnId in columnClassNames

interface SecretCatalogTableProps {
  readonly rows: readonly SecretMetadata[]
  readonly loading: boolean
  readonly hasAnyRows: boolean
  readonly actions: SecretRowActions
  /** Draft rows under the saved ones. */
  readonly append?: ReactNode
}

const LoadingRows = (props: { readonly label: string }): JSX.Element => (
  <div aria-busy className="dshx:flex dshx:flex-col dshx:gap-3 dshx:py-1 dshx:text-left" role="status">
    <span className="dshx:sr-only">{props.label}</span>
    {['dshx:w-3/5', 'dshx:w-2/5', 'dshx:w-1/2'].map(width => (
      <div className="dshx:flex dshx:items-center dshx:gap-4" key={width}>
        <Skeleton className={cn('dshx:h-4', width)} />
        <Skeleton className="dshx:ml-auto dshx:h-4 dshx:w-24" />
      </div>
    ))}
  </div>
)

export const SecretCatalogTable = (props: SecretCatalogTableProps): JSX.Element => {
  const t = props.actions.t
  const data = useMemo(() => [...props.rows], [props.rows])
  const columns = useMemo(
    () =>
      column.columns([
        column.accessor('variableName', {
          id: 'name',
          header: t('columnName'),
          sortFn: 'alphanumeric',
          cell: context => <NameCell row={context.row.original} />,
        }),
        column.display({ id: 'description', header: t('columnDescription'), cell: context => <DescriptionCell row={context.row.original} /> }),
        column.display({ id: 'value', header: t('columnValue'), cell: context => <ValueCell row={context.row.original} /> }),
        column.display({
          id: 'actions',
          header: () => <span className="dshx:sr-only">{t('columnActions')}</span>,
          cell: context => <ActionsCell row={context.row.original} />,
        }),
      ]),
    [t],
  )
  const table = useTable({ features, columns, data })
  const empty =
    props.loading && !props.hasAnyRows ? (
      <LoadingRows label={t('loadingMetadata')} />
    ) : (
      <Empty className="dshx:gap-3 dshx:p-4 dshx:md:p-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">{props.hasAnyRows ? <SearchXIcon /> : <KeyRoundIcon />}</EmptyMedia>
          <EmptyTitle className="dshx:text-base">{props.hasAnyRows ? t('noMatchingAliases') : t('noAliases')}</EmptyTitle>
          <EmptyDescription>{props.hasAnyRows ? t('noMatchingAliasesHint') : t('noAliasesHint')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <SecretRowActionsContext.Provider value={props.actions}>
      <DataTable
        append={props.append}
        cellClassName={columnId => (isColumnId(columnId) ? columnClassNames[columnId] : undefined)}
        className="dshx:overflow-visible dshx:[&_[data-slot=table-container]]:overflow-visible dshx:[&_thead]:sticky dshx:[&_thead]:top-0 dshx:[&_thead]:z-10 dshx:[&_thead]:bg-muted dshx:[&_thead_th:first-child]:rounded-tl-lg dshx:[&_thead_th:last-child]:rounded-tr-lg"
        empty={empty}
        table={table}
      />
    </SecretRowActionsContext.Provider>
  )
}
