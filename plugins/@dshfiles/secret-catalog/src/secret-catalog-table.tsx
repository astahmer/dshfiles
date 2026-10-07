import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { EmptyState } from '@dshfiles/plugin-ui'
import { DataTable, createColumnHelper, createSortedRowModel, rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable } from '@dshfiles/plugin-ui/table'
import { createContext, useContext, useMemo } from 'react'
import type { SecretMetadata } from './secret-metadata.js'
import { previewSecretValue, type SecretRevealStage } from './secret-reveal-model.js'
import styles from './secret-catalog.module.css'

export interface RevealedSecret {
  readonly id: string
  readonly value: string
  readonly stage: SecretRevealStage
}

export interface SecretRowActions {
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

const BLOCKED_ACTION_TITLE = 'Choose a project folder and resolve duplicate alias/environment rows first.'

const VariableCell = (props: { readonly row: SecretMetadata }): JSX.Element => (
  <>
    <span className={`${styles.primaryText} ${styles.variable}`}>{props.row.variableName}</span>
    <span className={styles.secondaryText}>
      {props.row.alias} · {props.row.scope} · {props.row.environment}
      {props.row.field.length > 0 ? ` · ${props.row.field}` : ''}
    </span>
  </>
)

const DescriptionCell = (props: { readonly row: SecretMetadata }): JSX.Element => (
  <>
    <span className={styles.primaryText}>{props.row.description || props.row.service || props.row.item || props.row.alias}</span>
    <span className={styles.secondaryText}>
      {props.row.service}
      {props.row.item && props.row.service !== props.row.item ? ` · ${props.row.item}` : ''}
    </span>
  </>
)

const ValueCell = (props: { readonly row: SecretMetadata }): JSX.Element => {
  const { revealed } = useSecretRowActions()
  if (revealed?.id === props.row.id) {
    const preview = revealed.stage === 'preview' ? previewSecretValue(revealed.value) : null
    const value = preview === null ? revealed.value : preview.kind === 'excerpt' ? preview.text : preview.mask
    return <output className={styles.revealed}>{value}</output>
  }
  return (
    <span aria-label="Hidden secret value" className={styles.mask}>
      ••••••••••••
    </span>
  )
}

const revealLabel = (revealed: RevealedSecret | null, row: SecretMetadata): string => {
  if (revealed?.id !== row.id) return 'Preview'
  return revealed.stage === 'preview' ? 'Reveal full' : 'Hide'
}

const ActionsCell = (props: { readonly row: SecretMetadata }): JSX.Element => {
  const actions = useSecretRowActions()
  const row = props.row
  const allowed = actions.canActOnRow(row)
  const disabled = !allowed || actions.isRowBusy(row)
  const title = allowed ? undefined : BLOCKED_ACTION_TITLE
  const label = revealLabel(actions.revealed, row)
  return (
    <div className={styles.actions}>
      <Button
        aria-label={`${label} ${row.alias}`}
        disabled={disabled}
        onClick={() => actions.onReveal(row)}
        size="sm"
        title={title}
        type="button"
        variant="outline"
      >
        {label}
      </Button>
      <Button aria-label={`Copy ${row.alias}`} disabled={disabled} onClick={() => actions.onCopy(row)} size="sm" title={title} type="button" variant="outline">
        Copy
      </Button>
      <Button aria-label={'Edit ' + row.alias} disabled={disabled} onClick={() => actions.onEdit(row)} size="sm" type="button" variant="outline">
        Edit
      </Button>
      <Button aria-label={'Remove ' + row.alias} disabled={disabled} onClick={() => actions.onRemove(row)} size="sm" type="button" variant="outline">
        Remove
      </Button>
    </div>
  )
}

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: { alphanumeric: sortFn_alphanumeric } })
const column = createColumnHelper<typeof features, SecretMetadata>()
const columns = column.columns([
  column.accessor('variableName', { id: 'variable', header: 'Variable', sortFn: 'alphanumeric', cell: context => <VariableCell row={context.row.original} /> }),
  column.display({ id: 'description', header: 'Description / service', cell: context => <DescriptionCell row={context.row.original} /> }),
  column.display({ id: 'value', header: 'Value', cell: context => <ValueCell row={context.row.original} /> }),
  column.display({ id: 'actions', header: 'Actions', cell: context => <ActionsCell row={context.row.original} /> }),
])

const columnClassNames: Readonly<Record<string, string | undefined>> = {
  variable: styles.wideColumn,
  description: styles.wideColumn,
  value: styles.valueColumn,
}

interface SecretCatalogTableProps {
  readonly rows: readonly SecretMetadata[]
  readonly loading: boolean
  readonly hasAnyRows: boolean
  readonly actions: SecretRowActions
}

const emptyMessage = (props: SecretCatalogTableProps): string => {
  if (props.loading) return 'Loading alias metadata…'
  return props.hasAnyRows ? 'No aliases match these filters.' : 'No aliases found.'
}

export const SecretCatalogTable = (props: SecretCatalogTableProps): JSX.Element => {
  const data = useMemo(() => [...props.rows], [props.rows])
  const table = useTable({ features, columns, data })
  return (
    <SecretRowActionsContext.Provider value={props.actions}>
      <DataTable cellClassName={columnId => columnClassNames[columnId]} empty={<EmptyState description={emptyMessage(props)} />} table={table} />
    </SecretRowActionsContext.Provider>
  )
}
