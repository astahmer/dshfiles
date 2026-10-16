import type { InputState } from './native/contract/input.js'

type DraftSnapshot<AttachmentId extends string> = Pick<InputState, 'draft' | 'phase'> & {
  readonly attachmentIds: readonly AttachmentId[]
}

export interface DraftHandoffPort<AttachmentId extends string = string> {
  readonly snapshot: DraftSnapshot<AttachmentId>
  readonly addAttachments: (ids: readonly AttachmentId[]) => boolean
  readonly removeAttachment: (id: AttachmentId) => boolean
  readonly setDraft: (draft: string) => void
}

export const transferComposerDraft = <AttachmentId extends string>(input: {
  readonly source: DraftHandoffPort<AttachmentId>
  readonly destination: DraftHandoffPort<AttachmentId>
  readonly sourceSessionId: string
  readonly destinationSessionId: string
  readonly destinationSessionReady: boolean
  readonly rebindAttachments: (sessionId: string, attachmentIds: readonly AttachmentId[]) => void
  readonly onRefused: () => void
}): void => {
  const source = input.source.snapshot
  const destination = input.destination.snapshot
  if (
    !input.destinationSessionReady ||
    source.phase !== 'plain' ||
    destination.phase !== 'plain' ||
    destination.draft !== '' ||
    destination.attachmentIds.length > 0 ||
    input.source === input.destination
  ) {
    input.onRefused()
    throw new Error('Composer draft handoff refused; source draft remains unchanged.')
  }

  if (source.attachmentIds.length > 0 && !input.destination.addAttachments(source.attachmentIds)) {
    input.onRefused()
    throw new Error('Composer draft handoff refused; source draft remains unchanged.')
  }

  try {
    input.rebindAttachments(input.destinationSessionId, source.attachmentIds)
  } catch (error) {
    for (const id of source.attachmentIds) input.destination.removeAttachment(id)
    input.rebindAttachments(input.sourceSessionId, source.attachmentIds)
    throw error
  }

  if (source.draft !== '') {
    input.destination.setDraft(source.draft)
    input.source.setDraft('')
  }
  for (const id of source.attachmentIds) input.source.removeAttachment(id)
}
