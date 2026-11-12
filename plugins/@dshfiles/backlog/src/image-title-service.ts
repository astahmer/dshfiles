import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { Llm } from '@dshfiles/dshx/effect/llm'
import { Clock, Context, Effect, FiberMap, Layer, Option, Stream } from 'effect'
import { AiActivity } from './ai-activity.js'
import { BacklogSettingsTag } from './backlog-settings.js'
import type { BacklogWriteFailed } from './errors.js'
import { HostAttachments } from './host-edge-promise.js'
import { ImageTitleModel } from './image-title.js'
import { BacklogItems } from './item.js'
import { BacklogStore } from './store.js'

// dsh-session-title-llm declares the same purpose; an image title is a title side call, so recorders keep it out of thread requests.
declare module '@deepseek-ai/dsh-llm/types' {
  interface LlmRequestPurposeMap {
    'session-title': true
  }
}

/** Why one title-from-image attempt wrote nothing, and what the user can change about it. */
type ImageTitleOutcome =
  | { readonly ok: true; readonly title: string }
  | { readonly ok: false; readonly reason: 'not-found' | 'no-image' | 'no-model' | 'no-vision' | 'stale' | 'failed'; readonly message: string }

type ImageTitleSkipReason = 'not-found' | 'no-image' | 'no-model' | 'no-vision' | 'failed'

const TITLE_MAX_TOKENS = 64
const MODEL_TIMEOUT = '20 seconds'
const DATA_URL = /^data:([^;,]+);base64,([\s\S]+)$/u

const outcomeOf = (outcome: ImageTitleOutcome): 'succeeded' | 'skipped' | 'stale' | 'failed' => {
  if (outcome.ok) return 'succeeded'
  if (outcome.reason === 'stale') return 'stale'
  return outcome.reason === 'failed' || outcome.reason === 'not-found' ? 'failed' : 'skipped'
}

/**
 * Names image-only captures with the triage model when its route reads images: one short model call after a capture, and
 * on request from the item. The title write is conditional, so an edit made while the model runs always wins.
 */
export class ImageTitles extends Context.Service<
  ImageTitles,
  {
    /** Names a fresh image-only capture in the background, when the setting is on; otherwise starts nothing. */
    readonly schedule: (id: number) => Effect.Effect<void>
    /** Names an item now, because the user asked: the setting does not gate an explicit request. */
    readonly regenerate: (id: number) => Effect.Effect<ImageTitleOutcome, BacklogWriteFailed>
  }
>()('@dshfiles/backlog/ImageTitles') {
  static readonly layer = Layer.effect(
    ImageTitles,
    Effect.gen(function* () {
      const store = yield* BacklogStore
      const settings = yield* BacklogSettingsTag
      const llm = yield* Llm
      const images = yield* HostAttachments
      const activity = yield* AiActivity
      const running = yield* FiberMap.make<string>()

      const recordFailure = (input: { readonly id: number; readonly startedAt: number; readonly message: string }) =>
        Effect.asVoid(
          store
            .recordImageTitleJob({
              id: input.id,
              job: { state: 'failed', startedAt: input.startedAt, message: input.message.slice(0, 400) },
            })
            .pipe(Effect.catch(error => Effect.asVoid(Effect.logWarning('backlog: the image title state could not be saved', error)))),
        )

      const skip = (input: { readonly id: number; readonly reason: ImageTitleSkipReason; readonly message: string; readonly startedAt?: number }) =>
        Effect.gen(function* () {
          const startedAt = input.startedAt ?? (yield* Clock.currentTimeMillis)
          yield* recordFailure({ id: input.id, startedAt, message: input.message })
          return { ok: false as const, reason: input.reason, message: input.message }
        })

      const callModel = (input: { readonly provider: string; readonly model: string; readonly image: ImageAttachmentRef }) =>
        Effect.gen(function* () {
          const assembler = new BlockAssembler()
          yield* Stream.runForEach(
            llm.stream({
              provider: input.provider,
              model: input.model,
              system: ImageTitleModel.prompt.system,
              messages: [
                createUserMessage({
                  content: [
                    { type: 'text', text: ImageTitleModel.prompt.input },
                    { type: 'image', attachment: input.image },
                  ],
                  source: { kind: 'user' },
                }),
              ],
              maxTokens: TITLE_MAX_TOKENS,
              purpose: 'session-title',
            }),
            chunk => Effect.sync(() => assembler.push(chunk)),
          )
          return assembler
            .blocks()
            .flatMap(block => (block.type === 'text' ? [block.text] : []))
            .join('')
        }).pipe(Effect.timeout(MODEL_TIMEOUT), Effect.option)

      const attempt = Effect.fn('backlog image title')(
        function* (input: { readonly id: number; readonly trigger: 'capture' | 'request' }) {
          yield* Effect.annotateCurrentSpan({ 'dshx.backlog.item_id': input.id })
          const found = yield* store.get(input.id)
          if (!found.ok) return { ok: false as const, reason: 'not-found' as const, message: `No backlog item has id ${String(input.id)}.` }
          const item = found.value.item
          const attachmentId = ImageTitleModel.imageAttachmentIdOf({ title: item.title, attachments: item.attachments })
          if (attachmentId === undefined)
            return { ok: false as const, reason: 'no-image' as const, message: 'This item has no image to name; attach one first.' }
          if (input.trigger === 'capture' && !ImageTitleModel.isImageOnlyTitle(item.title))
            return { ok: false as const, reason: 'no-image' as const, message: 'The item already has a title.' }
          const current = yield* settings.get
          if (current.triageProvider === '' || current.triageModel === '')
            return yield* skip({
              id: input.id,
              reason: 'no-model',
              message: 'No triage model is set. Pick a provider and a vision-capable model in Backlog settings › Triage, then try again.',
            })
          const route = { provider: current.triageProvider, model: current.triageModel }
          const info = yield* llm.modelInfo(route).pipe(Effect.option)
          if (Option.isNone(info))
            return yield* skip({
              id: input.id,
              reason: 'no-model',
              message: `Could not read what ${route.provider}/${route.model} supports. Check the route in AI Accounts, then try again.`,
            })
          if (!(info.value.inputModalities ?? []).includes('image'))
            return yield* skip({
              id: input.id,
              reason: 'no-vision',
              message: `The triage model ${route.provider}/${route.model} does not accept images. Set a vision-capable provider and model in Backlog settings › Triage, then try again.`,
            })
          const startedAt = yield* Clock.currentTimeMillis
          yield* store.recordImageTitleJob({ id: input.id, job: { state: 'pending', startedAt } })
          const read = yield* store.readFile({ id: input.id, attachmentId })
          if (!read.ok)
            return yield* skip({
              id: input.id,
              startedAt,
              reason: 'failed',
              message: 'The image could not be read back from the item. Remove and re-attach it, then try again.',
            })
          const dataUrl = DATA_URL.exec(read.value.dataUrl)
          const mediaType = dataUrl?.[1] === undefined ? undefined : BacklogItems.imageMediaTypes.find(candidate => candidate === dataUrl[1])
          if (dataUrl === null || dataUrl[2] === undefined || mediaType === undefined)
            return yield* skip({
              id: input.id,
              startedAt,
              reason: 'failed',
              message: 'The image is not one the attachments store can send (PNG, JPEG, WebP or GIF). Attach it again, then try again.',
            })
          const attachment = item.attachments.find(candidate => candidate.id === attachmentId)
          const image = yield* images.admitImage({ mediaType, data: dataUrl[2], name: attachment?.name ?? 'image' }).pipe(
            Effect.mapError(error => error.message),
            Effect.option,
          )
          if (Option.isNone(image))
            return yield* skip({
              id: input.id,
              startedAt,
              reason: 'failed',
              message: 'The image could not be handed to the model. Remove and re-attach it, then try again.',
            })
          const answer = yield* activity.track(callModel({ ...route, image: image.value }))
          if (Option.isNone(answer))
            return yield* skip({
              id: input.id,
              startedAt,
              reason: 'failed',
              message: `The ${route.provider}/${route.model} model did not answer. Check the account in AI Accounts or pick another model, then try again.`,
            })
          const title = ImageTitleModel.toShortTitle(answer.value)
          if (title === '')
            return yield* skip({
              id: input.id,
              startedAt,
              reason: 'failed',
              message: 'The model returned no usable title. Try again, or write one yourself.',
            })
          const write = yield* store.applyImageTitle({ id: input.id, startedAt, expectedTitle: item.title, title })
          if (write.ok) return { ok: true as const, title: write.value.item.title }
          return {
            ok: false as const,
            reason: 'stale' as const,
            message:
              write.reason === 'stale'
                ? 'The title changed while the model was reading the image, so it was left alone. Try again to name it from the image.'
                : 'A newer title attempt replaced this one; its result stands.',
          }
        },
        effect =>
          effect.pipe(
            Effect.tap(result => Effect.annotateCurrentSpan('dshx.backlog.image_title.outcome', outcomeOf(result))),
            Effect.tapError(() => Effect.annotateCurrentSpan('dshx.backlog.image_title.outcome', 'failed')),
          ),
      )

      const schedule = Effect.fn('backlog image title schedule')(function* (id: number) {
        if (!(yield* settings.get).imageTitle) return
        const found = yield* store.get(id)
        if (!found.ok || !ImageTitleModel.isImageOnlyTitle(found.value.item.title)) return
        yield* FiberMap.run(
          running,
          String(id),
          activity.track(attempt({ id, trigger: 'capture' })).pipe(Effect.catch(error => Effect.logDebug('backlog: image title skipped', error))),
          { onlyIfMissing: true, startImmediately: true },
        )
      })

      const regenerate = (id: number) => activity.track(attempt({ id, trigger: 'request' }))

      return ImageTitles.of({ schedule, regenerate })
    }),
  )
}
