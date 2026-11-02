import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { FsInfo, FsObservation, FsTarget, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-working-directory'
import { HostContext, type Tool } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Schema } from 'effect'

type ToolCall = Tool.ToolCall
type Agent = NonNullable<ToolCall['agent']>
type SandboxPolicy = ReturnType<NonNullable<CordisContext['sandboxPolicy']>['resolve']>

const operations = ['resolve the working directory of', 'resolve', 'stat', 'read', 'write'] as const

/** A Host filesystem call failed; a coded Host error in `cause` (FS_SANDBOX_DENIED, …) reaches the agent unchanged. */
export class PatchFilesystemFailed extends Schema.TaggedError<PatchFilesystemFailed>()(
  'PatchFilesystemFailed',
  { operation: Schema.Literals(operations), path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'apply-patch-filesystem-failed' },
) {
  override get message(): string {
    return `apply_patch could not ${this.operation} "${this.path}".`
  }
}

/** The Host filesystem, Session and policy services apply_patch reads, as the plugin's own context injected them. */
export class PatchHost extends Context.Service<
  PatchHost,
  {
    readonly confinesWithoutPolicy: boolean
    readonly liveSession: (agent: Agent) => Agent['session'] | undefined
    readonly sandboxPolicy: (session: Agent['session'] | undefined) => SandboxPolicy | undefined
    readonly workingDirectory: (agent: Agent) => Effect.Effect<string, PatchFilesystemFailed>
    readonly resolve: (input: { readonly path: string; readonly cwd: string | undefined }) => Effect.Effect<FsTarget, PatchFilesystemFailed>
    readonly stat: (target: FsTarget) => Effect.Effect<FsInfo | undefined, PatchFilesystemFailed>
    readonly readText: (target: FsTarget) => Effect.Effect<string, PatchFilesystemFailed>
    readonly writeText: (input: {
      readonly target: FsTarget
      readonly content: string
      readonly policy: SandboxPolicy | undefined
    }) => Effect.Effect<FsWriteOutcome, PatchFilesystemFailed>
    readonly observed: (input: { readonly target: FsTarget; readonly observation: FsObservation; readonly call: ToolCall }) => Effect.Effect<void>
    readonly processPath: (target: FsTarget) => string
  }
>()('@dshfiles/apply-patch/PatchHost') {
  static readonly layer = Layer.effect(
    PatchHost,
    Effect.gen(function* () {
      const ctx = (yield* HostContext).ctx
      const fs = ctx.fs
      const policy = ctx.get('sandboxPolicy')
      const failed = (operation: (typeof operations)[number], path: string) => (cause: unknown) => new PatchFilesystemFailed({ operation, path, cause })
      return PatchHost.of({
        confinesWithoutPolicy: fs.sandboxMode !== undefined && policy === undefined,
        liveSession: agent => ctx.sessions.get(agent.id),
        sandboxPolicy: session => policy?.resolve(session === undefined ? {} : { session }),
        workingDirectory: agent =>
          Effect.tryPromise({ try: signal => ctx.workingDirectory.ensure(agent, signal), catch: failed('resolve the working directory of', agent.id) }),
        resolve: input =>
          Effect.tryPromise({
            try: signal => fs.resolve(input.path, input.cwd === undefined ? { signal } : { cwd: input.cwd, signal }),
            catch: failed('resolve', input.path),
          }),
        stat: target => Effect.tryPromise({ try: signal => fs.stat(target, signal), catch: failed('stat', target.displayPath) }),
        readText: target => Effect.tryPromise({ try: signal => fs.readText(target, signal), catch: failed('read', target.displayPath) }),
        writeText: input =>
          Effect.tryPromise({
            try: signal => fs.writeText(input.target, input.content, undefined, signal, input.policy),
            catch: failed('write', input.target.displayPath),
          }),
        observed: input => Effect.sync(() => ctx.emit('fs/observed', input.target, input.observation, input.call)),
        processPath: target => fs.processPath(target),
      })
    }),
  )
}
