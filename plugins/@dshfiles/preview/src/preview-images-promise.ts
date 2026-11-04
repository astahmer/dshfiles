import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'
import { PreviewRefused } from './preview-errors.js'

/** The one attachment-store edge: a screenshot becomes an image the model and the UI can open. */
export class PreviewImages extends Context.Service<
  PreviewImages,
  {
    readonly save: (input: { readonly data: Uint8Array; readonly name: string }) => Effect.Effect<ImageAttachmentRef | undefined, PreviewRefused>
  }
>()('@dshfiles/preview/PreviewImages') {
  static readonly layer = Layer.effect(
    PreviewImages,
    Effect.gen(function* () {
      const host = yield* HostContext
      return PreviewImages.of({
        save: input =>
          Effect.gen(function* () {
            const attachments = host.ctx.get('attachments')
            if (attachments === undefined)
              return yield* new PreviewRefused({
                tool: 'preview_screenshot',
                recovery: 'The attachment store is not loaded, so the screenshot cannot be kept. Retry once the Host finishes loading.',
              })
            const saved = yield* Effect.tryPromise({
              try: () => attachments.saveImages([{ data: Buffer.from(input.data), mediaType: 'image/jpeg', name: input.name }]),
              catch: cause => new PreviewRefused({ tool: 'preview_screenshot', recovery: 'The attachment store rejected the screenshot.', cause }),
            })
            return saved[0]
          }),
      })
    }),
  )
}
