import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { Schema } from 'effect'
import { useCallback, useState } from 'react'

const draftsRecordSchema = Schema.Record(Schema.String, Schema.String.check(Schema.isMaxLength(20_000)))
const noDrafts: typeof draftsRecordSchema.Type = {}
const drafts = createStoredValue({ key: 'dshfiles.backlog.draft.v1', schema: draftsRecordSchema, fallback: noDrafts })

export const useComposerDraft = (draftKey: string) => {
  const storedDrafts = drafts.useValue()
  const [text, setTextState] = useState(() => storedDrafts[draftKey] ?? '')
  const setText = useCallback(
    (value: string): void => {
      setTextState(value)
      const next = { ...drafts.get() }
      if (value === '') delete next[draftKey]
      else next[draftKey] = value
      drafts.set(next)
    },
    [draftKey],
  )
  const appendText = (chunk: string): void => {
    setTextState(current => {
      const next = current === '' || current.endsWith(' ') ? `${current}${chunk}` : `${current} ${chunk}`
      drafts.set({ ...drafts.get(), [draftKey]: next })
      return next
    })
  }
  /**
   * Puts a refused capture back unless the user typed something new since. The editor's own Enter handling can leave
   * blank lines behind after a send ("\n\n"), which is not something typed: a whitespace-only box counts as empty, or
   * Retry would offer to resend nothing.
   */
  const restoreText = (submitted: string): void => {
    setTextState(current => (current.trim() === '' ? submitted : current))
  }
  return { text, setText, appendText, restoreText }
}
