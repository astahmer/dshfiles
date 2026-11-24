/**
 * Renders the one thread menu (`thread-menu-model.ts`) with the menu parts of the surface that opened it: the list's
 * right-click menu or the header's dropdown. The surface says what each entry does; this file owns the order, the
 * grouping and the icons, so the two menus cannot drift apart again.
 */
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  AtSignIcon,
  BellIcon,
  BellRingIcon,
  CircleCheckIcon,
  CopyIcon,
  EllipsisIcon,
  FileTextIcon,
  FolderInputIcon,
  FolderPlusIcon,
  HashIcon,
  LayersIcon,
  LinkIcon,
  ListIcon,
  MailIcon,
  MessageSquarePlusIcon,
  PanelRightIcon,
  PanelRightOpenIcon,
  PauseIcon,
  PencilIcon,
  PinIcon,
  QuoteIcon,
  SearchIcon,
  SquareArrowOutUpRightIcon,
  TimerIcon,
  type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import { Fragment, type ComponentType, type ReactNode } from 'react'
import { ThreadMenuModel, type ThreadMenuEntryId } from './thread-menu-model.js'

/** The menu parts a surface renders with: the context-menu family in the list, the dropdown family in the header. */
export interface ThreadMenuKit {
  readonly Item: ComponentType<{
    readonly keys?: string
    readonly disabled?: boolean
    readonly onSelect?: (event: Event) => void
    readonly children?: ReactNode
    readonly 'data-thread-menu'?: string
  }>
  readonly Sub: ComponentType<{ readonly children?: ReactNode }>
  readonly SubTrigger: ComponentType<{ readonly disabled?: boolean; readonly children?: ReactNode; readonly 'data-thread-menu'?: string }>
  readonly SubContent: ComponentType<{ readonly className?: string; readonly 'aria-label'?: string; readonly children?: ReactNode }>
  readonly Separator: ComponentType<Record<never, never>>
}

/** One entry as its surface fills it in. The label is already translated; the icon defaults to the entry's own. */
export type ThreadMenuEntrySpec =
  | {
      readonly kind: 'item'
      readonly label: string
      readonly icon?: ReactNode
      /** The list key that runs the same verb; hidden on a touch device. */
      readonly keys?: string
      readonly disabled?: boolean
      readonly onSelect: () => void
    }
  | {
      readonly kind: 'sub'
      readonly label: string
      readonly icon?: ReactNode
      readonly disabled?: boolean
      /** The submenu's rows, rendered by the surface with its own parts. */
      readonly content: ReactNode
      readonly contentClassName?: string
    }
  /** Rows the surface renders itself (a list other plugins fill); they may come to nothing. */
  | { readonly kind: 'rows'; readonly rows: ReactNode }

export type ThreadMenuEntries = Readonly<Partial<Record<ThreadMenuEntryId, ThreadMenuEntrySpec>>>

const ICONS = {
  find: SearchIcon,
  pin: PinIcon,
  done: CircleCheckIcon,
  snooze: PauseIcon,
  restore: ArchiveRestoreIcon,
  rename: PencilIcon,
  'side-panel': PanelRightOpenIcon,
  'copy-link': LinkIcon,
  'thread-views': PanelRightIcon,
  'side-panel-views': PanelRightIcon,
  'continue-in': FolderInputIcon,
  'native-open-in': SquareArrowOutUpRightIcon,
  'copy-id': HashIcon,
  'copy-markdown': FileTextIcon,
  turns: ListIcon,
  mention: AtSignIcon,
  'follow-up': MessageSquarePlusIcon,
  mute: BellIcon,
  'mark-unread': MailIcon,
  notify: BellRingIcon,
  'auto-done': TimerIcon,
  'move-to-group': LayersIcon,
  'referenced-by': QuoteIcon,
  'turn-into-project': FolderPlusIcon,
  sections: EllipsisIcon,
  'row-actions': EllipsisIcon,
  'native-actions': EllipsisIcon,
  archive: ArchiveIcon,
} as const satisfies Record<ThreadMenuEntryId, LucideIcon>

export interface ThreadMenuProps {
  readonly kit: ThreadMenuKit
  readonly entries: ThreadMenuEntries
  readonly archived: boolean
  /** The phone shell: no side panel to open into. */
  readonly phone: boolean
  /** A touch device: no single-key hints. */
  readonly coarsePointer: boolean
  readonly labels: { readonly openIn: string; readonly copy: string; readonly more: string }
}

const SUB_CONTENT = 'dshx-root dshx:min-w-48 dshx:max-w-72'

/** A submenu row's icon and label with the gap an item gives them: the two menu families space a trigger differently. */
const lead = (icon: ReactNode, label: string): JSX.Element => (
  <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
    {icon}
    <span className="dshx:truncate">{label}</span>
  </span>
)

export const ThreadMenu = (props: ThreadMenuProps): JSX.Element => {
  const { kit, entries } = props
  const offered = new Set<ThreadMenuEntryId>()
  // SAFETY: ICONS is a literal object keyed by every ThreadMenuEntryId and nothing else, so its keys are exactly those ids.
  for (const id of Object.keys(ICONS) as ThreadMenuEntryId[]) if (entries[id] !== undefined) offered.add(id)
  const menu = ThreadMenuModel.layout({ offered, archived: props.archived, phone: props.phone })
  const entry = (id: ThreadMenuEntryId): ReactNode => {
    const spec = entries[id]
    if (spec === undefined) return null
    if (spec.kind === 'rows') return <Fragment key={id}>{spec.rows}</Fragment>
    const Icon = ICONS[id]
    const icon = spec.icon ?? <Icon aria-hidden="true" />
    if (spec.kind === 'sub') {
      return (
        <kit.Sub key={id}>
          <kit.SubTrigger data-thread-menu={id} {...(spec.disabled === true ? { disabled: true } : undefined)}>
            {lead(icon, spec.label)}
          </kit.SubTrigger>
          <kit.SubContent className={spec.contentClassName ?? SUB_CONTENT} aria-label={spec.label}>
            {spec.content}
          </kit.SubContent>
        </kit.Sub>
      )
    }
    const keys = ThreadMenuModel.keyHint(spec.keys, props.coarsePointer)
    return (
      <kit.Item
        key={id}
        data-thread-menu={id}
        onSelect={spec.onSelect}
        {...(spec.disabled === true ? { disabled: true } : undefined)}
        {...(keys === undefined ? undefined : { keys })}
      >
        {icon}
        {spec.label}
      </kit.Item>
    )
  }
  const group = (id: string, label: string, icon: ReactNode, rows: ReactNode): ReactNode => (
    <kit.Sub key={id}>
      <kit.SubTrigger data-thread-menu={id}>{lead(icon, label)}</kit.SubTrigger>
      <kit.SubContent className={SUB_CONTENT} aria-label={label}>
        {rows}
      </kit.SubContent>
    </kit.Sub>
  )
  const groups = [
    menu.openIn.length > 0 ? group('open-in', props.labels.openIn, <SquareArrowOutUpRightIcon aria-hidden="true" />, menu.openIn.map(entry)) : null,
    menu.copy.length > 0 ? group('copy', props.labels.copy, <CopyIcon aria-hidden="true" />, menu.copy.map(entry)) : null,
    menu.more.length > 0
      ? group(
          'more',
          props.labels.more,
          <EllipsisIcon aria-hidden="true" />,
          menu.more.map((cluster, index) => (
            <Fragment key={cluster.join('+')}>
              {index === 0 ? null : <kit.Separator />}
              {cluster.map(entry)}
            </Fragment>
          )),
        )
      : null,
  ].filter(node => node !== null)
  return (
    <>
      {menu.top.map(entry)}
      {menu.top.length > 0 && groups.length > 0 ? <kit.Separator /> : null}
      {groups}
    </>
  )
}
