import { z } from 'zod'

/**
 * A plugin's settings, read from the serialized schemastery schema `settings.describe` sends (`schema.toJSON()`: a
 * `refs` table keyed by uid, `uid` naming the root; an object's `dict`, a union's `list` and an array's or dict's
 * `inner` hold uids). The model is what a form needs: one field per visible setting with a title, a description and
 * the control its type calls for, grouped by the nested objects that contain it.
 */

type JsonPrimitive = string | number | boolean | null

/** Settings values cross the wire as JSON; everything here reads them through this one type. */
export const jsonValueSchema = z.json()
export type JsonValue = z.infer<typeof jsonValueSchema>

export interface ChoiceOption {
  readonly value: JsonPrimitive
  readonly label: string
  /** The rest of a "Label: explanation" description, shown beside the label in a select. */
  readonly detail: string
}

const MAX_CHOICE_LABEL = 28

/** Splits "Preview: what you open replaces …" into a short label and its explanation. */
interface ChoiceText {
  readonly label: string
  readonly detail: string
}

const choiceText = (description: string, value: JsonPrimitive): ChoiceText => {
  const separator = description.indexOf(': ')
  if (separator > 0 && separator <= MAX_CHOICE_LABEL) return { label: description.slice(0, separator), detail: description.slice(separator + 2) }
  if (description !== '' && description.length <= MAX_CHOICE_LABEL) return { label: description, detail: '' }
  return { label: String(value), detail: description }
}

/** Controls a list item or a record value can use: one value per row. */
export interface NumberControl {
  readonly kind: 'number'
  /** A 0–1 fraction shown and edited as a percentage. */
  readonly percent: boolean
  min?: number
  max?: number
  step?: number
  unit?: string
}

export type ScalarControl =
  | { readonly kind: 'boolean' }
  | { readonly kind: 'choice'; readonly options: readonly ChoiceOption[] }
  | NumberControl
  | { readonly kind: 'text'; readonly multiline: boolean }

export type SettingControl =
  | ScalarControl
  | { readonly kind: 'list'; readonly item: ScalarControl }
  | { readonly kind: 'record'; readonly value: ScalarControl }
  | { readonly kind: 'json' }

export interface SettingField {
  readonly key: string
  /** Path from the namespace root; what `set`/`unset` operations address. */
  readonly path: readonly string[]
  readonly title: string
  readonly description: string
  readonly control: SettingControl
  /** Titles of the nested objects containing the field, outermost first. */
  readonly groups: readonly string[]
  /** The schema default, when it declares one. */
  readonly defaultValue: JsonValue | undefined
}

/** Picks the reader's language out of a schemastery description (a string, or `{ en, zh, … }`). */
export type LocalizedTextReader = (value: JsonValue | undefined) => string

const MAX_DEPTH = 4
const MAX_SEGMENTED_OPTIONS = 4
const MAX_SEGMENTED_LABEL = 18

const metaSchema = z.record(z.string(), jsonValueSchema).catch({})
const referenceSchema = z.union([z.number().int(), z.record(z.string(), jsonValueSchema)])
const nodeSchema = z.object({
  type: z.string(),
  meta: metaSchema.default({}),
  dict: z.record(z.string(), referenceSchema).optional(),
  list: z.array(referenceSchema).optional(),
  inner: referenceSchema.optional(),
  value: jsonValueSchema.optional(),
})
type SchemaNode = z.infer<typeof nodeSchema>
const envelopeSchema = z.object({ uid: z.number().int(), refs: z.record(z.string(), jsonValueSchema) })
const primitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const numberMeta = z.object({ min: z.number().optional(), max: z.number().optional(), step: z.number().optional() })

interface Walk {
  readonly refs: Readonly<Record<string, JsonValue>>
  readonly text: LocalizedTextReader
  readonly secrets: readonly (readonly string[])[]
}

const uidSchema = z.number().int()

const resolve = (walk: Walk, reference: JsonValue | undefined): SchemaNode | undefined => {
  const uid = uidSchema.safeParse(reference)
  const node = nodeSchema.safeParse(uid.success ? walk.refs[String(uid.data)] : reference)
  return node.success ? node.data : undefined
}

/** `maxTabs` → "Max tabs", `archive-undo` → "Archive undo". */
export const humanizeKey = (key: string): string => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const UNIT_SUFFIXES: readonly (readonly [RegExp, string])[] = [
  [/Ms$/, 'ms'],
  [/(Seconds|Secs|Sec)$/, 's'],
  [/(Minutes|Mins)$/, 'min'],
  [/Hours$/, 'h'],
  [/Days$/, 'days'],
  [/Px$/, 'px'],
  [/(Bytes)$/, 'bytes'],
  [/(Kb|KB)$/, 'KB'],
  [/(Mb|MB)$/, 'MB'],
  [/(Percent|Pct)$/, '%'],
]

/** The unit a numeric key spells out (`idleMinutes` → "min"), or undefined. */
export const unitOfKey = (key: string): string | undefined => UNIT_SUFFIXES.find(([pattern]) => pattern.test(key))?.[1]

const choiceOptions = (walk: Walk, node: SchemaNode): readonly ChoiceOption[] | undefined => {
  if (node.type === 'const') {
    const value = primitiveSchema.safeParse(node.value)
    return value.success ? [{ value: value.data, ...choiceText(walk.text(node.meta.description), value.data) }] : undefined
  }
  if (node.type !== 'union' || node.list === undefined || node.list.length === 0) return undefined
  const options: ChoiceOption[] = []
  for (const reference of node.list) {
    const branch = resolve(walk, reference)
    const branchOptions = branch === undefined ? undefined : choiceOptions(walk, branch)
    if (branchOptions === undefined) return undefined
    options.push(...branchOptions)
  }
  return options
}

const scalarControl = (walk: Walk, node: SchemaNode, key: string): ScalarControl | undefined => {
  if (node.type === 'boolean') return { kind: 'boolean' }
  if (node.type === 'string') return { kind: 'text', multiline: node.meta.role === 'textarea' }
  if (node.type === 'number' || node.type === 'natural' || node.type === 'percent') {
    const bounds = numberMeta.catch({}).parse(node.meta)
    const percent = node.type === 'percent' || (node.meta.role === 'slider' && bounds.min === 0 && bounds.max === 1)
    const unit = percent ? '%' : unitOfKey(key)
    const control: NumberControl = { kind: 'number', percent }
    if (bounds.min !== undefined) control.min = bounds.min
    if (bounds.max !== undefined) control.max = bounds.max
    if (bounds.step !== undefined) control.step = bounds.step
    if (unit !== undefined) control.unit = unit
    return control
  }
  const options = choiceOptions(walk, node)
  return options === undefined ? undefined : { kind: 'choice', options }
}

const controlOf = (walk: Walk, node: SchemaNode, key: string): SettingControl => {
  const scalar = scalarControl(walk, node, key)
  if (scalar !== undefined) return scalar
  if (node.type === 'array' || node.type === 'dict') {
    const inner = node.inner === undefined ? undefined : resolve(walk, node.inner)
    const item = inner === undefined ? undefined : scalarControl(walk, inner, key)
    if (item !== undefined && !(item.kind === 'text' && item.multiline)) return node.type === 'array' ? { kind: 'list', item } : { kind: 'record', value: item }
  }
  return { kind: 'json' }
}

const isSecret = (walk: Walk, path: readonly string[]): boolean =>
  walk.secrets.some(secret => {
    const shared = Math.min(secret.length, path.length)
    return shared > 0 && secret.slice(0, shared).every((segment, index) => path[index] === segment)
  })

const collect = (walk: Walk, node: SchemaNode, path: readonly string[], groups: readonly string[], depth: number): SettingField[] => {
  if (depth > MAX_DEPTH || node.dict === undefined) return []
  return Object.entries(node.dict).flatMap(([key, reference]) => {
    const child = resolve(walk, reference)
    const fieldPath = [...path, key]
    if (child === undefined || child.meta.hidden === true || child.meta.role === 'secret' || isSecret(walk, fieldPath)) return []
    const title = walk.text(child.meta.label) || walk.text(child.meta.title) || humanizeKey(key)
    if (child.type === 'object' && child.dict !== undefined) return collect(walk, child, fieldPath, [...groups, title], depth + 1)
    return [
      {
        key,
        path: fieldPath,
        title,
        description: walk.text(child.meta.description),
        control: controlOf(walk, child, key),
        groups,
        defaultValue: child.meta.default,
      },
    ]
  })
}

/** Every visible, non-secret setting of one namespace schema, in schema order; empty when the schema is unreadable. */
export const settingFields = (input: {
  readonly schema: JsonValue
  readonly secrets?: readonly { readonly path: readonly string[] }[]
  readonly text: LocalizedTextReader
}): readonly SettingField[] => {
  const envelope = envelopeSchema.safeParse(input.schema)
  if (!envelope.success) return []
  const walk: Walk = { refs: envelope.data.refs, text: input.text, secrets: (input.secrets ?? []).map(secret => secret.path) }
  const root = resolve(walk, envelope.data.uid)
  return root === undefined ? [] : collect(walk, root, [], [], 0)
}

interface NamespaceText {
  readonly title: string
  readonly description: string
}

/** The namespace's own title and description, from its root node; empty strings when it declares none. */
export const namespaceText = (input: { readonly schema: JsonValue; readonly text: LocalizedTextReader }): NamespaceText => {
  const envelope = envelopeSchema.safeParse(input.schema)
  if (!envelope.success) return { title: '', description: '' }
  const root = resolve({ refs: envelope.data.refs, text: input.text, secrets: [] }, envelope.data.uid)
  return { title: input.text(root?.meta.label) || input.text(root?.meta.title), description: input.text(root?.meta.description) }
}

/** Segmented buttons for a few short choices, a select otherwise. */
export const choiceDisplay = (options: readonly ChoiceOption[]): 'segmented' | 'select' =>
  options.length <= MAX_SEGMENTED_OPTIONS && options.every(option => option.label.length <= MAX_SEGMENTED_LABEL) ? 'segmented' : 'select'

const recordValueSchema = z.record(z.string(), jsonValueSchema)
const indexSchema = z.coerce.number().int().nonnegative()

interface Step {
  readonly found: boolean
  readonly value: JsonValue | undefined
}

const step = (value: JsonValue | undefined, segment: string): Step => {
  if (Array.isArray(value)) {
    const index = indexSchema.safeParse(segment)
    return index.success && index.data < value.length ? { found: true, value: value[index.data] } : { found: false, value: undefined }
  }
  const record = recordValueSchema.safeParse(value)
  return record.success && Object.hasOwn(record.data, segment) ? { found: true, value: record.data[segment] } : { found: false, value: undefined }
}

/** The value at a settings path, or undefined when any segment is missing. */
export const valueAt = (value: JsonValue | undefined, path: readonly string[]): JsonValue | undefined =>
  path.reduce<JsonValue | undefined>((current, segment) => step(current, segment).value, value)

/** Whether the path exists, independently of its value: an override that equals the default is still an override. */
export const hasValueAt = (value: JsonValue | undefined, path: readonly string[]): boolean => {
  let current = value
  for (const segment of path) {
    const next = step(current, segment)
    if (!next.found) return false
    current = next.value
  }
  return path.length > 0
}

/** A JSON draft typed in the fallback editor, or undefined when it does not parse into a JSON value. */
export const parseJsonDraft = (text: string): JsonValue | undefined => {
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch {
    return undefined
  }
  const value = jsonValueSchema.safeParse(decoded)
  return value.success ? value.data : undefined
}

/** The value a new list item or record entry starts with. */
export const blankValue = (control: ScalarControl): JsonValue => {
  switch (control.kind) {
    case 'boolean':
      return false
    case 'number':
      return control.min ?? 0
    case 'choice':
      return control.options[0]?.value ?? ''
    case 'text':
      return ''
  }
}
