import type { LoggerService } from '@deepseek-ai/cordis'

export function redactText(value: string, secrets: readonly string[]): string {
  let result = value
  const variants = new Set<string>()
  for (const secret of secrets) {
    if (secret.length === 0) continue
    variants.add(secret)
    variants.add(encodeURIComponent(secret))
  }
  for (const secret of [...variants].sort((left, right) => right.length - left.length)) {
    result = result.replaceAll(secret, '[REDACTED]')
  }
  return result
}

function redactValue(value: unknown, secrets: readonly string[], seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === 'string') return redactText(value, secrets)
  if (typeof value !== 'object' || value === null) return value
  const previous = seen.get(value)
  if (previous !== undefined) return previous
  if (value instanceof Error) {
    const copy = new Error(redactText(value.message, secrets))
    copy.name = value.name
    if (value.stack !== undefined) copy.stack = redactText(value.stack, secrets)
    seen.set(value, copy)
    if ('cause' in value) copy.cause = redactValue(value.cause, secrets, seen)
    return copy
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = []
    seen.set(value, copy)
    for (const item of value) copy.push(redactValue(item, secrets, seen))
    return copy
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  if (prototype === Object.prototype || prototype === null) {
    const copy: Record<string, unknown> = Object.create(prototype) as Record<string, unknown>
    seen.set(value, copy)
    for (const [key, item] of Object.entries(value)) copy[key] = redactValue(item, secrets, seen)
    return copy
  }
  return value
}

/** Preserve the Host logger API while redacting resolved credential values. */
export function redactingLogger(logger: LoggerService, secrets: readonly string[]): LoggerService {
  const wrap = (target: Function): Function => new Proxy(target, {
    apply(original, thisArg, args: unknown[]) {
      const result = Reflect.apply(original, thisArg, args.map(value => redactValue(value, secrets)))
      return typeof result === 'function' ? wrap(result) : result
    },
    get(original, property, receiver) {
      const value = Reflect.get(original, property, receiver) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, original, args.map(item => redactValue(item, secrets)))
        return typeof result === 'function' ? wrap(result) : result
      }
    },
  })
  return wrap(logger) as LoggerService
}
