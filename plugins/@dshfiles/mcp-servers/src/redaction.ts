import type { Logger, LoggerMethod, LoggerService, LoggerType } from '@deepseek-ai/cordis'

export const redactText = (value: string, secrets: readonly string[]): string => {
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

const redactValue = (value: unknown, secrets: readonly string[], seen = new WeakMap<object, unknown>()): unknown => {
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

/**
 * Preserve the Host logger API while redacting resolved credential values. The returned service and the named
 * loggers it creates inherit everything from the originals and override only the call and the four log methods.
 */
export const redactingLogger = (logger: LoggerService, secrets: readonly string[]): LoggerService => {
  const redactingMethods = (source: Record<LoggerType, LoggerMethod>) => {
    const redact = (values: readonly unknown[]): unknown[] => values.map(value => redactValue(value, secrets))
    return {
      error: (format, ...params) => source.error(redactValue(format, secrets), ...redact(params)),
      info: (format, ...params) => source.info(redactValue(format, secrets), ...redact(params)),
      warn: (format, ...params) => source.warn(redactValue(format, secrets), ...redact(params)),
      debug: (format, ...params) => source.debug(redactValue(format, secrets), ...redact(params)),
    } satisfies Record<LoggerType, LoggerMethod>
  }
  const createNamedLogger = (name?: string): Logger => {
    const named = logger(name)
    return Object.assign(Object.create(named), redactingMethods(named))
  }
  return Object.setPrototypeOf(Object.assign(createNamedLogger, redactingMethods(logger)), logger)
}
