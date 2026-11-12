import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import type { RevisionSectionTarget } from '@dshfiles/jj-integration/revision-sections'
import type { ThreadMenuSectionProps } from '@dshfiles/thread-sidebar/thread-menu-sections'
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

/**
 * Backlog items that link to a thread, as one "Linked backlog items (N)" submenu of the thread header's `⋯`
 * (thread-sidebar's ThreadMenuSections, b:ysaj): upstream's indigo count chip in the header row spent the accent on
 * something that does not need the user. Choosing an item opens it in Backlog.
 */
export const ThreadBacklinks = (props: ThreadMenuSectionProps & { readonly openItem: (id: string | number) => void }): JSX.Element | null => {
  const items = useBacklinks([{ type: 'thread', target: props.sessionId }])
  if (items.length === 0) return null
  const { Item, Sub, SubTrigger, SubContent } = props
  const label = `Linked backlog items (${String(items.length)})`
  return (
    <Sub>
      <SubTrigger>
        <span className="dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-2" data-dshfiles-backlog-backlinks="thread">
          <ClipboardListIcon aria-hidden className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
          <span className="dshx:truncate">{label}</span>
        </span>
      </SubTrigger>
      <SubContent aria-label={label}>
        {items.map(item => (
          <Item key={item.id} onSelect={() => props.openItem(item.id)}>
            <span className="dshx:flex dshx:min-w-0 dshx:flex-col" data-dshfiles-backlog-backlink={BacklogReference.refOf(item)}>
              <span className="dshx:truncate">{item.title}</span>
              <span className="dshx:text-xs dshx:text-muted-foreground">{BacklogReference.label(BacklogReference.refOf(item))}</span>
            </span>
          </Item>
        ))}
      </SubContent>
    </Sub>
  )
}
