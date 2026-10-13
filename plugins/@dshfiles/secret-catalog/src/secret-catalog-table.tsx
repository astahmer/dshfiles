import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CopyIcon, EyeIcon, EyeOffIcon, PencilIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { DataTable, createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable } from '@dshfiles/plugin-ui/table'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { SecretCatalogTranslate } from './locales.js'
import type { SecretMetadata } from './secret-metadata.js'
import { previewSecretValue, type SecretRevealStage } from './secret-reveal-model.js'

export interface RevealedSecret {
  readonly id: string
  readonly value: string
  readonly stage: SecretRevealStage
}

export interface SecretRowActions {
  readonly t: SecretCatalogTranslate
  readonly revealed: RevealedSecret | null
  readonly canActOnRow: (row: SecretMetadata) => boolean
  readonly isRowBusy: (row: SecretMetadata) => boolean
  readonly onReveal: (row: SecretMetadata) => void
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

const VariableCell = (props: { readonly row: SecretMetadata }): JSX.Element => (
  <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
    <span className="dshx:truncate dshx:font-mono dshx:text-[13px] dshx:font-semibold">{props.row.variableName}</span>
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

const ValueCell = (props: { readonly row: SecretMetadata }): JSX.Element => {
  const actions = useSecretRowActions()
  const revealed = actions.revealed
  if (revealed?.id === props.row.id) {
    const preview = revealed.stage === 'preview' ? previewSecretValue(revealed.value) : null
    const value =
      preview === null ? revealed.value : preview.kind === 'excerpt' ? preview.text : actions.t('previewMasked', { mask: preview.mask, count: preview.length })
    return <output className="dshx:font-mono dshx:text-xs dshx:break-all dshx:select-all">{value}</output>
  }
  return (
    <span aria-label={actions.t('hiddenValue')} className="dshx:font-mono dshx:text-xs dshx:tracking-[0.2em] dshx:text-muted-foreground">
      ••••••••••••
    </span>
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

const RevealCopyCell = (props: { readonly row: SecretMetadata }): JSX.Element => {
  const actions = useSecretRowActions()
  const row = props.row
  const t = actions.t
  const allowed = actions.canActOnRow(row)
  const busy = actions.isRowBusy(row)
  const hint = allowed ? undefined : t('actionBlockedHint')
  const isRevealed = actions.revealed?.id === row.id
  const revealAction = !isRevealed ? t('preview') : actions.revealed?.stage === 'preview' ? t('revealFull') : t('hide')
  return (
    <div className="dshx:flex dshx:items-center dshx:gap-1">
      <RowActionButton
        disabled={!allowed || busy}
        hint={hint}
        label={t('revealActionLabel', { action: revealAction, alias: row.alias })}
        onClick={() => actions.onReveal(row)}
      >
        {busy ? <Spinner /> : isRevealed && actions.revealed?.stage === 'full' ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
      </RowActionButton>
      <RowActionButton disabled={!allowed || busy} hint={hint} label={t('copyAlias', { alias: row.alias })} onClick={() => actions.onCopy(row)}>
        <CopyIcon aria-hidden />
      </RowActionButton>
    </div>
  )
}

const ActionsCell = (props: { readonly row: SecretMetadata }): JSX.Element => {
  const actions = useSecretRowActions()
  const row = props.row
  const t = actions.t
  const disabled = !actions.canActOnRow(row) || actions.isRowBusy(row)
  return (
    <div className="dshx:flex dshx:items-center dshx:justify-end dshx:gap-1">
      <RowActionButton disabled={disabled} hint={undefined} label={t('editAlias', { alias: row.alias })} onClick={() => actions.onEdit(row)}>
        <PencilIcon aria-hidden />
      </RowActionButton>
      <RowActionButton destructive disabled={disabled} hint={undefined} label={t('removeAlias', { alias: row.alias })} onClick={() => actions.onRemove(row)}>
        <Trash2Icon aria-hidden />
      </RowActionButton>
    </div>
  )
}

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { alphanumeric: sortFn_alphanumeric } })
const column = createColumnHelper<typeof features, SecretMetadata>()

const columnClassNames: Readonly<Record<string, string | undefined>> = {
  variable: 'dshx:w-[34%] dshx:max-w-0',
  description: 'dshx:w-[30%] dshx:max-w-0',
  value: 'dshx:w-[16%]',
  reveal: 'dshx:w-px',
  actions: 'dshx:w-px dshx:text-right',
}

interface SecretCatalogTableProps {
  readonly rows: readonly SecretMetadata[]
  readonly loading: boolean
  readonly hasAnyRows: boolean
  readonly actions: SecretRowActions
}

export const SecretCatalogTable = (props: SecretCatalogTableProps): JSX.Element => {
  const t = props.actions.t
  const data = useMemo(() => [...props.rows], [props.rows])
  const columns = useMemo(
    () =>
      column.columns([
        column.accessor('variableName', {
          id: 'variable',
          header: t('columnVariable'),
          sortFn: 'alphanumeric',
          cell: context => <VariableCell row={context.row.original} />,
        }),
        column.display({ id: 'description', header: t('columnDescription'), cell: context => <DescriptionCell row={context.row.original} /> }),
        column.display({ id: 'value', header: t('columnValue'), cell: context => <ValueCell row={context.row.original} /> }),
        column.display({ id: 'reveal', header: '', cell: context => <RevealCopyCell row={context.row.original} /> }),
        column.display({ id: 'actions', header: t('columnActions'), cell: context => <ActionsCell row={context.row.original} /> }),
      ]),
    [t],
  )
  const table = useTable({ features, columns, data })
  const empty = props.loading ? (
    <span className="dshx:inline-flex dshx:items-center dshx:gap-2">
      <Spinner />
      {t('loadingMetadata')}
    </span>
  ) : props.hasAnyRows ? (
    t('noMatchingAliases')
  ) : (
    t('noAliases')
  )
  return (
    <SecretRowActionsContext.Provider value={props.actions}>
      <DataTable
        cellClassName={columnId => columnClassNames[columnId]}
        className="dshx:overflow-visible dshx:[&_[data-slot=table-container]]:overflow-visible dshx:[&_thead]:sticky dshx:[&_thead]:top-0 dshx:[&_thead]:z-10 dshx:[&_thead]:bg-muted dshx:[&_thead_th:first-child]:rounded-tl-lg dshx:[&_thead_th:last-child]:rounded-tr-lg"
        empty={empty}
        table={table}
      />
    </SecretRowActionsContext.Provider>
  )
}
