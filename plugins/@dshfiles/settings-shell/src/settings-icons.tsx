/**
 * One glyph per Settings category (round five B5, B6): the desktop column draws it at 16px in muted ink beside each
 * row, the phone root list as a 28px identity tile. Published as the `@dshfiles/settings-shell/settings-icons` dshx
 * module, so the thread sidebar's Settings column draws the same glyph the page does without restating the table.
 */
import {
  BellIcon,
  BotIcon,
  BrainIcon,
  CircleDashedIcon,
  CodeIcon,
  CpuIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  InfoIcon,
  KeyboardIcon,
  KeyRoundIcon,
  ListIcon,
  MessageSquareTextIcon,
  PaletteIcon,
  PanelsTopLeftIcon,
  PlugIcon,
  PuzzleIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  SquarePenIcon,
  TimerIcon,
  UserRoundIcon,
  WrenchIcon,
  type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { createElement } from 'react'

/** A category's group, as Settings groups its entries. */
export type SettingsIconGroup =
  | 'general'
  | 'models'
  | 'agents'
  | 'tools'
  | 'projects'
  | 'hosts'
  | 'security'
  | 'notifications'
  | 'plugins'
  | 'about'
  | 'other'
  | 'pages'

/** What a category is about, read from its name first; its group's glyph otherwise. */
const BY_NAME: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/^general$|interface/u, SlidersHorizontalIcon],
  [/appearance|theme|colou?r/u, PaletteIcon],
  [/keyboard|shortcut/u, KeyboardIcon],
  [/thread list|sidebar/u, ListIcon],
  [/layout|pane|tabs/u, PanelsTopLeftIcon],
  [/composer|prompt/u, SquarePenIcon],
  [/transcript|chat|turn/u, MessageSquareTextIcon],
  [/editor/u, CodeIcon],
  [/account/u, UserRoundIcon],
  [/model/u, CpuIcon],
  [/subagent|agent/u, BotIcon],
  [/background job|job/u, TimerIcon],
  [/memory/u, BrainIcon],
  [/mcp/u, PlugIcon],
  [/web|search|fetch/u, GlobeIcon],
  [/secret|key/u, KeyRoundIcon],
  [/polic|sandbox|security|privacy/u, ShieldIcon],
  [/notification/u, BellIcon],
  [/plugin|market|capabilit/u, PuzzleIcon],
  [/update|release/u, RefreshCwIcon],
  [/project|workspace|backlog|repositor/u, FolderIcon],
  [/host|network|machine/u, ServerIcon],
]

const BY_GROUP = {
  general: SlidersHorizontalIcon,
  models: CpuIcon,
  agents: BotIcon,
  tools: WrenchIcon,
  projects: FolderIcon,
  hosts: ServerIcon,
  security: ShieldIcon,
  notifications: BellIcon,
  plugins: PuzzleIcon,
  about: InfoIcon,
  other: CircleDashedIcon,
  pages: FileTextIcon,
} as const satisfies Record<SettingsIconGroup, LucideIcon>

/**
 * Each group's identity tone for the phone tiles (DESIGN.md › Colour roles: identity tells things apart and never says
 * state), skipping the green and amber tones that sit near the status hues. Literal classes, so the stylesheet owner
 * sees them: a 14% tile of the tone with the glyph in the tone.
 */
const TILE_TONE = {
  general: 'dshx:bg-identity-7/14 dshx:text-identity-7',
  models: 'dshx:bg-identity-2/14 dshx:text-identity-2',
  agents: 'dshx:bg-identity-3/14 dshx:text-identity-3',
  tools: 'dshx:bg-identity-1/14 dshx:text-identity-1',
  projects: 'dshx:bg-identity-6/14 dshx:text-identity-6',
  hosts: 'dshx:bg-identity-7/14 dshx:text-identity-7',
  security: 'dshx:bg-identity-4/14 dshx:text-identity-4',
  notifications: 'dshx:bg-identity-3/14 dshx:text-identity-3',
  plugins: 'dshx:bg-identity-2/14 dshx:text-identity-2',
  about: 'dshx:bg-identity-1/14 dshx:text-identity-1',
  other: 'dshx:bg-identity-6/14 dshx:text-identity-6',
  pages: 'dshx:bg-identity-1/14 dshx:text-identity-1',
} as const satisfies Record<SettingsIconGroup, string>

const isGroup = (group: string): group is SettingsIconGroup => Object.hasOwn(BY_GROUP, group)

/** The glyph of one category: by its name, else by its group's. */
const glyphOf = (entry: { readonly label: string; readonly group: string }): LucideIcon => {
  const name = entry.label.trim().toLowerCase()
  const named = BY_NAME.find(([pattern]) => pattern.test(name))?.[1]
  return named ?? (isGroup(entry.group) ? BY_GROUP[entry.group] : CircleDashedIcon)
}

/** The desktop column's mark: 16px, muted ink, decorative (the row's label names it). */
export const SettingsEntryGlyph = (props: { readonly label: string; readonly group: string; readonly className?: string }): JSX.Element => (
  <span aria-hidden="true" data-settings-glyph="" className={cn('dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground', props.className)}>
    {createElement(glyphOf(props), { className: 'dshx:size-4', strokeWidth: 1.5 })}
  </span>
)

/** The phone root list's mark: a 28px tile in its group's identity tone with a 16px glyph, decorative. */
export const SettingsEntryTile = (props: { readonly label: string; readonly group: string }): JSX.Element => (
    <span
      aria-hidden="true"
      data-settings-tile={props.group}
      className={cn(
        'dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md',
        isGroup(props.group) ? TILE_TONE[props.group] : TILE_TONE.other,
      )}
    >
      {createElement(glyphOf(props), { className: 'dshx:size-4', strokeWidth: 1.75 })}
    </span>
)

export class SettingsIcons {
  static readonly glyphOf = glyphOf
}
