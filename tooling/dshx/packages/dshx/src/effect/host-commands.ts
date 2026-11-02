export * as HostCommands from './host-commands.js'

import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { Cause, Effect, type Scope } from 'effect'
import { causeReport } from './cause-report.js'
import { HostContext, hostService, type HostServiceMissing } from './host-context.js'
import { callbackWithSignal } from './plugin.js'

/** A slash command whose handler is an Effect; every other field is the native `CommandDefinition`'s. */
export interface Command<R> extends Omit<CommandDefinition, 'handler'> {
  /** Runs in the plugin's services; the invocation's abort interrupts it. Answer user errors as `kind: 'error'`. */
  readonly handler: (invocation: CommandInvocation) => Effect.Effect<CommandResult, never, R>
}

/**
 * Register a slash command with the Host `commands` service for as long as the current Scope lives. A defect is
 * logged under `dshx:commands` and answered as `/<name> failed. See Host diagnostics.`; an aborted invocation
 * rejects with its abort reason, which the registry settles as aborted.
 */
export const register = <R>(command: Command<R>): Effect.Effect<void, HostServiceMissing, Scope.Scope | HostContext | R> =>
  Effect.gen(function* () {
    const host = yield* HostContext
    const commands = yield* hostService('commands')
    const { handler, ...definition } = command
    const failed: CommandResult = { kind: 'error', text: `/${command.name} failed. See Host diagnostics.` }
    const run = yield* callbackWithSignal((invocation: CommandInvocation) =>
      handler(invocation).pipe(
        Effect.catchCause(cause => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
          host.ctx.logger('dshx:commands').error(`/${command.name} failed:\n${causeReport(cause)}`)
          return Effect.succeed(failed)
        }),
      ),
    )
    yield* Effect.acquireRelease(
      Effect.sync(() => commands.register({ ...definition, handler: invocation => run({ signal: invocation.signal }, invocation) })),
      unregister => Effect.sync(unregister),
    )
  })
