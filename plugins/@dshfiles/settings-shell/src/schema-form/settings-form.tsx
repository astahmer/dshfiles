import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@dshfiles/plugin-ui/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@dshfiles/plugin-ui/components/ui/collapsible'
import { ChevronRightIcon, PlusIcon, RotateCcwIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import * as Schema from 'effect/Schema'
import * as Option from 'effect/Option'
import type { ShellTranslate } from '../native/locales.js'
import {
  jsonValueSchema,
  SettingsSchemaModel,
  type ChoiceOption,
  type JsonShape,
  type JsonValue,
  type NumberControl,
  type ScalarControl,
  type SettingControl,
  type SettingField,
} from './schema-model.js'
import { savingOutcome, settleSave, type SaveOutcome, type SaveOutcomes } from './save-outcome.js'
import { SettingProvenanceModel, type SettingProvenance } from './setting-provenance.js'

const MAX_PREVIEW = 40

/** A short JSON preview of a value, for the source line. */
const valuePreview = (value: JsonValue): string => {
  const text = JSON.stringify(value) ?? ''
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW - 1)}…` : text
}

/** How long the pointer rests on a setting's name before its config key shows. */
const KEY_TOOLTIP_DELAY_MS = 600

/**
 * A value that is the schema default needs no caption: the source line is for the rows that differ. A schema without
 * a default gives the Host nothing to compare with, and "Source unknown" read as a fault, so that row says nothing.
 */
const showsSource = (provenance: SettingProvenance): boolean => provenance.source !== 'default' && provenance.source !== 'unknown'

/** A search that matched the config key shows it, so the highlighted match is on screen. */
const keyMatches = (key: string, query: string | undefined): boolean => {
  const needle = query?.trim().toLowerCase() ?? ''
  return needle !== '' && key.toLowerCase().includes(needle)
}

/** Where the row's value comes from, in words: no colour carries the meaning. */
const sourceText = (provenance: SettingProvenance, t: ShellTranslate): string => {
  if (provenance.source === 'user') {
    const label = provenance.equalsInherited ? t('source.userEqual') : t('source.user')
    return provenance.inherited === undefined || provenance.equalsInherited
      ? label
      : `${label} · ${t('source.inherits', { value: valuePreview(provenance.inherited) })}`
  }
  return t(`source.${provenance.source}`)
}

const numberSchema = Schema.Union([Schema.Number, Schema.NumberFromString]).check(Schema.isFinite())

type MutableJsonValue = string | number | boolean | null | MutableJsonValue[] | { [key: string]: MutableJsonValue }

const mutableJsonValue = (value: JsonValue): MutableJsonValue => {
  if (Array.isArray(value)) return value.map(item => mutableJsonValue(item))
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mutableJsonValue(item)]))
  return value
}

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
      <mark className="dshx:rounded-xs dshx:bg-warning/30 dshx:text-inherit" key={at}>
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
    /** Drops what was typed: the field shows the stored value again. */
    onReset: () => {
      editing.current = false
      setDraft(stored)
    },
  }
}

/** Float noise from a division (0.1 + 0.2) never reaches the field. */
const SHOWN_PRECISION = 12

/** A stored number in the unit the control shows: a fraction as a percentage, 300000 ms as 300 s. */
const shownNumber = (control: NumberControl, stored: number): number => {
  if (control.percent) return Math.round(stored * 10_000) / 100
  return control.factor === undefined ? stored : Number((stored / control.factor).toPrecision(SHOWN_PRECISION))
}

/** What a typed number stores. A scaled unit stores whole base units: 1.5 s is 1500 ms. */
const storedNumber = (control: NumberControl, shown: number): number => {
  if (control.percent) return shown / 100
  return control.factor === undefined ? shown : Math.round(shown * control.factor)
}

const formatNumber = (control: NumberControl, value: JsonValue | undefined): string => {
  const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(numberSchema)(value))
  if (parsed === undefined || value === undefined || value === null) return ''
  return String(shownNumber(control, parsed))
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
        {props.options.map(option =>
          option.detail === '' ? (
            <ToggleGroupItem className="dshx:px-3" key={choiceKey(option.value)} value={choiceKey(option.value)}>
              {option.label}
            </ToggleGroupItem>
          ) : (
            <Tooltip key={choiceKey(option.value)}>
              <TooltipTrigger asChild>
                <ToggleGroupItem className="dshx:px-3" value={choiceKey(option.value)}>
                  {option.label}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent className="dshx:max-w-72" side="top">
                {option.detail}
              </TooltipContent>
            </Tooltip>
          ),
        )}
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
  const shownBound = (bound: number | undefined): number | undefined => (bound === undefined ? undefined : shownNumber(control, bound))
  const draft = useDraft(formatNumber(control, props.value), text => {
    const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(numberSchema)(text))
    const value = parsed !== undefined ? storedNumber(control, parsed) : Number.NaN
    const outOfRange = (control.min !== undefined && value < control.min) || (control.max !== undefined && value > control.max)
    setInvalid(parsed === undefined || text.trim() === '' || outOfRange)
    if (parsed !== undefined && text.trim() !== '' && !outOfRange) props.onChange(value)
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
          // Chromium draws a number field's decimals in the field's language: without one it follows the browser (0,8 in
          // an English interface on a French system).
          lang={props.t('form.numberLocale')}
          max={shownBound(control.max)}
          min={shownBound(control.min)}
          onBlur={draft.onCommit}
          onChange={event => draft.onChange(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') draft.onCommit()
          }}
          // A scaled unit takes fractions (1.5 s); its step in stored units would be a sliver of the shown one.
          step={control.factor === undefined ? shownBound(control.step) : 'any'}
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
            min: shownBound(control.min) ?? '−∞',
            max: shownBound(control.max) ?? '∞',
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
  const draft = useDraft(Schema.decodeUnknownOption(Schema.String)(props.value).pipe(Option.getOrElse(() => '')), text => props.onChange(text))
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
  /** The row's write is in flight: the control already shows the value asked for and stays usable (round three item 29). */
  readonly busy?: boolean | undefined
  readonly onChange: (value: JsonValue) => void
}): JSX.Element => {
  const { control } = props
  if (control.kind === 'boolean') {
    return (
      <Switch
        aria-busy={props.busy === true ? true : undefined}
        aria-label={props.label}
        checked={props.value === true}
        disabled={props.disabled}
        onCheckedChange={checked => props.onChange(checked)}
      />
    )
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
  const items = Schema.decodeUnknownOption(Schema.Array(jsonValueSchema))(props.value).pipe(Option.getOrElse(() => []))
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
  const entries = Object.entries(Schema.decodeUnknownOption(Schema.Record(Schema.String, jsonValueSchema))(props.value).pipe(Option.getOrElse(() => ({}))))
  const [newKey, setNewKey] = useState('')
  const write = (next: readonly (readonly [string, JsonValue])[]): void => props.onChange(Object.fromEntries(next))
  return (
    <div aria-label={props.label} className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-1.5" role="list">
      {entries.map(([key, value]) => (
        <div className="dshx:flex dshx:items-center dshx:gap-1.5" key={key} role="listitem">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="dshx:w-40 dshx:shrink-0 dshx:truncate dshx:font-mono dshx:text-xs">{key}</span>
            </TooltipTrigger>
            <TooltipContent className="dshx:font-mono" side="top">
              {key}
            </TooltipContent>
          </Tooltip>
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

const JSON_HINT = { list: 'form.jsonList', object: 'form.jsonObject' } as const
const JSON_PROBLEM = { syntax: 'form.invalidJson', list: 'form.invalidJsonList', object: 'form.invalidJsonObject' } as const

/**
 * The fallback for shapes no control fits (a list of objects, a nested map): the value as JSON. The draft is checked
 * as it is typed, against the shape the schema declares, and only a valid one is ever saved, so a typo cannot break
 * the setting: the stored value stays, the field says what is wrong and how to fix it, and one button restores it.
 */
const JsonInput = (props: {
  readonly label: string
  readonly shape: JsonShape | undefined
  readonly value: JsonValue | undefined
  readonly disabled: boolean
  readonly t: ShellTranslate
  readonly onChange: (value: JsonValue) => void
}): JSX.Element => {
  const stored = props.value === undefined ? '' : (JSON.stringify(props.value, null, 2) ?? '')
  const draft = useDraft(stored, text => {
    const checked = SettingsSchemaModel.checkJsonDraft(text, props.shape)
    if (checked.ok) props.onChange(checked.value)
  })
  const checked = draft.value === stored ? undefined : SettingsSchemaModel.checkJsonDraft(draft.value, props.shape)
  const problem = checked === undefined || checked.ok ? undefined : checked.reason
  return (
    <div className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-1">
      <Textarea
        aria-invalid={problem !== undefined}
        aria-label={props.label}
        className="dshx:min-h-24 dshx:w-full dshx:font-mono! dshx:text-xs"
        disabled={props.disabled}
        onBlur={draft.onCommit}
        onChange={event => draft.onChange(event.currentTarget.value)}
        spellCheck={false}
        value={draft.value}
      />
      {problem === undefined ? (
        <span className="dshx:text-xs dshx:text-muted-foreground">{props.t(props.shape === undefined ? 'form.json' : JSON_HINT[props.shape])}</span>
      ) : (
        <span className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:text-xs dshx:text-destructive">
          <span role="alert">{props.t(JSON_PROBLEM[problem])}</span>
          <Button className="dshx:h-6 dshx:text-foreground" onClick={draft.onReset} size="xs" type="button" variant="outline">
            {props.t('form.restoreJson')}
          </Button>
        </span>
      )}
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
  readonly busy?: boolean | undefined
  readonly t: ShellTranslate
  readonly onChange: (value: JsonValue) => void
}): JSX.Element => {
  const { control } = props
  if (control.kind === 'list')
    return <ListInput disabled={props.disabled} item={control.item} label={props.label} onChange={props.onChange} t={props.t} value={props.value} />
  if (control.kind === 'record') {
    return <RecordInput disabled={props.disabled} label={props.label} onChange={props.onChange} t={props.t} value={props.value} valueControl={control.value} />
  }
  if (control.kind === 'json') {
    return <JsonInput disabled={props.disabled} label={props.label} onChange={props.onChange} shape={control.shape} t={props.t} value={props.value} />
  }
  return <ScalarInput busy={props.busy} control={control} disabled={props.disabled} label={props.label} onChange={props.onChange} t={props.t} value={props.value} />
}

/** How long a deep-linked row stays highlighted after it scrolls into view. */
const FLASH_MS = 2_000

/** One setting: title, description and control, with the save outcome under it. */
const SettingRow = (props: {
  readonly field: SettingField
  readonly value: JsonValue | undefined
  /** The user layer sets this field: the row shows the modified bar and offers a reset. */
  readonly modified: boolean
  readonly provenance: SettingProvenance
  readonly reset: (field: SettingField) => Promise<boolean>
  readonly disabled: boolean
  readonly highlight: string | undefined
  readonly focused: boolean
  /** The Host refused this row's last write. */
  readonly refused: boolean
  /** This row's write is in flight. */
  readonly saving: boolean
  readonly t: ShellTranslate
  readonly write: (field: SettingField, value: JsonValue) => Promise<boolean>
}): JSX.Element => {
  const { field } = props
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
    void props.write(field, value)
  }
  const reset = (): void => {
    void props.reset(field)
  }
  const block = isBlockControl(field.control)
  const key = field.path.join('.')
  const keyShown = keyMatches(key, props.highlight)
  const sourceShown = showsSource(props.provenance)
  const control = (
    <SettingControlInput busy={props.saving} control={field.control} disabled={props.disabled} label={field.title} onChange={save} t={props.t} value={props.value} />
  )
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
      {props.modified && <span aria-hidden="true" className="dshx:absolute dshx:inset-y-3 dshx:-left-3 dshx:w-0.5 dshx:rounded-full dshx:bg-info" />}
      {/* The label takes the rest of the lane and the control a 280px seat, right-aligned, so every control ends on the
          header's action edge (council round 7 B1). Below 28rem (a phone) every row stacks: its text, then its control
          (round five B7). */}
      <div
        className="dshx:grid dshx:grid-cols-[minmax(0,1fr)_minmax(280px,max-content)] dshx:items-start dshx:gap-6 dshx:@max-pane-narrow:grid-cols-1 dshx:@max-pane-narrow:gap-2"
        data-setting-row-layout=""
      >
        <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
          <span className="dshx:flex dshx:min-h-5 dshx:items-center dshx:gap-2 dshx:text-base dshx:leading-5 dshx:text-foreground">
            {/* The config key stays one hover away (and in the JSON view); it is not a line of every row. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span data-setting-label={key}>
                  <Highlight query={props.highlight} text={field.title} />
                </span>
              </TooltipTrigger>
              <TooltipContent className="dshx:font-mono" side="top">
                {key}
              </TooltipContent>
            </Tooltip>
            {props.modified && <span className="dshx:sr-only">{props.t('form.modified')}</span>}
            {props.modified && (
              <Button
                className="dshx:h-5 dshx:px-1.5 dshx:text-2xs dshx:text-muted-foreground dshx:opacity-0 dshx:group-focus-within:opacity-100 dshx:group-hover:opacity-100 dshx:focus-visible:opacity-100"
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
            <span className="dshx:max-w-[60ch] dshx:text-xs dshx:leading-[18px] dshx:text-muted-foreground">
              <Highlight query={props.highlight} text={field.description} />
            </span>
          )}
          {(keyShown || sourceShown) && (
            <span className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-x-2 dshx:text-2xs dshx:text-muted-foreground/80">
              {keyShown && (
                <code className="dshx:font-mono">
                  <Highlight query={props.highlight} text={key} />
                </code>
              )}
              {sourceShown && <span data-setting-source={props.provenance.source}>{sourceText(props.provenance, props.t)}</span>}
            </span>
          )}
        </div>
        {!block && <div className="dshx:min-w-0 dshx:justify-self-end dshx:@max-pane-narrow:justify-self-start">{control}</div>}
      </div>
      {block && control}
      {props.refused && (
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
  readonly namespace: string
  readonly form: ConfigForm<unknown>
  readonly fields: readonly SettingField[]
  readonly t: ShellTranslate
  readonly highlight?: string
  readonly focusPath?: readonly string[]
  /** Drawn at the end of the Advanced fold, after the advanced settings: the page's JSON switch and Plugin details. */
  readonly advancedExtra?: ReactNode
  /** The page the fold belongs to, for its accessible name ("Advanced: Main tabs") on an entry of several pages. */
  readonly advancedOf?: string
}): JSX.Element => {
  const snapshot = useConfigFormSnapshot(props.form)
  const values = Option.getOrUndefined(Schema.decodeUnknownOption(jsonValueSchema)(snapshot.value))
  const disabled = snapshot.status !== 'ready' || !snapshot.writable
  // A Host write settles in seconds (it persists the profile and reloads the entry), so a row shows what was asked for
  // until the write settles, then only a refusal stays visible. The entry itself identifies the write, so an older
  // settlement cannot overwrite a newer one.
  const [outcomes, setOutcomes] = useState<SaveOutcomes<PendingEdit>>(new Map())
  const settle = (key: string, edit: PendingEdit, write: Promise<boolean>): Promise<boolean> => {
    const outcome: SaveOutcome<PendingEdit> = savingOutcome(edit)
    setOutcomes(current => new Map(current).set(key, outcome))
    return write.then(
      accepted => {
        setOutcomes(current => settleSave(current, key, outcome, accepted))
        return accepted
      },
      () => {
        setOutcomes(current => settleSave(current, key, outcome, false))
        return false
      },
    )
  }
  // No revision of our own: the form queues writes per namespace and fences each with the revision the previous one
  // answered, so a reset clicked while a change is saving lands after it instead of carrying the pre-change revision.
  const write = (field: SettingField, value: JsonValue): Promise<boolean> => {
    const nativeValue = mutableJsonValue(value)
    return settle(field.path.join('.'), { kind: 'set', value }, props.form.mutate([{ op: 'set', path: [...field.path], value: nativeValue }]))
  }
  const reset = (field: SettingField): Promise<boolean> =>
    settle(field.path.join('.'), { kind: 'reset' }, props.form.mutate([{ op: 'unset', path: [...field.path] }]))
  const user = Option.getOrUndefined(Schema.decodeUnknownOption(jsonValueSchema)(snapshot.user))
  const base = Option.getOrUndefined(Schema.decodeUnknownOption(jsonValueSchema)(snapshot.base))
  const focusKey = props.focusPath?.join('.')
  const isModified = (field: SettingField): boolean => {
    const outcome = outcomes.get(field.path.join('.'))
    const edit = outcome?.status === 'saving' ? outcome.edit : undefined
    return edit === undefined ? user !== undefined && SettingsSchemaModel.hasValueAt(user, field.path) : edit.kind === 'set'
  }
  // Search results list exactly what matched: they never fold. Elsewhere the settings a schema folds sit under
  // "Advanced", which opens by itself when one of them is modified (a changed setting is never out of sight) or
  // focused from a link, and otherwise stays as the user left it.
  const folds = props.highlight === undefined
  const everyday = folds ? props.fields.filter(field => !field.advanced) : props.fields
  const advanced = folds ? props.fields.filter(field => field.advanced) : []
  const focusedAdvanced = advanced.some(field => field.path.join('.') === focusKey)
  const [advancedOpen, setAdvancedOpen] = useState<boolean>()
  useEffect(() => {
    if (focusedAdvanced) setAdvancedOpen(true)
  }, [focusedAdvanced, focusKey])
  const advancedShown = advancedOpen ?? (focusedAdvanced || advanced.some(isModified))
  const rows = (fields: readonly SettingField[]): ReactNode =>
    fields.map((field, index) => {
      const outcome = outcomes.get(field.path.join('.'))
      const edit = outcome?.status === 'saving' ? outcome.edit : undefined
      const group = field.groups.join(' › ')
      const previous = fields[index - 1]?.groups.join(' › ')
      return (
        <Fragment key={field.path.join('.')}>
          {group !== '' && group !== previous && <h4 className="dshx:m-0 dshx:mt-5 dshx:text-sm dshx:font-semibold dshx:text-foreground">{group}</h4>}
          <SettingRow
            disabled={disabled}
            field={field}
            focused={focusKey === field.path.join('.')}
            highlight={props.highlight}
            modified={isModified(field)}
            provenance={SettingProvenanceModel.of({ field, value: values, base, user })}
            refused={outcome?.status === 'refused'}
            reset={reset}
            saving={outcome?.status === 'saving'}
            t={props.t}
            value={displayedValue({ edit, field, values, base })}
            write={write}
          />
        </Fragment>
      )
    })
  const advancedLabel = advanced.length > 0 ? props.t('form.advanced', { count: advanced.length }) : props.t('form.advancedPlain')
  const advancedFold =
    advanced.length > 0 || props.advancedExtra !== undefined ? (
      <Collapsible className="dshx:flex dshx:flex-col" onOpenChange={setAdvancedOpen} open={advancedShown}>
        <CollapsibleTrigger asChild>
          <Button
            aria-label={props.advancedOf === undefined ? undefined : props.t('form.advancedOf', { page: props.advancedOf })}
            className="dshx:-ml-2 dshx:mt-1 dshx:self-start dshx:text-muted-foreground"
            data-settings-advanced=""
            size="sm"
            type="button"
            variant="ghost"
          >
            <ChevronRightIcon className={cn('dshx:transition-transform', advancedShown && 'dshx:rotate-90')} />
            {advancedLabel}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="dshx:flex dshx:flex-col">
          {rows(advanced)}
          {props.advancedExtra}
        </CollapsibleContent>
      </Collapsible>
    ) : null
  if (values === undefined)
    return (
      <div className="dshx:flex dshx:flex-col" data-settings-namespace={props.namespace}>
        {advancedFold}
      </div>
    )
  return (
    <TooltipProvider delayDuration={KEY_TOOLTIP_DELAY_MS}>
      <div className="dshx:flex dshx:flex-col" data-settings-namespace={props.namespace}>
        {snapshot.status === 'unavailable' && <p className="dshx:py-2 dshx:text-sm dshx:text-muted-foreground">{props.t('form.unavailable')}</p>}
        {snapshot.status === 'ready' && !snapshot.writable && <p className="dshx:py-2 dshx:text-sm dshx:text-muted-foreground">{props.t('form.readOnly')}</p>}
        {rows(everyday)}
        {advancedFold}
      </div>
    </TooltipProvider>
  )
}
