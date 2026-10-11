import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { z } from 'zod'
import { objectRecord, settingsChoiceOptions, type SettingsOption, type SettingsSearchTarget } from './settings-index.js'

export type SettingsJsonValue = Extract<SettingsPathOpView, { readonly op: 'set' }>['value']
export type SettingsEditorKind = 'string' | 'number' | 'boolean' | 'choice' | 'json'

export const setOperationForSettingsTarget = (target: SettingsSearchTarget, value: SettingsJsonValue): readonly SettingsPathOpView[] => [
  { op: 'set', path: [...target.fieldPath], value },
]

export const unsetOperationForSettingsTarget = (target: SettingsSearchTarget): readonly SettingsPathOpView[] => [{ op: 'unset', path: [...target.fieldPath] }]

const jsonValueSchema: z.ZodType<SettingsJsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
)

/**
 * Resolve one node of a serialized schemastery schema by field path.
 *
 * `settings.describe` sends `schema.toJSON()`: a `refs` table keyed by uid where
 * `uid` is the root and an object node's `dict` maps field name to a uid. So each
 * step resolves the current node, reads that field's uid from `dict`, and
 * resolves the uid out of the same table.
 */
export const schemaNodeAtPath = (schema: unknown, path: readonly string[]): Record<string, unknown> | null => {
  const envelope = objectRecord(schema)
  if (envelope === null) return null
  const refs = objectRecord(envelope.refs)
  if (refs === null || !Number.isInteger(envelope.uid)) return null
  const resolve = (reference: unknown): Record<string, unknown> | null => {
    const object = objectRecord(reference)
    if (object !== null) return object
    if (typeof reference !== 'number' || !Number.isInteger(reference)) return null
    return objectRecord(refs[String(reference)])
  }
  let current = resolve(envelope.uid)
  for (const segment of path) {
    if (current === null) return null
    const fields = objectRecord(current.dict)
    if (fields === null || !Object.hasOwn(fields, segment)) return null
    current = resolve(fields[segment])
  }
  return current
}

export const readSettingsPath = (value: unknown, path: readonly string[]): unknown => {
  let current = value
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
      continue
    }
    const record = objectRecord(current)
    if (record === null || !Object.hasOwn(record, segment)) return undefined
    current = record[segment]
  }
  return current
}

export const hasSettingsPath = (value: unknown, path: readonly string[]): boolean => {
  if (path.length === 0) return false
  let current = value
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return false
      current = current[index]
      continue
    }
    const record = objectRecord(current)
    if (record === null || !Object.hasOwn(record, segment)) return false
    current = record[segment]
  }
  return true
}

export const settingsEditorKind = (
  schema: Record<string, unknown> | null,
  current: unknown,
  choices: readonly SettingsOption[] = settingsChoiceOptions(schema),
): SettingsEditorKind => {
  if (choices.length > 0) return 'choice'
  const schemaType = schema?.type
  if (schemaType === 'string') return 'string'
  if (schemaType === 'number' || schemaType === 'integer') return 'number'
  if (schemaType === 'boolean') return 'boolean'
  if (typeof current === 'string') return 'string'
  if (typeof current === 'number') return 'number'
  if (typeof current === 'boolean') return 'boolean'
  return 'json'
}

export const formatSettingsDraft = (value: unknown, kind: SettingsEditorKind, choices: readonly SettingsOption[] = []): string => {
  if (value === undefined) return ''
  if (kind === 'choice') {
    const index = choices.findIndex(option => Object.is(option.value, value))
    return index >= 0 ? String(index) : ''
  }
  if (kind === 'string' && typeof value === 'string') return value
  if (kind === 'number' && typeof value === 'number') return String(value)
  if (kind === 'boolean' && typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return ''
  }
}

export type SettingsDraftErrorKey = 'draftChooseOption' | 'draftChooseBoolean' | 'draftFiniteNumber' | 'draftValidJson' | 'draftJsonValue'

export type SettingsDraftParseResult =
  | { readonly ok: true; readonly value: SettingsJsonValue }
  | { readonly ok: false; readonly messageKey: SettingsDraftErrorKey }

export const parseSettingsDraft = (draft: string, kind: SettingsEditorKind, choices: readonly SettingsOption[] = []): SettingsDraftParseResult => {
  if (kind === 'string') return { ok: true, value: draft }
  if (kind === 'choice') {
    const index = z.number().int().nonnegative().safeParse(Number(draft))
    if (!index.success || draft.trim().length === 0) return { ok: false, messageKey: 'draftChooseOption' }
    const option = choices[index.data]
    return option === undefined ? { ok: false, messageKey: 'draftChooseOption' } : { ok: true, value: option.value }
  }
  if (kind === 'boolean') {
    if (draft === 'true') return { ok: true, value: true }
    if (draft === 'false') return { ok: true, value: false }
    return { ok: false, messageKey: 'draftChooseBoolean' }
  }
  if (kind === 'number') {
    if (draft.trim().length === 0) return { ok: false, messageKey: 'draftFiniteNumber' }
    const result = z.number().finite().safeParse(Number(draft))
    return result.success ? { ok: true, value: result.data } : { ok: false, messageKey: 'draftFiniteNumber' }
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(draft)
  } catch {
    return { ok: false, messageKey: 'draftValidJson' }
  }
  const result = jsonValueSchema.safeParse(decoded)
  return result.success ? { ok: true, value: result.data } : { ok: false, messageKey: 'draftJsonValue' }
}
