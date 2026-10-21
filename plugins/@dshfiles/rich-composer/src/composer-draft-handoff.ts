import type { DraftSnapshot as DraftDocument } from './native/contract/draft-editor.js'
import type { InputState } from './native/contract/input.js'

type DraftSnapshot<AttachmentId extends string> = Pick<InputState, 'draft' | 'phase'> & {
  readonly attachmentIds: readonly AttachmentId[]
}

export interface DraftHandoffPort<AttachmentId extends string = string> {
  readonly snapshot: DraftSnapshot<AttachmentId>
  readonly draftSnapshot: DraftDocument
  readonly addAttachments: (ids: readonly AttachmentId[]) => boolean
  readonly removeAttachment: (id: AttachmentId) => boolean
  readonly setDraft: (draft: DraftDocument | '') => void
}

export type ComposerDraftHandoff = 'transferred' | 'kept'

export const transferComposerDraft = <AttachmentId extends string>(input: {
  readonly source: DraftHandoffPort<AttachmentId>
  readonly destination: DraftHandoffPort<AttachmentId>
  readonly sourceSessionId: string
  readonly destinationSessionId: string
  readonly destinationSessionReady: boolean
  readonly rebindAttachments: (sessionId: string, attachmentIds: readonly AttachmentId[]) => void
}): ComposerDraftHandoff => {
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
    return 'kept'
  }

  if (source.attachmentIds.length > 0 && !input.destination.addAttachments(source.attachmentIds)) {
    return 'kept'
  }

  try {
    input.rebindAttachments(input.destinationSessionId, source.attachmentIds)
  } catch {
    for (const id of source.attachmentIds) input.destination.removeAttachment(id)
    try {
      input.rebindAttachments(input.sourceSessionId, source.attachmentIds)
    } catch {
      // The source keeps its attachment ids; navigation must not be blocked by the handoff.
    }
    return 'kept'
  }

  const document = input.source.draftSnapshot
  if (document.text !== '') {
    input.destination.setDraft(document)
    input.source.setDraft('')
  }
  for (const id of source.attachmentIds) input.source.removeAttachment(id)
  return 'transferred'
}
