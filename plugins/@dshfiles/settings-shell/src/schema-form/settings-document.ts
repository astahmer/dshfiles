import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import { decodeJson } from '@dshfiles/dshx/json'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { SettingProvenanceModel } from './setting-provenance.js'
import { jsonValueSchema, SettingsSchemaModel, type JsonValue, type ScalarControl, type SettingControl, type SettingField } from './schema-model.js'

/**
 * One namespace's user layer as an editable JSON document. The document is a view over the overrides the Host stores in
 * the profile patch: only paths the schema shows as fields can be written, saving turns the edit into path operations
 * against those fields (so redacted secrets and fields the view does not draw are never restated or dropped), and the
 * defaults and effective documents are read-only projections that are never written back.
 */

export type DiagnosticCode = 'parse' | 'not-object' | 'unknown-key' | 'type'

export interface DocumentDiagnostic {
  readonly code: DiagnosticCode
  /** The field path a key or type diagnostic is about; empty for document-level ones. */
  readonly path: readonly string[]
  /** One-based line the diagnostic points at, when the text locates it. */
  readonly line: number | undefined
  /** What the value should be, for a type diagnostic ("true or false", "one of …"). */
  readonly expected?: string
  /** The parser's message, for a parse diagnostic. */
  readonly detail?: string
}

export type ParsedDocument =
  | { readonly ok: true; readonly value: { readonly [key: string]: JsonValue }; readonly diagnostics: readonly DocumentDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly DocumentDiagnostic[] }

const recordSchema = Schema.Record(Schema.String, jsonValueSchema)
const asRecord = (value: JsonValue | undefined): { readonly [key: string]: JsonValue } | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(recordSchema)(value))

type MutableJson = string | number | boolean | null | MutableJson[] | { [key: string]: MutableJson }
const mutable = (value: JsonValue): MutableJson => {
  if (Array.isArray(value)) return value.map(item => mutable(item))
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mutable(item)]))
  return value
}

const expectedOf = (control: ScalarControl): string => {
  switch (control.kind) {
    case 'boolean':
      return 'true or false'
    case 'choice':
      return `one of ${control.options.map(option => JSON.stringify(option.value)).join(', ')}`
    case 'number': {
      const bounds = [control.min === undefined ? undefined : `≥ ${String(control.min)}`, control.max === undefined ? undefined : `≤ ${String(control.max)}`]
      const range = bounds.filter(bound => bound !== undefined).join(' and ')
      return range === '' ? 'a number' : `a number ${range}`
    }
    case 'text':
      return 'a string'
  }
}

const scalarFits = (control: ScalarControl, value: JsonValue): boolean => {
  switch (control.kind) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'choice':
      return control.options.some(option => option.value === value)
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (control.min === undefined || value >= control.min) &&
        (control.max === undefined || value <= control.max)
      )
    case 'text':
      return typeof value === 'string'
  }
}

/** Undefined when the value fits the field's control, else what it should be. */
const mismatch = (control: SettingControl, value: JsonValue): string | undefined => {
  if (control.kind === 'json') return undefined
  if (control.kind === 'list') {
    if (!Array.isArray(value)) return `a list of ${expectedOf(control.item)} values`
    return value.every(item => scalarFits(control.item, item)) ? undefined : `a list of ${expectedOf(control.item)} values`
  }
  if (control.kind === 'record') {
    const record = asRecord(value)
    if (record === undefined || Array.isArray(value)) return `an object of ${expectedOf(control.value)} values`
    return Object.values(record).every(item => scalarFits(control.value, item)) ? undefined : `an object of ${expectedOf(control.value)} values`
  }
  return scalarFits(control, value) ? undefined : expectedOf(control)
}

/** The line holding `"key":` at the given nesting, searched after the line of its parent. */
const lineOfPath = (lines: readonly string[], path: readonly string[]): number | undefined => {
  let from = 0
  for (const key of path) {
    const pattern = `${JSON.stringify(key)}`
    const index = lines.findIndex((line, at) => at >= from && new RegExp(`${pattern.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*:`, 'u').test(line))
    if (index === -1) return undefined
    from = index
  }
  return from + 1
}

/** The one-based line of a parse error, read from the position V8 and SpiderMonkey put in their messages. */
const parseErrorLine = (text: string, message: string): number | undefined => {
  const line = /line (\d+)/u.exec(message)
  if (line?.[1] !== undefined) return Number(line[1])
  const position = /position (\d+)/u.exec(message)
  if (position?.[1] === undefined) return undefined
  return text.slice(0, Number(position[1])).split('\n').length
}

const isFieldPath = (fields: readonly SettingField[], path: readonly string[]): SettingField | undefined =>
  fields.find(field => field.path.length === path.length && field.path.every((segment, index) => segment === path[index]))

const isGroupPath = (fields: readonly SettingField[], path: readonly string[]): boolean =>
  fields.some(field => field.path.length > path.length && path.every((segment, index) => field.path[index] === segment))

/** Every key of the document that is neither a field nor an object holding fields, and every field value that does not fit. */
const check = (input: {
  readonly value: { readonly [key: string]: JsonValue }
  readonly fields: readonly SettingField[]
  readonly lines: readonly string[]
}): readonly DocumentDiagnostic[] => {
  const diagnostics: DocumentDiagnostic[] = []
  const walk = (node: { readonly [key: string]: JsonValue }, prefix: readonly string[]): void => {
    for (const [key, child] of Object.entries(node)) {
      const path = [...prefix, key]
      const field = isFieldPath(input.fields, path)
      if (field !== undefined) {
        const expected = mismatch(field.control, child)
        if (expected !== undefined) diagnostics.push({ code: 'type', path, line: lineOfPath(input.lines, path), expected })
        continue
      }
      const nested = asRecord(child)
      if (isGroupPath(input.fields, path) && nested !== undefined && !Array.isArray(child)) {
        walk(nested, path)
        continue
      }
      diagnostics.push({ code: 'unknown-key', path, line: lineOfPath(input.lines, path) })
    }
  }
  walk(input.value, [])
  return diagnostics
}

const parseDocument = (input: { readonly text: string; readonly fields: readonly SettingField[] }): ParsedDocument => {
  const text = input.text.trim() === '' ? '{}' : input.text
  let json: JsonValue
  try {
    json = decodeJson(jsonValueSchema, text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, diagnostics: [{ code: 'parse', path: [], line: parseErrorLine(text, detail), detail }] }
  }
  const value = asRecord(json)
  if (value === undefined || Array.isArray(json)) return { ok: false, diagnostics: [{ code: 'not-object', path: [], line: 1 }] }
  return { ok: true, value, diagnostics: check({ value, fields: input.fields, lines: text.split('\n') }) }
}

/**
 * Path operations turning the overrides the draft started from into the edited ones, one per field that changed: set
 * where the draft adds or changes a field, unset where it removes one. Fields absent from both stay untouched.
 */
const operations = (input: {
  readonly fields: readonly SettingField[]
  readonly before: JsonValue | undefined
  readonly after: JsonValue
}): readonly SettingsPathOpView[] =>
  input.fields.flatMap((field): SettingsPathOpView[] => {
    const had = SettingsSchemaModel.hasValueAt(input.before, field.path)
    const has = SettingsSchemaModel.hasValueAt(input.after, field.path)
    const next = SettingsSchemaModel.valueAt(input.after, field.path)
    if (has && next !== undefined) {
      if (had && SettingProvenanceModel.jsonEqual(SettingsSchemaModel.valueAt(input.before, field.path), next)) return []
      return [{ op: 'set', path: [...field.path], value: mutable(next) }]
    }
    return had ? [{ op: 'unset', path: [...field.path] }] : []
  })

const setAt = (target: { [key: string]: MutableJson }, path: readonly string[], value: MutableJson): void => {
  const [head, ...rest] = path
  if (head === undefined) return
  if (rest.length === 0) {
    target[head] = value
    return
  }
  const existing = target[head]
  const child: { [key: string]: MutableJson } = typeof existing === 'object' && existing !== null && !Array.isArray(existing) ? existing : {}
  target[head] = child
  setAt(child, rest, value)
}

/** The value every field would have without an override, nested as the schema nests it. Read-only: never saved. */
const inheritedDocument = (input: { readonly fields: readonly SettingField[]; readonly base: JsonValue | undefined }): JsonValue => {
  const document: { [key: string]: MutableJson } = {}
  for (const field of input.fields) {
    const inherited = SettingsSchemaModel.hasValueAt(input.base, field.path) ? SettingsSchemaModel.valueAt(input.base, field.path) : field.defaultValue
    if (inherited !== undefined) setAt(document, field.path, mutable(inherited))
  }
  return document
}

/** The draft with one more field set, or undefined when the draft does not parse into an object. */
const withField = (input: { readonly text: string; readonly field: SettingField; readonly value: JsonValue }): string | undefined => {
  const text = input.text.trim() === '' ? '{}' : input.text
  let parsed: JsonValue
  try {
    parsed = decodeJson(jsonValueSchema, text)
  } catch {
    return undefined
  }
  const record = asRecord(parsed)
  if (record === undefined || Array.isArray(parsed)) return undefined
  const next = mutable(record)
  if (typeof next !== 'object' || next === null || Array.isArray(next)) return undefined
  setAt(next, input.field.path, mutable(input.value))
  return `${JSON.stringify(next, null, 2)}\n`
}

/** The value an inserted field starts with when neither the composition nor the schema gives one. */
const placeholderFor = (field: SettingField): JsonValue => {
  switch (field.control.kind) {
    case 'list':
      return []
    case 'record':
      return {}
    case 'json':
      return null
    default:
      return SettingsSchemaModel.blankValue(field.control)
  }
}

const format = (value: JsonValue | undefined): string => `${JSON.stringify(value ?? {}, null, 2)}\n`

export class SettingsDocument {
  static readonly parse = parseDocument
  static readonly operations = operations
  static readonly inheritedDocument = inheritedDocument
  static readonly withField = withField
  static readonly format = format
  static readonly placeholderFor = placeholderFor
}
