/**
 * Reading the native event and node payloads this plugin consumes. The client receives them as `unknown`, so each
 * value is narrowed by a guard or read into a concrete value (or `undefined`) before any model code sees it.
 */

/** Any non-null object; its fields are then read with `'key' in value`, which keeps each one `unknown` until read. */
const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

/** Present, non-blank text, trimmed; anything else reads as absent. */
const readText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

/** A string as sent, blank included; anything else reads as absent. */
const readString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** A finite number; anything else reads as absent. */
const readNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

export const Wire = { isObject, readText, readString, readNumber }
