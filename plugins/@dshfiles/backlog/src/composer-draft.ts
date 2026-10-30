import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { useCallback, useState } from 'react'
import { z } from 'zod'

const draftsSchema = z.record(z.string(), z.string().max(20_000))
const noDrafts: z.infer<typeof draftsSchema> = {}
const drafts = createStoredValue({ key: 'dshfiles.backlog.draft.v1', schema: draftsSchema, fallback: noDrafts })

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
  const restoreText = (submitted: string): void => {
    setTextState(current => (current === '' ? submitted : current))
  }
  return { text, setText, appendText, restoreText }
}
