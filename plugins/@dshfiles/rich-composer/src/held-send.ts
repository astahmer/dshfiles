import type { InputSubmitMode } from './native/contract/composer-submission.ts'
import type { DraftFileUpload } from './native/contract/slots.ts'

/** What the user asked to send: a change to any of it means they are no longer asking to send that message. */
export interface HeldDraft {
  readonly draft: string
  readonly attachmentIds: readonly string[]
  /** The quotes and notes riding with the message, in a comparable form. */
  readonly annotations: string
  /** The composer mode the message would be sent under (plan or not). */
  readonly mode: string
}

/** The upload gate over a draft's attachments. */
export type UploadGate =
  | { readonly kind: 'clear' }
  | { readonly kind: 'uploading'; readonly ready: number; readonly total: number; readonly fraction: number | undefined }
  | { readonly kind: 'failed' }

/** A send pressed while uploads were in flight, kept with the delivery it was pressed for. */
export interface HeldSend {
  readonly held: HeldDraft
  readonly mode: InputSubmitMode
  readonly source: 'click' | 'enter'
  /** Primary+Enter on the new-thread page: open a fresh draft once it went out. */
  readonly freshDraft: boolean
}

export type HeldSendOutcome =
  | { readonly kind: 'wait' }
  | { readonly kind: 'send'; readonly mode: InputSubmitMode; readonly source: 'click' | 'enter'; readonly freshDraft: boolean }
  | { readonly kind: 'cancel'; readonly reason: 'edited' | 'failed' }

const sameDraft = (left: HeldDraft, right: HeldDraft): boolean =>
  left.draft === right.draft &&
  left.annotations === right.annotations &&
  left.mode === right.mode &&
  left.attachmentIds.length === right.attachmentIds.length &&
  left.attachmentIds.every((id, index) => right.attachmentIds[index] === id)

const isUploadGated = (attachment: { readonly kind: string }, upload: DraftFileUpload | undefined): boolean =>
  attachment.kind === 'file' || upload !== undefined

/**
 * Every picked file and every uploading image holds the send; an image draft without an upload sends inline. A failed
 * upload holds it too, because it is retried or removed, never silently dropped.
 */
export const uploadGate = (input: {
  readonly attachments: readonly { readonly kind: string; readonly id: string }[]
  readonly uploads: Readonly<Record<string, DraftFileUpload | undefined>>
}): UploadGate => {
  const gated = input.attachments.flatMap(attachment => {
    const upload = input.uploads[attachment.id]
    return isUploadGated(attachment, upload) ? [upload] : []
  })
  if (gated.some(upload => upload?.status === 'error')) return { kind: 'failed' }
  const ready = gated.filter(upload => upload?.status === 'ready').length
  if (ready === gated.length) return { kind: 'clear' }
  const sizes = gated.map(upload => {
    if (upload?.status === 'ready') return { loaded: 1, total: 1 }
    if (upload?.status === 'uploading' && upload.total !== undefined && upload.total > 0) return { loaded: upload.loaded / upload.total, total: 1 }
    return undefined
  })
  const known = sizes.every(size => size !== undefined)
  const fraction = known ? sizes.reduce((sum, size) => sum + (size?.loaded ?? 0), 0) / gated.length : undefined
  return { kind: 'uploading', ready, total: gated.length, fraction }
}

/**
 * Decide a held send against the composer as it is now. Any edit cancels it; a failed upload cancels it so the
 * failure and its retry/remove recovery show instead; otherwise it sends, in the mode it was pressed for, once every
 * upload is ready and the composer accepts a submission.
 */
export const settleHeldSend = (input: {
  readonly pending: HeldSend
  readonly current: HeldDraft
  readonly gate: UploadGate
  readonly canSubmit: boolean
}): HeldSendOutcome => {
  if (!sameDraft(input.pending.held, input.current)) return { kind: 'cancel', reason: 'edited' }
  if (input.gate.kind === 'failed') return { kind: 'cancel', reason: 'failed' }
  if (input.gate.kind === 'uploading' || !input.canSubmit) return { kind: 'wait' }
  return { kind: 'send', mode: input.pending.mode, source: input.pending.source, freshDraft: input.pending.freshDraft }
}

/**
 * Whether Send waits for uploads instead of refusing (the `sendWhenUploaded` setting, on by default). The client entry
 * writes it from Settings; the composer bar reads it.
 */
let enabled = true
const listeners = new Set<() => void>()

export const SendWhenUploaded = {
  get: (): boolean => enabled,
  set: (next: boolean): void => {
    if (next === enabled) return
    enabled = next
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
