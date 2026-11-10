import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import type { RevisionSectionTarget } from '@dshfiles/jj-integration/revision-sections'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ClipboardListIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery } from '@dshfiles/plugin-ui/query'

import { backlogApi, type BacklogSummaryView } from './api.js'
import { BacklogReferenceChip } from './backlog-reference-chip.js'
import { BacklogReference } from './backlog-reference.js'
import type { BacklogLink } from './item.js'

type BacklinkTarget = Pick<BacklogLink, 'type' | 'target'>

const backlinksKey = (targets: readonly BacklinkTarget[]) =>
  ['dshfiles-backlog', 'backlinks', ...targets.map(target => `${target.type}:${target.target}`)] as const

/** Items linking to any of the targets, each once, newest activity first as the Host returns them. */
const mergeBacklinks = (lists: readonly (readonly BacklogSummaryView[])[]): BacklogSummaryView[] =>
  lists.flat().filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)

/** One read per target; a Host without the backlog API (or an older one) answers nothing, and the chip stays hidden. */
const useBacklinks = (targets: readonly BacklinkTarget[]): readonly BacklogSummaryView[] => {
  const api = useApi(backlogApi)
  const backlinks = useQuery<BacklogSummaryView[]>({
    queryKey: backlinksKey(targets),
    retry: false,
    // A link lands when a message or a capture names the target, so a mounted chip catches up without a reload.
    refetchInterval: query => (isApiOwnerMissing(query.state.error) ? false : 60_000),
    queryFn: async ({ signal }) => mergeBacklinks(await Promise.all(targets.map(target => api.referencing(target, { signal })))),
  })
  return backlinks.data ?? []
}

const BacklinkChipList = (props: { readonly items: readonly BacklogSummaryView[] }): JSX.Element => (
  <ul className="dshx:m-0 dshx:flex dshx:list-none dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:p-0">
    {props.items.map(item => (
      <li key={item.id} className="dshx:min-w-0 dshx:max-w-full">
        <BacklogReferenceChip reference={BacklogReference.refOf(item)} itemTitle={item.title} />
      </li>
    ))}
  </ul>
)

/** Backlog items that link to a revision, under its details in the jj panel (`RevisionSections`). */
export const RevisionBacklinks = (props: RevisionSectionTarget): JSX.Element | null => {
  const items = useBacklinks([
    { type: 'revision', target: props.changeId },
    { type: 'revision', target: props.commitId },
  ])
  if (items.length === 0) return null
  return (
    <div className="dshx-root dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2" data-dshfiles-backlog-backlinks="revision">
      <span className="dshx:shrink-0 dshx:py-0.5 dshx:text-muted-foreground">Backlog</span>
      <BacklinkChipList items={items} />
    </div>
  )
}

/** Backlog items that link to a thread, as one count chip in its header that lists them. */
export const ThreadBacklinks = (props: { readonly sessionId: string }): JSX.Element | null => {
  const items = useBacklinks([{ type: 'thread', target: props.sessionId }])
  if (items.length === 0) return null
  const label = items.length === 1 ? '1 backlog item links here' : `${String(items.length)} backlog items link here`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={label}
          className="dshx-root dshx:gap-1 dshx:text-info"
          data-dshfiles-backlog-backlinks="thread"
          size="xs"
          type="button"
          variant="ghost"
        >
          <ClipboardListIcon aria-hidden />
          {items.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        // Focusing the first chip would open its preview card while the popover is still moving into place.
        onOpenAutoFocus={event => event.preventDefault()}
        className="dshx:flex dshx:w-80 dshx:max-w-[calc(100vw-2rem)] dshx:flex-col dshx:gap-2 dshx:p-3 dshx:text-xs"
      >
        <span className="dshx:text-muted-foreground">{label}</span>
        <BacklinkChipList items={items} />
      </PopoverContent>
    </Popover>
  )
}
