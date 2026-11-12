import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { Llm } from '@dshfiles/dshx/effect/llm'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Stream } from 'effect'
import { AiActivity } from './ai-activity.js'
import type { BacklogFileInput } from './item.js'
import { HostAttachments } from './host-edge-promise.js'
import { ImageTitles } from './image-title-service.js'
import type { BacklogSettings } from './settings.js'
import { BacklogStore } from './store.js'
import { BacklogTestStore } from './test-support.js'

const user = { kind: 'user' } as const
const IMAGE_ID = 'shot-0001'
const IMAGE_TITLE = `![shot.png](dsh-context://v1/image/image_${IMAGE_ID})`

const imageFile: BacklogFileInput = {
  id: IMAGE_ID,
  kind: 'image',
  name: 'shot.png',
  mediaType: 'image/png',
  bytes: 4,
  width: 1,
  height: 1,
  data: Buffer.from('png!').toString('base64'),
}

const admittedImage = (): ImageAttachmentRef => ({
  attachmentId: AttachmentId('admitted-image'),
  mediaType: 'image/png',
  bytes: 4,
  width: 1,
  height: 1,
})

interface ModelCall {
  readonly provider: string
  readonly model: string
  readonly messages: readonly { readonly content: readonly { readonly type: string }[] }[]
}

interface FakeModel {
  readonly calls: ModelCall[]
  readonly answers: string[]
  /** Whether the triage route declares image input. */
  vision: boolean
  /** What happened before the model answers, such as a user editing the title mid-call. */
  beforeAnswer?: (() => Promise<void>) | undefined
}

const fakeModel = (overrides: Partial<Pick<FakeModel, 'vision'>> = {}): FakeModel => ({
  calls: [],
  answers: ['A red settings page with a save button'],
  vision: overrides.vision ?? true,
})

const capture = (store: BacklogStore['Service']) => store.capture({ text: IMAGE_TITLE, actor: user, files: [imageFile] })

const titlesLayer = (input: { readonly settings?: Partial<BacklogSettings>; readonly model: FakeModel }) =>
  ImageTitles.layer.pipe(
    Layer.provideMerge(BacklogTestStore.layer({ settings: { imageTitle: true, triageProvider: 'deepseek', triageModel: 'flash', ...input.settings } })),
    Layer.provideMerge(AiActivity.layer),
    Layer.provideMerge(
      Layer.succeed(
        Llm,
        Llm.of({
          stream: (options: GenerateOptions) => {
            input.model.calls.push({
              provider: options.provider,
              model: options.model,
              messages: options.messages.map(message => ({ content: message.content.map(part => ({ type: part.type })) })),
            })
            const answer = input.model.answers.shift() ?? ''
            return Stream.unwrap(
              Effect.as(
                Effect.promise(async () => input.model.beforeAnswer?.()),
                Stream.make({ type: 'text-delta', index: 0, text: answer }, { type: 'finish', reason: { kind: 'stop' } }),
              ),
            )
          },
          modelInfo: () =>
            Effect.succeed({
              provider: 'deepseek',
              id: 'flash',
              name: 'Flash',
              inputModalities: input.model.vision ? ['text', 'image'] : ['text'],
            }),
        } as never),
      ),
    ),
    Layer.provideMerge(
      Layer.succeed(
        HostAttachments,
        HostAttachments.of({
          readImage: () => Effect.die('unused'),
          admitImage: () => Effect.succeed(admittedImage()),
        } as never),
      ),
    ),
  )

describe('backlog image title', () => {
  it.effect('skips the model call when the setting is off', () => {
    const model = fakeModel()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const titles = yield* ImageTitles
      const created = yield* capture(store)

      yield* titles.schedule(created.item.id)

      expect(model.calls).toHaveLength(0)
      const after = yield* store.get(created.item.id)
      expect(after.ok && after.value.item.imageTitleJob).toBeUndefined()
      expect(after.ok && after.value.item.title).toBe(IMAGE_TITLE)
    }).pipe(Effect.provide(titlesLayer({ settings: { imageTitle: false }, model })), Effect.scoped)
  })

  it.effect('skips a route without image input and records a recovery hint', () => {
    const model = fakeModel({ vision: false })
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const titles = yield* ImageTitles
      const created = yield* capture(store)

      const outcome = yield* titles.regenerate(created.item.id)

      expect(outcome).toMatchObject({ ok: false, reason: 'no-vision' })
      expect(model.calls).toHaveLength(0)
      const after = yield* store.get(created.item.id)
      expect(after.ok && after.value.item.title).toBe(IMAGE_TITLE)
      expect(after.ok && after.value.item.imageTitleJob).toMatchObject({ state: 'failed' })
      expect(after.ok && after.value.item.imageTitleJob?.message).toContain('Backlog settings › Triage')
    }).pipe(Effect.provide(titlesLayer({ model })), Effect.scoped)
  })

  it.effect('names an image-only item with the triage route and records one bounded span', () => {
    const model = fakeModel()
    return Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans.stop()),
      )
      const store = yield* BacklogStore
      const titles = yield* ImageTitles
      const created = yield* capture(store)

      const outcome = yield* titles.regenerate(created.item.id)

      expect(outcome).toEqual({ ok: true, title: 'A red settings page with a save button' })
      expect(model.calls).toHaveLength(1)
      expect(model.calls[0]?.messages[0]?.content.map(part => part.type)).toEqual(['text', 'image'])
      const after = yield* store.get(created.item.id)
      expect(after.ok && after.value.item.title).toBe('A red settings page with a save button')
      expect(after.ok && after.value.item.imageTitleJob).toBeUndefined()

      const span = recorder.span('backlog image title')
      expect(span.attributes['dshx.backlog.item_id']).toBe(created.item.id)
      expect(span.attributes['dshx.backlog.image_title.outcome']).toBe('succeeded')
      expect(Object.keys(span.attributes).filter(name => name.startsWith('dshx.backlog.'))).toHaveLength(2)
    }).pipe(Effect.provide(titlesLayer({ model })), Effect.scoped, Effect.provide(DshxEffect.tracerLayer))
  })

  it.effect('keeps a title edited while the job runs', () => {
    const model = fakeModel()
    return Effect.gen(function* () {
      const store = yield* BacklogStore
      const titles = yield* ImageTitles
      const created = yield* capture(store)
      model.beforeAnswer = async () => {
        await Effect.runPromise(store.update({ id: created.item.id, title: 'My own title', actor: user }))
      }

      const outcome = yield* titles.regenerate(created.item.id)

      expect(outcome).toMatchObject({ ok: false, reason: 'stale' })
      const after = yield* store.get(created.item.id)
      expect(after.ok && after.value.item.title).toBe('My own title')
      expect(after.ok && after.value.item.imageTitleJob).toBeUndefined()
    }).pipe(Effect.provide(titlesLayer({ model })), Effect.scoped)
  })
})
