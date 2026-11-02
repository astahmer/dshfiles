import type {} from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-working-directory'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { Api, HostContext, type Tool } from '@dshfiles/dshx/effect'
import { previewRenderApi } from '@dshfiles/preview/render-api'
import { Context, Effect, Layer, Schema } from 'effect'

type Agent = NonNullable<Tool.ToolCall['agent']>

const operations = ['resolve the working directory of', 'resolve', 'stat', 'read', 'store the screenshot of'] as const

/** A Host filesystem or attachment call failed; a coded Host error in `cause` reaches the agent unchanged. */
export class HtmlHostFailed extends Schema.TaggedError<HtmlHostFailed>()(
  'HtmlHostFailed',
  { operation: Schema.Literals(operations), path: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'html-render-host-failed' },
) {
  override get message(): string {
    return `Could not ${this.operation} ${this.path}.`
  }
}

const previewApi = (input: { readonly ctx: Parameters<typeof createHostApiClient>[0]; readonly packageId: string }) =>
  Api.client({ contract: previewRenderApi, api: createHostApiClient(input.ctx, previewRenderApi, input.packageId) })

/** The Host filesystem, attachment store and preview renderer the html tools read, from the plugin's own context. */
export class HtmlHost extends Context.Service<
  HtmlHost,
  {
    readonly workingDirectory: (agent: Agent) => Effect.Effect<string, HtmlHostFailed>
    readonly resolve: (input: { readonly path: string; readonly cwd?: string | undefined }) => Effect.Effect<FsTarget, HtmlHostFailed>
    readonly contains: (input: { readonly root: FsTarget; readonly target: FsTarget }) => boolean
    readonly stat: (target: FsTarget) => Effect.Effect<FsInfo | undefined, HtmlHostFailed>
    readonly readBytes: (input: { readonly target: FsTarget; readonly maxBytes: number }) => Effect.Effect<Uint8Array, HtmlHostFailed>
    readonly processPath: (target: FsTarget) => string
    readonly saveImage: (input: {
      readonly data: Uint8Array
      readonly mediaType: ImageMediaType
      readonly name: string
    }) => Effect.Effect<ImageAttachmentRef | undefined, HtmlHostFailed>
    readonly preview: ReturnType<typeof previewApi>
  }
>()('@dshfiles/html-render/HtmlHost') {
  static readonly layer = Layer.effect(
    HtmlHost,
    Effect.gen(function* () {
      const host = yield* HostContext
      const ctx = host.ctx
      const failed = (operation: (typeof operations)[number], path: string) => (cause: unknown) => new HtmlHostFailed({ operation, path, cause })
      return HtmlHost.of({
        workingDirectory: agent =>
          Effect.tryPromise({ try: signal => ctx.workingDirectory.ensure(agent, signal), catch: failed('resolve the working directory of', agent.id) }),
        resolve: input =>
          Effect.tryPromise({
            try: signal => ctx.fs.resolve(input.path, input.cwd === undefined ? { signal } : { cwd: input.cwd, signal }),
            catch: failed('resolve', input.path),
          }),
        contains: input => ctx.fs.contains(input.root, input.target),
        stat: target => Effect.tryPromise({ try: signal => ctx.fs.stat(target, signal), catch: failed('stat', target.displayPath) }),
        readBytes: input =>
          Effect.tryPromise({ try: signal => ctx.fs.readBytes(input.target, signal, input.maxBytes), catch: failed('read', input.target.displayPath) }),
        processPath: target => ctx.fs.processPath(target),
        saveImage: input =>
          Effect.tryPromise({
            try: () => ctx.attachments.saveImages([{ data: Buffer.from(input.data), mediaType: input.mediaType, name: input.name }]),
            catch: failed('store the screenshot of', input.name),
          }).pipe(Effect.map(images => images[0])),
        preview: previewApi({ ctx, packageId: host.packageId }),
      })
    }),
  )
}
