import { useMemo } from 'react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DataTable, createColumnHelper, tableFeatures, useTable } from '@dshfiles/plugin-ui/table'
import { resourceRefSchema, type PackDefinition, type PropertyDefinition, type PropertyValue, type ResourceRecord, type ResourceRef } from './model.js'
import { ResourceUiModel } from './ui-helpers.js'

const features = tableFeatures({})
const column = createColumnHelper<typeof features, ResourceRecord>()

function ReferenceCell(props: { reference: ResourceRef; resources: readonly ResourceRecord[]; onOpenReference: (ref: ResourceRef) => void }): JSX.Element {
  const label = ResourceUiModel.referenceLabel(props.reference, props.resources)
  if (props.reference.provider === 'dsh' && props.reference.kind === 'conversation')
    return (
      <Button type="button" variant="link" aria-label={`Open conversation ${label}`} onClick={() => props.onOpenReference(props.reference)}>
        {label}
      </Button>
    )
  return <span>{label}</span>
}

function PropertyCell(props: {
  property: PropertyDefinition
  value: PropertyValue | undefined
  resources: readonly ResourceRecord[]
  onOpenReference: (ref: ResourceRef) => void
}): JSX.Element {
  if (props.property.type === 'reference') {
    const reference = resourceRefSchema.safeParse(props.value)
    if (reference.success) return <ReferenceCell reference={reference.data} resources={props.resources} onOpenReference={props.onOpenReference} />
  }
  if (props.property.type === 'references') {
    const references = resourceRefSchema.array().safeParse(props.value)
    if (references.success && references.data.length > 0)
      return (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
          {references.data.map((reference, index) => (
            <ReferenceCell
              key={`${ResourceUiModel.refKey(reference)}:${index}`}
              reference={reference}
              resources={props.resources}
              onOpenReference={props.onOpenReference}
            />
          ))}
        </div>
      )
  }
  return <span>{ResourceUiModel.displayValue(props.property, props.value, props.resources)}</span>
}

export function ResourceTable(props: {
  resources: ResourceRecord[]
  pack: PackDefinition | undefined
  references: readonly ResourceRecord[]
  onEdit: (resource: ResourceRecord) => void
  onOpenReference: (ref: ResourceRef) => void
}): JSX.Element {
  const { pack, references, onEdit, onOpenReference } = props
  const columns = useMemo(
    () =>
      column.columns([
        column.display({
          id: 'resource',
          header: 'Resource',
          cell: context => (
            <Button variant="link" aria-label={`Edit ${context.row.original.label}`} onClick={() => onEdit(context.row.original)}>
              {context.row.original.label}
            </Button>
          ),
        }),
        column.display({
          id: 'reference',
          header: 'Source reference',
          cell: context => <span className="dshx:block dshx:max-w-72 dshx:truncate">{ResourceUiModel.refText(context.row.original.ref)}</span>,
        }),
        ...(pack === undefined
          ? []
          : pack.properties.map(property =>
              column.display({
                id: `property-${property.id}`,
                header: `${property.label}${property.readOnly ? ' (read-only)' : ''}`,
                cell: context => {
                  const attachment = ResourceUiModel.attachmentFor(context.row.original, pack.id)
                  return attachment?.attached === true ? (
                    <PropertyCell
                      property={property}
                      value={Object.hasOwn(attachment.values, property.id) ? attachment.values[property.id] : undefined}
                      resources={references}
                      onOpenReference={onOpenReference}
                    />
                  ) : (
                    'Not attached'
                  )
                },
              }),
            )),
      ]),
    [pack, references, onEdit, onOpenReference],
  )
  const table = useTable({ features, columns, data: props.resources })
  return (
    <div className="dshx:min-w-0 dshx:overflow-x-auto" role="region" aria-label="Resource table" tabIndex={0}>
      <DataTable
        table={table}
        className="dshx:min-w-max"
        caption={props.pack === undefined ? 'Registered resource metadata' : `${props.pack.label} · version ${props.pack.version}`}
        empty="No resources match. Add a resource or change the search."
        cellClassName={() => 'dshx:min-w-40'}
      />
    </div>
  )
}
