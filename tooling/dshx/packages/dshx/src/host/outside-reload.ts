import { AsyncLocalStorage } from 'node:async_hooks'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import type { Context } from '@deepseek-ai/cordis'

/**
 * DSH's HMR service marks the async context of every reload, plugin activation included, so that a nested
 * `runExclusive` fails fast. A timer armed during `setup` inherits that mark for its whole life: every settings
 * write or profile edit it starts later is refused with "HMR transactions cannot be nested". DSH 0.2.1 has no
 * public way out, so this reads the service's marker store, the one it leaves itself for its own config watchers.
 * Forced by @dshfiles/thread-sidebar's Host auto-settle scan; see plans/dsh-host-gaps.md.
 */
const hmrMarkerSchema = Schema.Struct({ executing: Schema.instanceOf(AsyncLocalStorage) })

/** Run `operation` outside any HMR reload transaction, so a timer armed in `setup` can write settings later. */
const runOutsideReload = <T>(ctx: Context, operation: () => T): T => {
  const parsed = Schema.decodeUnknownOption(hmrMarkerSchema)(ctx.get('hmr'))
  return Option.isSome(parsed) ? parsed.value.executing.exit(operation) : operation()
}

/** `setTimeout` whose callback runs outside the reload transaction that was active when it was armed. */
const scheduleOutsideReload = (ctx: Context, run: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(() => runOutsideReload(ctx, run), delayMs)
  timer.unref()
  return () => clearTimeout(timer)
}

export class ReloadTransactionModel {
  static readonly runOutside = runOutsideReload
  static readonly schedule = scheduleOutsideReload
}
