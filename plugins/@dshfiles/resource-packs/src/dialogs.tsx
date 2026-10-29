import type { ReactNode } from 'react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { useAppForm } from '@dshfiles/plugin-ui/form'
import { errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import { packDefinitionSchema, resourceRefSchema, type PackDefinition, type PropertyDefinition, type ResourceRecord, type StoredPack } from './model.js'
import { ResourceUiModel, type ResourcePacksClient } from './ui-helpers.js'

export function ResourceDialog(props: { heading: string; description: string; onClose: () => void; children: ReactNode }): JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent className="dshx-root dshx:@container dshx:max-h-[90vh] dshx:overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.heading}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        {props.children}
      </DialogContent>
    </Dialog>
  )
}

export function MutationError(props: { error: Error | null }): JSX.Element | null {
  return props.error === null ? null : (
    <p role="alert" className="dshx:text-sm dshx:text-destructive">
      {errorMessage(props.error, 'The change could not be saved.')}
    </p>
  )
}

export function AddResourceDialog(props: { api: ResourcePacksClient; onClose: () => void; onCreated: (resource: ResourceRecord) => void }): JSX.Element {
  const mutation = useMutation({
    mutationFn: async (value: { provider: string; kind: string; id: string; label: string }) =>
      props.api.registerResource({ ref: resourceRefSchema.parse({ provider: value.provider, kind: value.kind, id: value.id }), label: value.label }),
    onSuccess: props.onCreated,
  })
  const form = useAppForm({
    defaultValues: { provider: 'dsh', kind: 'conversation', id: '', label: '' },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value).catch(() => undefined)
    },
  })
  return (
    <ResourceDialog
      heading="Add resource"
      description="Register metadata only. File paths are current-path references, not rename tracking. No native contents are read."
      onClose={props.onClose}
    >
      <form
        className="dshx:grid dshx:gap-4"
        onSubmit={event => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <form.AppField name="provider">{field => <field.TextField label="Provider" required />}</form.AppField>
        <form.Field name="kind">
          {field => (
            <div className="dshx:grid dshx:gap-2">
              <Combobox
                label="Kind"
                value={['conversation', 'file', 'record'].includes(field.state.value) ? field.state.value : 'custom'}
                options={['conversation', 'file', 'record', 'custom'].map(value => ({ value, label: value }))}
                onValueChange={value => field.handleChange(value === 'custom' ? '' : value)}
              />
              {!['conversation', 'file', 'record'].includes(field.state.value) && (
                <label>
                  Custom kind
                  <Input value={field.state.value} required onChange={event => field.handleChange(event.target.value)} />
                </label>
              )}
            </div>
          )}
        </form.Field>
        <form.AppField name="id">{field => <field.TextField label="Native ID" required />}</form.AppField>
        <form.AppField name="label">{field => <field.TextField label="Resource label" required />}</form.AppField>
        <MutationError error={mutation.error} />
        <div className="dshx:flex dshx:flex-wrap dshx:justify-end dshx:gap-2">
          <Button type="button" variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <form.AppForm>
            <form.SubmitButton disabled={mutation.isPending}>Register resource</form.SubmitButton>
          </form.AppForm>
        </div>
      </form>
    </ResourceDialog>
  )
}

interface OptionDraft {
  id: string
  label: string
  customId: boolean
}
interface FieldDraft {
  id: string
  label: string
  type: PropertyDefinition['type']
  customId: boolean
  options: OptionDraft[]
}
interface PackDraft {
  id: string
  label: string
  customId: boolean
  fields: FieldDraft[]
}
const emptyField = (): FieldDraft => ({ id: '', label: '', type: 'text', customId: false, options: [{ id: '', label: '', customId: false }] })

function PackFieldRow(props: {
  value: FieldDraft
  index: number
  onChange: (field: FieldDraft) => void
  onRemove: () => void
  canRemove: boolean
}): JSX.Element {
  const prefix = `Field ${props.index + 1}`
  const row = props.value
  const options = row.type === 'select' || row.type === 'multiselect'
  return (
    <fieldset className="dshx:grid dshx:gap-3 dshx:rounded-md dshx:border dshx:p-3">
      <legend className="dshx:px-1 dshx:text-sm dshx:font-medium">{prefix}</legend>
      <label className="dshx:grid dshx:gap-1 dshx:text-sm">
        {prefix} label
        <Input
          required
          maxLength={100}
          value={row.label}
          onChange={event =>
            props.onChange({ ...row, label: event.target.value, id: row.customId ? row.id : ResourceUiModel.slugFromLabel(event.target.value) })
          }
        />
      </label>
      <label className="dshx:grid dshx:gap-1 dshx:text-sm">
        {prefix} ID
        <Input required value={row.id} onChange={event => props.onChange({ ...row, id: event.target.value, customId: true })} />
      </label>
      <Combobox
        label={`${prefix} type`}
        value={row.type}
        options={ResourceUiModel.propertyTypes.map(type => ({ value: type, label: type }))}
        onValueChange={value => {
          const type = ResourceUiModel.propertyTypes.find(type => type === value)
          if (type !== undefined) props.onChange({ ...row, type })
        }}
      />
      {options && (
        <div className="dshx:grid dshx:gap-3">
          {row.options.map((option, index) => (
            <div key={index} className="dshx:grid dshx:gap-2">
              <label className="dshx:grid dshx:gap-1 dshx:text-sm">
                {prefix} option {index + 1} label
                <Input
                  required
                  value={option.label}
                  onChange={event =>
                    props.onChange({
                      ...row,
                      options: row.options.map((item, i) =>
                        i === index
                          ? { ...option, label: event.target.value, id: option.customId ? option.id : ResourceUiModel.slugFromLabel(event.target.value) }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <label className="dshx:grid dshx:gap-1 dshx:text-sm">
                {prefix} option {index + 1} ID
                <Input
                  required
                  value={option.id}
                  onChange={event =>
                    props.onChange({
                      ...row,
                      options: row.options.map((item, i) => (i === index ? { ...option, id: event.target.value, customId: true } : item)),
                    })
                  }
                />
              </label>
              {row.options.length > 1 && (
                <Button type="button" variant="ghost" onClick={() => props.onChange({ ...row, options: row.options.filter((_, i) => i !== index) })}>
                  Remove {prefix.toLowerCase()} option {index + 1}
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={row.options.length >= 20}
            onClick={() => props.onChange({ ...row, options: [...row.options, { id: '', label: '', customId: false }] })}
          >
            Add option to field {props.index + 1}
          </Button>
        </div>
      )}
      <Button type="button" variant="ghost" disabled={!props.canRemove} onClick={props.onRemove}>
        Remove field {props.index + 1}
      </Button>
    </fieldset>
  )
}

function packFromDraft(value: PackDraft): PackDefinition {
  const definition = packDefinitionSchema.parse({
    id: value.id,
    label: value.label,
    version: 1,
    description: '',
    properties: value.fields.map(field => {
      const base = { id: field.id, label: field.label, readOnly: false, description: '' }
      if (field.type === 'select' || field.type === 'multiselect')
        return { ...base, type: field.type, options: field.options.map(option => ({ id: option.id, label: option.label })) }
      return { ...base, type: field.type }
    }),
  })
  if (new Set(definition.properties.map(field => field.id)).size !== definition.properties.length) throw new Error('Field IDs must be unique.')
  for (const field of definition.properties)
    if ((field.type === 'select' || field.type === 'multiselect') && new Set(field.options.map(option => option.id)).size !== field.options.length)
      throw new Error(`${field.label}: option IDs must be unique.`)
  return definition
}

export function NewPackDialog(props: {
  api: ResourcePacksClient
  packs: readonly StoredPack[]
  onClose: () => void
  onCreated: (pack: StoredPack) => void
}): JSX.Element {
  const mutation = useMutation({
    mutationFn: async (value: PackDraft) => {
      const definition = packFromDraft(value)
      if (props.packs.some(pack => pack.definition.id === definition.id)) throw new Error('This pack ID already exists. Choose a new stable ID.')
      return props.api.registerPack({ definition })
    },
    onSuccess: props.onCreated,
  })
  const defaults: PackDraft = { id: '', label: '', customId: false, fields: [emptyField()] }
  const form = useAppForm({
    defaultValues: defaults,
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value).catch(() => undefined)
    },
  })
  return (
    <ResourceDialog
      heading="New pack"
      description="Local-only reusable fields. Stable IDs cannot be changed after creation. This builder creates writable fields (up to 12); owner-only read-only fields require the contributor API."
      onClose={props.onClose}
    >
      <form
        className="dshx:grid dshx:gap-4"
        onSubmit={event => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <form.Field name="label">
          {field => (
            <label className="dshx:grid dshx:gap-1 dshx:text-sm">
              Pack label
              <Input
                required
                value={field.state.value}
                onChange={event => {
                  field.handleChange(event.target.value)
                  if (!form.getFieldValue('customId')) form.setFieldValue('id', ResourceUiModel.slugFromLabel(event.target.value))
                }}
              />
            </label>
          )}
        </form.Field>
        <form.Field name="id">
          {field => (
            <label className="dshx:grid dshx:gap-1 dshx:text-sm">
              Pack ID
              <Input
                required
                value={field.state.value}
                onChange={event => {
                  field.handleChange(event.target.value)
                  form.setFieldValue('customId', true)
                }}
              />
            </label>
          )}
        </form.Field>
        <form.Field name="fields" mode="array">
          {field => (
            <div className="dshx:grid dshx:gap-3">
              {field.state.value.map((row, index) => (
                <PackFieldRow
                  key={index}
                  value={row}
                  index={index}
                  canRemove={field.state.value.length > 1}
                  onRemove={() => field.removeValue(index)}
                  onChange={next => field.replaceValue(index, next)}
                />
              ))}
              <Button type="button" variant="outline" disabled={field.state.value.length >= 12} onClick={() => field.pushValue(emptyField())}>
                Add field
              </Button>
            </div>
          )}
        </form.Field>
        <MutationError error={mutation.error} />
        <div className="dshx:flex dshx:justify-end dshx:gap-2">
          <Button type="button" variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <form.AppForm>
            <form.SubmitButton disabled={mutation.isPending}>Create pack</form.SubmitButton>
          </form.AppForm>
        </div>
      </form>
    </ResourceDialog>
  )
}
