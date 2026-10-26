import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Forward semantic input changes, not caret movement, to the draft identity owner. */
export const observeSessionDraft = (input: {
  readonly state: ObservableSnapshot<{ readonly draft: string; readonly attachmentIds: readonly string[] }>
  readonly update: (draft: { readonly text: string; readonly hasAttachments: boolean }) => void
}): (() => void) => {
  let previousText: string | undefined
  let previousAttachments: boolean | undefined
  const sync = (): void => {
    const { draft, attachmentIds } = input.state.getSnapshot()
    const hasAttachments = attachmentIds.length > 0
    if (draft === previousText && hasAttachments === previousAttachments) return
    previousText = draft
    previousAttachments = hasAttachments
    input.update({ text: draft, hasAttachments })
  }
  const unsubscribe = input.state.subscribe(sync)
  sync()
  return unsubscribe
}
