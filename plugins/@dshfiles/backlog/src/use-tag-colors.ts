import { useApi, useSettings } from '@dshfiles/dshx/client'
import { useMutation } from '@dshfiles/plugin-ui/query'
import { useMemo, useState } from 'react'
import { backlogApi } from './api.js'
import { FeedLook } from './feed-look.js'
import { BacklogNotices } from './notices.js'
import { backlogSettings } from './settings.js'
import { TagColors, type TagColorEntry } from './tag-colors.js'

const NONE: readonly TagColorEntry[] = []
const NO_PENDING: ReadonlyMap<string, number | null> = new Map()

export interface TagColorsView {
  /** Each tag's chosen slot; a tag left out keeps its hashed default. */
  readonly chosen: ReadonlyMap<string, number>
  /** The `project-tone-balanced-<n>` class a tag's chip takes. */
  readonly tone: (tag: string) => string
  /** Choose a tag's slot, or `null` to return it to its default. */
  readonly choose: (tag: string, slot: number | null) => void
}

/**
 * The tag colours the user chose, read from Backlog settings (every browser shares them) and written through
 * `backlog_set_tag_color`'s method. A pick shows at once and stays until the settings echo it back, or reverts with a
 * notice if the Host refuses it.
 */
export const useTagColors = (): TagColorsView => {
  const settings = useSettings(backlogSettings)
  const api = useApi(backlogApi)
  const stored = settings.value?.tagColors ?? NONE
  const storedMap = useMemo(() => TagColors.mapOf(stored), [stored])
  const [pending, setPending] = useState(NO_PENDING)
  const settled = [...pending].filter(([tag, slot]) => (storedMap.get(tag) ?? null) === slot)
  if (settled.length > 0) {
    const next = new Map(pending)
    for (const [tag] of settled) next.delete(tag)
    setPending(next)
  }
  const chosen = useMemo(() => {
    if (pending.size === 0) return storedMap
    const merged = new Map(storedMap)
    for (const [tag, slot] of pending) {
      if (slot === null) merged.delete(tag)
      else merged.set(tag, slot)
    }
    return merged
  }, [storedMap, pending])
  const save = useMutation({
    mutationFn: (input: { readonly tag: string; readonly slot: number | null }) => api.setTagColor(input),
    onMutate: input => setPending(current => new Map(current).set(input.tag, input.slot)),
    onError: (error, input) => {
      setPending(current => {
        const next = new Map(current)
        next.delete(input.tag)
        return next
      })
      BacklogNotices.failure('The tag colour was not saved.')(error)
    },
  })
  const tone = useMemo(() => FeedLook.tagToneOf(chosen), [chosen])
  return { chosen, tone, choose: (tag, slot) => save.mutate({ tag, slot }) }
}
