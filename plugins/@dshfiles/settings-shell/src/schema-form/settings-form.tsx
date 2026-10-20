import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { PlusIcon, RotateCcwIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { z } from 'zod'
import type { ShellTranslate } from '../native/locales.js'
import {
  jsonValueSchema,
  SettingsSchemaModel,
  type ChoiceOption,
  type JsonValue,
  type NumberControl,
  type ScalarControl,
  type SettingControl,
  type SettingField,
} from './schema-model.js'

const numberSchema = z.coerce.number().finite()

/** A choice's value as a stable string key for selects and segments. */
const choiceKey = (value: JsonValue | undefined): string => JSON.stringify(value) ?? ''

/** Wraps every case-insensitive occurrence of `query` in a mark. */
export const Highlight = (props: { readonly text: string; readonly query: string | undefined }): ReactNode => {
  const query = props.query?.trim().toLowerCase() ?? ''
  if (query.length === 0) return props.text
  const lower = props.text.toLowerCase()
  const parts: ReactNode[] = []
  let from = 0
  let at = lower.indexOf(query)
  while (at !== -1) {
    if (at > from) parts.push(props.text.slice(from, at))
    parts.push(
      <mark className="dshx:rounded-[2px] dshx:bg-warning/30 dshx:text-inherit" key={at}>
        {props.text.slice(at, at + query.length)}
      </mark>,
    )
    from = at + query.length
    at = lower.indexOf(query, from)
  }
  if (from < props.text.length) parts.push(props.text.slice(from))
  return parts
}

const useConfigFormSnapshot = (form: ConfigForm<unknown>): ConfigFormSnapshot<unknown> =>
  useSyncExternalStore(
    listener => form.subscribe(listener),
    () => form.getSnapshot(),
  )

/** A text draft that follows the stored value until the user edits it, and commits on Enter or blur. */
const useDraft = (stored: string, commit: (draft: string) => void) => {
  const [draft, setDraft] = useState(stored)
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setDraft(stored)
  }, [stored])
  return {
    value: draft,
    onChange: (next: string) => {
      editing.current = true
      setDraft(next)
    },
    onCommit: () => {
      editing.current = false
      if (draft !== stored) commit(draft)
    },
  }
}

const formatNumber = (control: NumberControl, value: JsonValue | undefined): string => {
  const parsed = numberSchema.safeParse(value)
  if (!parsed.success || value === undefined || value === null) return ''
  return String(control.percent ? Math.round(parsed.data * 10_000) / 100 : parsed.data)
}

const ChoiceInput = (props: {
  readonly label: string
  readonly options: readonly ChoiceOption[]
  readonly value: JsonValue | undefined
  readonly disabled: boolean
  readonly onChange: (value: JsonValue) => void
}): JSX.Element => {
  const selected = choiceKey(props.value)
  const pick = (key: string): void => {
    const option = props.options.find(candidate => choiceKey(candidate.value) === key)
    if (option !== undefined) props.onChange(option.value)
  }
  if (SettingsSchemaModel.choiceDisplay(props.options) === 'segmented') {
    return (
      <ToggleGroup aria-label={props.label} disabled={props.disabled} onValueChange={pick} size="sm" type="single" value={selected} variant="outline">
        {props.options.map(option => (
          <ToggleGroupItem className="dshx:px-3" key={choiceKey(option.value)} title={option.detail || undefined} value={choiceKey(option.value)}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    )
  }
  return (
    <Select disabled={props.disabled} onValueChange={pick} value={selected}>
      <SelectTrigger aria-label={props.label} className="dshx:min-w-40" size="sm">
        <SelectValue>{props.options.find(option => choiceKey(option.value) === selected)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {props.options.map(option => (
          <SelectItem key={choiceKey(option.value)} textValue={option.label} value={choiceKey(option.value)}>
            <span className="dshx:flex dshx:flex-col">
              <span>{option.label}</span>
              {option.detail !== '' && <span className="dshx:max-w-80 dshx:text-xs dshx:whitespace-normal dshx:text-muted-foreground">{option.detail}</span>}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const NumberInput = (props: {
  readonly label: string
  readonly control: NumberControl
  readonly value: JsonValue | undefined
  readonly disabled: boolean
  readonly t: ShellTranslate
  readonly onChange: (value: JsonValue) => void
}): JSX.Element => {
  const [invalid, setInvalid] = useState(false)
  const { control } = props
  const scale = control.percent ? 100 : 1
  const draft = useDraft(formatNumber(control, props.value), text => {
    const parsed = numberSchema.safeParse(text)
    const value = parsed.success ? parsed.data / scale : Number.NaN
    const outOfRange = (control.min !== undefined && value < control.min) || (control.max !== undefined && value > control.max)
    setInvalid(!parsed.success || text.trim() === '' || outOfRange)
    if (parsed.success && text.trim() !== '' && !outOfRange) props.onChange(value)
  })
  return (
    <div className="dshx:flex dshx:flex-col dshx:items-end dshx:gap-1">
      <InputGroup className="dshx:w-36">
        <InputGroupInput
          aria-invalid={invalid}
          aria-label={props.label}
          className="dshx:text-right dshx:font-mono! dshx:tabular-nums"
          disabled={props.disabled}
          inputMode="decimal"
          max={control.max === undefined ? undefined : control.max * scale}
          min={control.min === undefined ? undefined : control.min * scale}
          onBlur={draft.onCommit}
          onChange={event => draft.onChange(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') draft.onCommit()
          }}
          step={control.step === undefined ? undefined : control.step * scale}
          type="number"
          value={draft.value}
        />
        {control.unit !== undefined && (
          <InputGroupAddon align="inline-end">
            <InputGroupText>{control.unit}</InputGroupText>
          </InputGroupAddon>
        )}
      </InputGroup>
      {invalid && (
        <span className="dshx:text-xs dshx:text-destructive" role="alert">
          {props.t('form.invalidNumber', {
            min: control.min === undefined ? '−∞' : control.min * scale,
            max: control.max === undefined ? '∞' : control.max * scale,
          })}
        </span>
      )}
    </div>
  )
}

const TextInput = (props: {
  readonly label: string
  readonly multiline: boolean
  readonly value: JsonValue | undefined
  readonly disabled: boolean
  readonly className?: string | undefined
  readonly placeholder?: string | undefined
  readonly secretReference?: boolean
  readonly onChange: (value: JsonValue) => void
}): JSX.Element => {
  const draft = useDraft(z.string().catch('').parse(props.value), text => props.onChange(text))
  if (props.multiline) {
    return (
      <Textarea
        aria-label={props.label}
        className={cn('dshx:min-h-20 dshx:w-full', props.className)}
        disabled={props.disabled}
        onBlur={draft.onCommit}
        onChange={event => draft.onChange(event.currentTarget.value)}
        value={draft.value}
      />
    )
  }
  return (
    <Input
      aria-label={props.label}
      className={cn('dshx:h-8 dshx:w-64', props.className)}
      data-secret-input={props.secretReference === true ? 'reference' : undefined}
      disabled={props.disabled}
      onBlur={draft.onCommit}
      onChange={event => draft.onChange(event.currentTarget.value)}
      onKeyDown={event => {
        if (event.key === 'Enter') draft.onCommit()
      }}
      placeholder={props.placeholder}
      value={draft.value}
    />
  )
}

const ScalarInput = (props: {
  readonly label: string
  readonly control: ScalarControl
  readonly value: JsonValue | undefined
  readonly disabled: boolean
  readonly t: ShellTranslate
  readonly className?: string
  readonly onChange: (value: JsonValue) => void
}): JSX.Element => {
  const { control } = props
  if (control.kind === 'boolean') {
    return <Switch aria-label={props.label} checked={props.value === true} disabled={props.disabled} onCheckedChange={checked => props.onChange(checked)} />
  }
  if (control.kind === 'choice')
    return <ChoiceInput disabled={props.disabled} label={props.label} onChange={props.onChange} options={control.options} value={props.value} />
  if (control.kind === 'number')
    return <NumberInput control={control} disabled={props.disabled} label={props.label} onChange={props.onChange} t={props.t} value={props.value} />
  return (
    <TextInput
      className={props.className}
      disabled={props.disabled}
      label={props.label}
      multiline={control.multiline}
      onChange={props.onChange}
      placeholder={control.secretReference === true ? props.t('form.secretReference') : undefined}
      secretReference={control.secretReference === true}
      value={props.value}
    />
  )
}

/** An ordered list of scalar values, one row each. */
const ListInput = (props: {
  readonly label: string
  readonly item: ScalarControl
  readonly value: JsonValue | undefined
  readonly disabled: boolean
  readonly t: ShellTranslate
  readonly onChange: (value: JsonValue) => void
}): JSX.Element => {
  const items = z.array(jsonValueSchema).catch([]).parse(props.value)
  const replace = (index: number, next: JsonValue): void => props.onChange(items.map((item, at) => (at === index ? next : item)))
  return (
    <div className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-1.5" role="list" aria-label={props.label}>
      {items.map((item, index) => (
        <div className="dshx:flex dshx:items-center dshx:gap-1.5" key={index} role="listitem">
          <ScalarInput
            className="dshx:w-full"
            control={props.item}
            disabled={props.disabled}
            label={`${props.label} ${index + 1}`}
            onChange={next => replace(index, next)}
            t={props.t}
            value={item}
          />
          <Button
            aria-label={props.t('form.remove', { item: `${props.label} ${index + 1}` })}
            disabled={props.disabled}
            onClick={() => props.onChange(items.filter((_, at) => at !== index))}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </div>
      ))}
      {items.length === 0 && <span className="dshx:text-xs dshx:text-muted-foreground">{props.t('form.empty')}</span>}
      <Button
        className="dshx:self-start"
        disabled={props.disabled}
        onClick={() => props.onChange([...items, SettingsSchemaModel.blankValue(props.item)])}
        size="sm"
        type="button"
        variant="outline"
      >
        <PlusIcon />
        {props.t('form.add')}
      </Button>
    </div>
  )
}

/** A string-keyed map of scalar values: key and value per row. */
const RecordInput = (props: {
  readonly label: string
  readonly valueControl: ScalarControl
  readonly value: JsonValue | undefined
  readonly disabled: boolean
  readonly t: ShellTranslate
  readonly onChange: (value: JsonValue) => void
}): JSX.Element => {
  const entries = Object.entries(z.record(z.string(), jsonValueSchema).catch({}).parse(props.value))
  const [newKey, setNewKey] = useState('')
  const write = (next: readonly (readonly [string, JsonValue])[]): void => props.onChange(Object.fromEntries(next))
  return (
    <div aria-label={props.label} className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-1.5" role="list">
      {entries.map(([key, value]) => (
        <div className="dshx:flex dshx:items-center dshx:gap-1.5" key={key} role="listitem">
          <span className="dshx:w-40 dshx:shrink-0 dshx:truncate dshx:font-mono dshx:text-xs" title={key}>
            {key}
          </span>
          <ScalarInput
            className="dshx:w-full"
            control={props.valueControl}
            disabled={props.disabled}
            label={`${props.label} ${key}`}
            onChange={next => write(entries.map(([entryKey, entryValue]) => [entryKey, entryKey === key ? next : entryValue] as const))}
            t={props.t}
            value={value}
          />
          <Button
            aria-label={props.t('form.remove', { item: key })}
            disabled={props.disabled}
            onClick={() => write(entries.filter(([entryKey]) => entryKey !== key))}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <div className="dshx:flex dshx:items-center dshx:gap-1.5">
        <Input
          aria-label={`${props.label} ${props.t('form.newKey')}`}
          className="dshx:h-7 dshx:w-40 dshx:font-mono! dshx:text-xs"
          disabled={props.disabled}
          onChange={event => setNewKey(event.currentTarget.value)}
          placeholder={props.t('form.newKey')}
          value={newKey}
        />
        <Button
          disabled={props.disabled || newKey.trim() === '' || entries.some(([key]) => key === newKey.trim())}
          onClick={() => {
            write([...entries, [newKey.trim(), SettingsSchemaModel.blankValue(props.valueControl)]])
            setNewKey('')
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon />
          {props.t('form.add')}
        </Button>
      </div>
    </div>
  )
}

/** The fallback for shapes no control fits: the value as JSON, saved when it parses. */
const JsonInput = (props: {
  readonly label: string
  readonly value: JsonValue | undefined
  readonly disabled: boolean
  readonly t: ShellTranslate
  readonly onChange: (value: JsonValue) => void
}): JSX.Element => {
  const [invalid, setInvalid] = useState(false)
  const draft = useDraft(props.value === undefined ? '' : (JSON.stringify(props.value, null, 2) ?? ''), text => {
    const value = SettingsSchemaModel.parseJsonDraft(text)
    setInvalid(value === undefined)
    if (value !== undefined) props.onChange(value)
  })
  return (
    <div className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-1">
      <Textarea
        aria-invalid={invalid}
        aria-label={props.label}
        className="dshx:min-h-24 dshx:w-full dshx:font-mono! dshx:text-xs"
        disabled={props.disabled}
        onBlur={draft.onCommit}
        onChange={event => draft.onChange(event.currentTarget.value)}
        spellCheck={false}
        value={draft.value}
      />
      <span className={cn('dshx:text-xs', invalid ? 'dshx:text-destructive' : 'dshx:text-muted-foreground')} role={invalid ? 'alert' : undefined}>
        {invalid ? props.t('form.invalidJson') : props.t('form.json')}
      </span>
    </div>
  )
}

type PendingEdit = { readonly kind: 'set'; readonly value: JsonValue } | { readonly kind: 'reset' }

/** What a row shows: a pending edit first, else the resolved value, else (after a reset) the composition default. */
const displayedValue = (input: {
  readonly edit: PendingEdit | undefined
  readonly field: SettingField
  readonly values: JsonValue | undefined
  readonly base: JsonValue | undefined
}): JsonValue | undefined => {
  if (input.edit?.kind === 'set') return input.edit.value
  if (input.edit?.kind === 'reset') return SettingsSchemaModel.valueAt(input.base, input.field.path) ?? input.field.defaultValue
  return SettingsSchemaModel.valueAt(input.values, input.field.path) ?? input.field.defaultValue
}

/** Wide controls sit under the description; single-value controls sit on the title row. */
const isBlockControl = (control: SettingControl): boolean =>
  control.kind === 'list' || control.kind === 'record' || control.kind === 'json' || (control.kind === 'text' && control.multiline)

const SettingControlInput = (props: {
  readonly label: string
  readonly control: SettingControl
  readonly value: JsonValue | undefined
  readonly disabled: boolean
  readonly t: ShellTranslate
  readonly onChange: (value: JsonValue) => void
}): JSX.Element => {
  const { control } = props
  if (control.kind === 'list')
    return <ListInput disabled={props.disabled} item={control.item} label={props.label} onChange={props.onChange} t={props.t} value={props.value} />
  if (control.kind === 'record') {
    return <RecordInput disabled={props.disabled} label={props.label} onChange={props.onChange} t={props.t} value={props.value} valueControl={control.value} />
  }
  if (control.kind === 'json') return <JsonInput disabled={props.disabled} label={props.label} onChange={props.onChange} t={props.t} value={props.value} />
  return <ScalarInput control={control} disabled={props.disabled} label={props.label} onChange={props.onChange} t={props.t} value={props.value} />
}

/** How long a deep-linked row stays highlighted after it scrolls into view. */
const FLASH_MS = 2_000

/** One setting: title, description and control, with the save outcome under it. */
const SettingRow = (props: {
  readonly field: SettingField
  readonly value: JsonValue | undefined
  /** The user layer sets this field: the row shows the modified bar and offers a reset. */
  readonly modified: boolean
  readonly reset: (field: SettingField) => Promise<boolean>
  readonly disabled: boolean
  readonly highlight: string | undefined
  readonly focused: boolean
  readonly t: ShellTranslate
  readonly write: (field: SettingField, value: JsonValue) => Promise<boolean>
}): JSX.Element => {
  const { field } = props
  const [refused, setRefused] = useState(false)
  const row = useRef<HTMLDivElement>(null)
  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (!props.focused) return
    row.current?.scrollIntoView({ block: 'center' })
    setFlashing(true)
    const timeout = window.setTimeout(() => setFlashing(false), FLASH_MS)
    return () => window.clearTimeout(timeout)
  }, [props.focused])
  const save = (value: JsonValue): void => {
    setRefused(false)
    void props.write(field, value).then(
      accepted => setRefused(!accepted),
      () => setRefused(true),
    )
  }
  const reset = (): void => {
    setRefused(false)
    void props.reset(field).then(
      accepted => setRefused(!accepted),
      () => setRefused(true),
    )
  }
  const block = isBlockControl(field.control)
  const control = <SettingControlInput control={field.control} disabled={props.disabled} label={field.title} onChange={save} t={props.t} value={props.value} />
  return (
    <div
      className={cn(
        'dshx:group dshx:relative dshx:flex dshx:flex-col dshx:gap-2 dshx:border-b-[0.5px] dshx:border-border dshx:py-3.5 dshx:last:border-b-0',
        flashing && 'dshx:rounded-md dshx:bg-accent/70 dshx:px-2 dshx:transition-colors',
      )}
      data-modified={props.modified ? '' : undefined}
      data-setting-path={field.path.join('.')}
      ref={row}
    >
      {props.modified && (
        <span
          aria-hidden="true"
          className="dshx:absolute dshx:inset-y-3 dshx:-left-3 dshx:w-0.5 dshx:rounded-full dshx:bg-info"
          title={props.t('form.modified')}
        />
      )}
      <div className="dshx:flex dshx:items-start dshx:justify-between dshx:gap-6">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
          <span className="dshx:flex dshx:min-h-5 dshx:items-center dshx:gap-2 dshx:text-[14px] dshx:leading-5 dshx:text-foreground">
            <Highlight query={props.highlight} text={field.title} />
            {props.modified && <span className="dshx:sr-only">{props.t('form.modified')}</span>}
            {props.modified && (
              <Button
                className="dshx:h-5 dshx:px-1.5 dshx:text-[11px] dshx:text-muted-foreground dshx:opacity-0 dshx:group-focus-within:opacity-100 dshx:group-hover:opacity-100 dshx:focus-visible:opacity-100"
                disabled={props.disabled}
                onClick={reset}
                size="xs"
                type="button"
                variant="ghost"
              >
                <RotateCcwIcon />
                {props.t('form.reset')}
              </Button>
            )}
          </span>
          {field.description !== '' && (
            <span className="dshx:text-[12px] dshx:leading-[18px] dshx:text-muted-foreground">
              <Highlight query={props.highlight} text={field.description} />
            </span>
          )}
          <code className="dshx:font-mono dshx:text-[11px] dshx:text-muted-foreground/80">
            <Highlight query={props.highlight} text={field.path.join('.')} />
          </code>
        </div>
        {!block && <div className="dshx:shrink-0">{control}</div>}
      </div>
      {block && control}
      {refused && (
        <span className="dshx:text-xs dshx:text-destructive" role="alert">
          {props.t('form.refused')}
        </span>
      )}
    </div>
  )
}

/**
 * One namespace's settings as rows, grouped under the nested objects that hold them. Every edit writes through the
 * shared ConfigForm, the store native rows, Settings Search and `useSettings` use, so they all stay in step.
 */
export const SettingsForm = (props: {
  readonly form: ConfigForm<unknown>
  readonly fields: readonly SettingField[]
  readonly t: ShellTranslate
  readonly highlight?: string
  readonly focusPath?: readonly string[]
}): JSX.Element => {
  const snapshot = useConfigFormSnapshot(props.form)
  const values = jsonValueSchema.safeParse(snapshot.value)
  const disabled = snapshot.status !== 'ready' || !snapshot.writable
  // A Host write settles in seconds (it persists the profile and reloads the entry), so a row shows what was asked for
  // until the write settles: `set` holds the new value, `reset` the cleared override.
  const [pending, setPending] = useState<ReadonlyMap<string, PendingEdit>>(new Map())
  const settle = (key: string, edit: PendingEdit, write: Promise<boolean>): Promise<boolean> => {
    setPending(current => new Map(current).set(key, edit))
    return write.finally(() =>
      setPending(current => {
        if (current.get(key) !== edit) return current
        const next = new Map(current)
        next.delete(key)
        return next
      }),
    )
  }
  // No revision of our own: the form queues writes per namespace and fences each with the revision the previous one
  // answered, so a reset clicked while a change is saving lands after it instead of carrying the pre-change revision.
  const write = (field: SettingField, value: JsonValue): Promise<boolean> =>
    settle(field.path.join('.'), { kind: 'set', value }, props.form.mutate([{ op: 'set', path: [...field.path], value }]))
  const reset = (field: SettingField): Promise<boolean> =>
    settle(field.path.join('.'), { kind: 'reset' }, props.form.mutate([{ op: 'unset', path: [...field.path] }]))
  const user = jsonValueSchema.safeParse(snapshot.user)
  const base = jsonValueSchema.safeParse(snapshot.base)
  const focusKey = props.focusPath?.join('.')
  return (
    <div className="dshx:flex dshx:flex-col">
      {snapshot.status === 'unavailable' && <p className="dshx:py-2 dshx:text-sm dshx:text-muted-foreground">{props.t('form.unavailable')}</p>}
      {snapshot.status === 'ready' && !snapshot.writable && <p className="dshx:py-2 dshx:text-sm dshx:text-muted-foreground">{props.t('form.readOnly')}</p>}
      {props.fields.map((field, index) => {
        const edit = pending.get(field.path.join('.'))
        const group = field.groups.join(' › ')
        const previous = props.fields[index - 1]?.groups.join(' › ')
        return (
          <Fragment key={field.path.join('.')}>
            {group !== '' && group !== previous && (
              <h4 className="dshx:mt-4 dshx:text-xs dshx:font-semibold dshx:tracking-wide dshx:text-muted-foreground dshx:uppercase">{group}</h4>
            )}
            <SettingRow
              disabled={disabled}
              field={field}
              focused={focusKey === field.path.join('.')}
              highlight={props.highlight}
              modified={edit === undefined ? user.success && SettingsSchemaModel.hasValueAt(user.data, field.path) : edit.kind === 'set'}
              reset={reset}
              t={props.t}
              value={displayedValue({ edit, field, values: values.success ? values.data : undefined, base: base.success ? base.data : undefined })}
              write={write}
            />
          </Fragment>
        )
      })}
    </div>
  )
}
