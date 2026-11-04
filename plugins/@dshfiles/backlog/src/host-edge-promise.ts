import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type {
  PromptContentPart,
  SessionCreateRequest,
  SessionCreateValue,
  SessionListValue,
  SessionPromptRequest,
  SessionRenameRequest,
  SessionSelectModelRequest,
} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-workspace'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'
import { SessionsUnavailable, ThreadContextNotDelivered, TweetImageInvalid } from './errors.js'

/**
 * The one edge that adapts DSH's Promise Host services for the backlog: interruption aborts each call, every failure is
 * typed with the plugin's own error and wire code, and no other backlog module sees a Promise. Services are read at call
 * time, because one may load after this plugin activated.
 */

const SESSION_LIST_TIMEOUT = '20 seconds'
const SESSION_PROMPT_TIMEOUT = '120 seconds'
const UPLOAD_CHUNK_BYTES = 64 * 1024
const NOT_LOADED = 'The voice-input bundle is not loaded.'

const reasonOf = (cause: unknown, fallback: string): string => (cause instanceof Error ? cause.message.slice(0, 300) : fallback)

export interface SpeechStatus {
  readonly available: boolean
  readonly ready: boolean
  readonly provider: string | null
  readonly language: string | null
  readonly reason: string | null
}

export type Transcription = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string }

export interface HostWorkspaceRef {
  readonly id: string
  readonly path: string
}

/** A receipt the Host minted for one uploaded file, as a prompt's file part names it. */
type FileReceiptId = Extract<PromptContentPart, { readonly type: 'file' }>['receiptId']

// SAFETY: the Session id is one the Host returned; the plugin only carries it as a plain string.
const sessionIdOf = (sessionId: string): SessionId => sessionId as SessionId

/** The Session controller's thread verbs the backlog starts and continues threads with, keyed by plain Session ids. */
export class HostSessions extends Context.Service<
  HostSessions,
  {
    readonly list: Effect.Effect<SessionListValue, SessionsUnavailable>
    readonly create: (request: Omit<SessionCreateRequest, 'sessionId'>) => Effect.Effect<{ readonly sessionId: string }, SessionsUnavailable>
    readonly selectModel: (request: Omit<SessionSelectModelRequest, 'sessionId'> & { readonly sessionId: string }) => Effect.Effect<void, SessionsUnavailable>
    readonly rename: (request: Omit<SessionRenameRequest, 'sessionId'> & { readonly sessionId: string }) => Effect.Effect<void, SessionsUnavailable>
    /** Queue one message into the thread; `requestId` is Host-minted and unique per prompt. */
    readonly prompt: (request: Omit<SessionPromptRequest, 'sessionId'> & { readonly sessionId: string }) => Effect.Effect<void, SessionsUnavailable>
  }
>()('@dshfiles/backlog/HostSessions') {
  static readonly layer = Layer.effect(
    HostSessions,
    Effect.gen(function* () {
      const host = yield* HostContext
      const controller = () => host.ctx.get('sessionController')
      const unavailable = (cause: unknown) => new SessionsUnavailable({ cause })
      const missing = () => new SessionsUnavailable({})

      return HostSessions.of({
        list: Effect.gen(function* () {
          const sessions = controller()
          if (sessions === undefined) return yield* missing()
          return yield* Effect.tryPromise(signal => sessions.list({}, signal)).pipe(Effect.timeout(SESSION_LIST_TIMEOUT), Effect.mapError(unavailable))
        }),
        create: request =>
          Effect.gen(function* () {
            const sessions = controller()
            if (sessions === undefined) return yield* missing()
            const created: SessionCreateValue = yield* Effect.tryPromise(() => sessions.create(request)).pipe(Effect.mapError(unavailable))
            return { sessionId: String(created.sessionId) }
          }),
        selectModel: request =>
          Effect.gen(function* () {
            const sessions = controller()
            if (sessions === undefined) return yield* missing()
            yield* Effect.tryPromise(() => sessions.selectModel({ ...request, sessionId: sessionIdOf(request.sessionId) })).pipe(Effect.mapError(unavailable))
          }),
        rename: request =>
          Effect.gen(function* () {
            const sessions = controller()
            if (sessions === undefined) return yield* missing()
            yield* Effect.tryPromise(() => sessions.rename({ ...request, sessionId: sessionIdOf(request.sessionId) })).pipe(Effect.mapError(unavailable))
          }),
        prompt: request =>
          Effect.gen(function* () {
            const sessions = controller()
            if (sessions === undefined) return yield* missing()
            yield* Effect.tryPromise(signal => sessions.prompt({ ...request, sessionId: sessionIdOf(request.sessionId) }, signal)).pipe(
              Effect.timeout(SESSION_PROMPT_TIMEOUT),
              Effect.mapError(unavailable),
            )
          }),
      })
    }),
  )
}

const chunks = (bytes: Uint8Array): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() {
    for (let offset = 0; offset < bytes.byteLength; offset += UPLOAD_CHUNK_BYTES) yield bytes.subarray(offset, offset + UPLOAD_CHUNK_BYTES)
  },
})

/** Raw session-scoped uploads, for the attachments a started thread carries. */
export class HostUploads extends Context.Service<
  HostUploads,
  {
    readonly upload: (input: {
      readonly sessionId: string
      readonly name: string
      readonly bytes: Uint8Array
    }) => Effect.Effect<{ readonly receiptId: FileReceiptId }, ThreadContextNotDelivered>
  }
>()('@dshfiles/backlog/HostUploads') {
  static readonly layer = Layer.effect(
    HostUploads,
    Effect.gen(function* () {
      const host = yield* HostContext
      return HostUploads.of({
        upload: input =>
          Effect.gen(function* () {
            const uploads = host.ctx.get('fileUploads')
            if (uploads === undefined) return yield* new ThreadContextNotDelivered({ sessionId: input.sessionId })
            const uploaded = yield* Effect.tryPromise(signal =>
              uploads.uploadStream({ sessionId: sessionIdOf(input.sessionId), data: chunks(input.bytes), name: input.name, signal }),
            ).pipe(Effect.mapError(cause => new ThreadContextNotDelivered({ sessionId: input.sessionId, cause })))
            return { receiptId: uploaded.receiptId }
          }),
      })
    }),
  )
}

/** The image store, for the pictures a public post carries into an item. */
export class HostAttachments extends Context.Service<
  HostAttachments,
  {
    readonly readImage: (reference: ImageAttachmentRef) => Effect.Effect<StoredImageAttachment, TweetImageInvalid>
  }
>()('@dshfiles/backlog/HostAttachments') {
  static readonly layer = Layer.effect(
    HostAttachments,
    Effect.gen(function* () {
      const host = yield* HostContext
      return HostAttachments.of({
        readImage: reference =>
          Effect.gen(function* () {
            const attachments = host.ctx.get('attachments')
            if (attachments === undefined) return yield* new TweetImageInvalid({})
            return yield* Effect.tryPromise(() => attachments.readImage(reference)).pipe(Effect.mapError(cause => new TweetImageInvalid({ cause })))
          }),
      })
    }),
  )
}

/** Voice input through DSH's speech bundle: unloaded and unready states are answers, not failures. */
export class HostSpeech extends Context.Service<
  HostSpeech,
  {
    readonly status: Effect.Effect<SpeechStatus>
    readonly transcribe: (audioBase64: string) => Effect.Effect<Transcription>
  }
>()('@dshfiles/backlog/HostSpeech') {
  static readonly layer = Layer.effect(
    HostSpeech,
    Effect.gen(function* () {
      const host = yield* HostContext
      const recognizer = () => host.ctx.get('speechToText')

      const status = Effect.gen(function* () {
        const speech = recognizer()
        if (speech === undefined) return { available: false, ready: false, provider: null, language: null, reason: NOT_LOADED } satisfies SpeechStatus
        return yield* Effect.try(() => speech.snapshot()).pipe(
          Effect.map((snapshot): SpeechStatus => {
            const provider = snapshot.providers.find(candidate => candidate.id === snapshot.selection.providerId)
            const language = snapshot.selection.language
            if (provider === undefined) return { available: true, ready: false, provider: null, language, reason: 'The selected recognizer is not registered.' }
            const ready = provider.preparation?.phase === 'ready'
            return { available: true, ready, provider: provider.name, language, reason: ready ? null : 'Open Plugins → Voice input to prepare the recognizer.' }
          }),
          Effect.catch(error =>
            Effect.succeed<SpeechStatus>({
              available: true,
              ready: false,
              provider: null,
              language: null,
              reason: reasonOf(error.cause, 'Speech readiness is unavailable.'),
            }),
          ),
        )
      }).pipe(Effect.withSpan('backlog speech status'))

      const transcribe = Effect.fn('backlog speech transcribe')(function* (audioBase64: string) {
        const speech = recognizer()
        if (speech === undefined) return { ok: false, reason: NOT_LOADED } satisfies Transcription
        const current = yield* status
        if (!current.ready) return { ok: false, reason: current.reason ?? 'The recognizer is not ready.' } satisfies Transcription
        const audio = new Uint8Array(Buffer.from(audioBase64, 'base64'))
        if (audio.byteLength === 0) return { ok: false, reason: 'The recording was empty.' } satisfies Transcription
        return yield* Effect.tryPromise(signal => speech.transcribe(speech.resolve({ audio }), signal)).pipe(
          Effect.map((transcript): Transcription => ({ ok: true, text: transcript.text })),
          Effect.catch(error => Effect.succeed<Transcription>({ ok: false, reason: reasonOf(error.cause, 'Transcription failed.') })),
        )
      })

      return HostSpeech.of({ status, transcribe })
    }),
  )
}

/** The registered workspaces, read synchronously from the registry the Host keeps in memory. */
export class HostWorkspaces extends Context.Service<
  HostWorkspaces,
  {
    readonly list: Effect.Effect<readonly HostWorkspaceRef[]>
  }
>()('@dshfiles/backlog/HostWorkspaces') {
  static readonly layer = Layer.effect(
    HostWorkspaces,
    Effect.map(HostContext, host =>
      HostWorkspaces.of({
        list: Effect.sync(() => {
          const registry = host.ctx.get('workspaceRegistry')
          if (registry === undefined) return []
          return registry.list().map(workspace => ({ id: String(workspace.id), path: workspace.path }))
        }),
      }),
    ),
  )
}

/** Every Promise Host service the backlog reads, as one layer. */
export const hostEdgeLayer = Layer.mergeAll(HostSessions.layer, HostUploads.layer, HostAttachments.layer, HostSpeech.layer, HostWorkspaces.layer)
