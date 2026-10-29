import { useId } from 'react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import type { PropertyDefinition, PropertyValue, ResourceRecord, ResourceRef } from './model.js'
import { ResourceUiModel } from './ui-helpers.js'

function ReferenceInput(props: {
  label: string
  value: ResourceRef | null
  resources: readonly ResourceRecord[]
  disabled: boolean
  onChange: (ref: ResourceRef | null) => void
}): JSX.Element {
  const value = props.value
  return (
    <div className="dshx:grid dshx:gap-2">
      <Combobox
        label={props.label}
        value={
          value === null
            ? ''
            : (props.resources.find(resource => ResourceUiModel.refKey(resource.ref) === ResourceUiModel.refKey(value))?.id ?? 'unregistered-reference')
        }
        disabled={props.disabled}
        options={[
          { value: '', label: 'No reference' },
          ...props.resources.map(resource => ({ value: resource.id, label: resource.label, description: ResourceUiModel.refText(resource.ref) })),
          ...(value !== null && !props.resources.some(resource => ResourceUiModel.refKey(resource.ref) === ResourceUiModel.refKey(value))
            ? [{ value: 'unregistered-reference', label: ResourceUiModel.referenceLabel(value, props.resources) }]
            : []),
        ]}
        onValueChange={id => {
          if (id !== 'unregistered-reference') props.onChange(props.resources.find(resource => resource.id === id)?.ref ?? null)
        }}
      />
      <span className="dshx:text-xs dshx:text-muted-foreground">Or enter a source reference. This does not read or open its content.</span>
      {(['provider', 'kind', 'id'] as const).map(key => (
        <label key={key} className="dshx:grid dshx:gap-1 dshx:text-xs">
          {`${props.label} ${key === 'id' ? 'native ID' : key}`}
          <Input
            disabled={props.disabled}
            value={value?.[key] ?? ''}
            onChange={event => props.onChange({ provider: value?.provider ?? '', kind: value?.kind ?? '', id: value?.id ?? '', [key]: event.target.value })}
          />
        </label>
      ))}
    </div>
  )
}

export function PropertyInput(props: {
  property: PropertyDefinition
  value: PropertyValue | undefined
  resources: readonly ResourceRecord[]
  onChange: (value: PropertyValue) => void
}): JSX.Element {
  const { property, value, onChange } = props
  const id = useId()
  const disabled = property.readOnly
  const ref = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
  const refs = Array.isArray(value) ? value.filter((item): item is ResourceRef => typeof item !== 'string') : []
  const string = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  let input: JSX.Element
  switch (property.type) {
    case 'checkbox':
      input = <input id={id} type="checkbox" disabled={disabled} checked={value === true} onChange={event => onChange(event.target.checked)} />
      break
    case 'select':
      input = (
        <Combobox
          label={property.label}
          disabled={disabled}
          value={string}
          options={[
            { value: '', label: 'No value' },
            ...property.options.map(option => ({ value: option.id, label: option.label })),
            ...(string !== '' && !property.options.some(option => option.id === string) ? [{ value: string, label: `Unknown option: ${string}` }] : []),
          ]}
          onValueChange={onChange}
        />
      )
      break
    case 'multiselect':
      input = (
        <div className="dshx:grid dshx:gap-2">
          {property.options.map(option => (
            <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm" key={option.id}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={Array.isArray(value) && value.some(item => item === option.id)}
                onChange={event =>
                  onChange(
                    event.target.checked
                      ? [...(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []), option.id]
                      : Array.isArray(value)
                        ? value.filter((item): item is string => typeof item === 'string' && item !== option.id)
                        : [],
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      )
      break
    case 'reference':
      input = <ReferenceInput label={property.label} value={ref} resources={props.resources} disabled={disabled} onChange={onChange} />
      break
    case 'references':
      input = (
        <div className="dshx:grid dshx:gap-3">
          {refs.map((item, index) => (
            <div className="dshx:grid dshx:gap-2" key={index}>
              <ReferenceInput
                label={`${property.label} ${index + 1}`}
                value={item}
                resources={props.resources}
                disabled={disabled}
                onChange={next => onChange(next === null ? refs.filter((_, i) => i !== index) : refs.map((existing, i) => (i === index ? next : existing)))}
              />
              <Button type="button" variant="outline" disabled={disabled} onClick={() => onChange(refs.filter((_, i) => i !== index))}>
                Remove {property.label} {index + 1}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={disabled || refs.length >= 100}
            onClick={() => onChange([...refs, { provider: '', kind: '', id: '' }])}
          >
            Add {property.label} reference
          </Button>
        </div>
      )
      break
    default:
      input = (
        <Input
          id={id}
          disabled={disabled}
          type={property.type === 'datetime' ? 'datetime-local' : property.type === 'text' ? 'text' : property.type}
          step={property.type === 'number' ? 'any' : undefined}
          value={property.type === 'datetime' ? ResourceUiModel.datetimeInput(value) : string}
          onChange={event => onChange(event.target.value)}
        />
      )
  }
  return (
    <div className="dshx:grid dshx:gap-2">
      <Label htmlFor={id}>
        {property.label}
        {disabled ? ' (read-only)' : ''}
      </Label>
      {input}
      {property.description !== '' && <p className="dshx:text-xs dshx:text-muted-foreground">{property.description}</p>}
      {disabled && <p className="dshx:text-xs dshx:text-muted-foreground">Only the pack owner can write this field.</p>}
      {!disabled && value !== undefined && value !== null && (
        <Button type="button" size="sm" variant="ghost" className="dshx:justify-self-start" onClick={() => onChange(null)}>
          Clear {property.label}
        </Button>
      )}
    </div>
  )
}
