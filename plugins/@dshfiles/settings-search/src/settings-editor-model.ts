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

export const schemaNodeAtPath = (schema: unknown, path: readonly string[]): Record<string, unknown> | null => {
  let current: unknown = schema
  for (const segment of path) {
    const record = objectRecord(current)
    if (record === null) return null
    const fields = objectRecord(record.fields) ?? objectRecord(record.properties)
    if (fields === null || !Object.hasOwn(fields, segment)) return null
    current = fields[segment]
  }
  return objectRecord(current)
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

export type SettingsDraftParseResult = { readonly ok: true; readonly value: SettingsJsonValue } | { readonly ok: false; readonly message: string }

export const parseSettingsDraft = (draft: string, kind: SettingsEditorKind, choices: readonly SettingsOption[] = []): SettingsDraftParseResult => {
  if (kind === 'string') return { ok: true, value: draft }
  if (kind === 'choice') {
    const index = z.number().int().nonnegative().safeParse(Number(draft))
    if (!index.success || draft.trim().length === 0) return { ok: false, message: 'Choose one of the available options.' }
    const option = choices[index.data]
    return option === undefined ? { ok: false, message: 'Choose one of the available options.' } : { ok: true, value: option.value }
  }
  if (kind === 'boolean') {
    if (draft === 'true') return { ok: true, value: true }
    if (draft === 'false') return { ok: true, value: false }
    return { ok: false, message: 'Choose true or false.' }
  }
  if (kind === 'number') {
    if (draft.trim().length === 0) return { ok: false, message: 'Enter a finite number.' }
    const result = z.number().finite().safeParse(Number(draft))
    return result.success ? { ok: true, value: result.data } : { ok: false, message: 'Enter a finite number.' }
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(draft)
  } catch {
    return { ok: false, message: 'Enter valid JSON.' }
  }
  const result = jsonValueSchema.safeParse(decoded)
  return result.success ? { ok: true, value: result.data } : { ok: false, message: 'Enter a JSON value.' }
}
