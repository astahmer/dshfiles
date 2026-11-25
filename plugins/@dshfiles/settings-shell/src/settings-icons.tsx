/**
 * One glyph per Settings category (round five B5, B6): the desktop column draws it at 16px beside each row, the phone
 * root list as a 28px identity tile. Published as the `@dshfiles/settings-shell/settings-icons` dshx module, so the
 * thread sidebar's Settings column draws the same glyph the page does without restating the table.
 *
 * Council round 6 B3, B4: every item has its own glyph (Models and Model picker, MCP servers and MCP endpoint no longer
 * share one), and both the column glyph and the phone tile take their group's tone, one tone per group.
 */
import {
  AppWindowIcon,
  ArchiveIcon,
  BellIcon,
  BlocksIcon,
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  ChevronsUpDownIcon,
  CircleArrowUpIcon,
  CircleDashedIcon,
  CodeIcon,
  CompassIcon,
  CpuIcon,
  EraserIcon,
  FileTextIcon,
  FileUpIcon,
  FolderGit2Icon,
  FolderIcon,
  GitPullRequestIcon,
  GlobeIcon,
  HistoryIcon,
  IdCardIcon,
  InfoIcon,
  KeyboardIcon,
  KeyRoundIcon,
  LanguagesIcon,
  LayersIcon,
  LayoutGridIcon,
  ListChecksIcon,
  ListIcon,
  ListTodoIcon,
  MessageSquarePlusIcon,
  MessageSquareTextIcon,
  NetworkIcon,
  PackageIcon,
  PaletteIcon,
  PanelBottomIcon,
  PanelsTopLeftIcon,
  PlugIcon,
  PuzzleIcon,
  RadioTowerIcon,
  RefreshCwIcon,
  RepeatIcon,
  ScanTextIcon,
  ScrollTextIcon,
  ServerIcon,
  ShapesIcon,
  Share2Icon,
  ShieldCheckIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  SquarePenIcon,
  SquareTerminalIcon,
  StethoscopeIcon,
  StoreIcon,
  TimerIcon,
  UsersRoundIcon,
  WorkflowIcon,
  WrenchIcon,
  ZapIcon,
  type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { createElement, type CSSProperties } from 'react'

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

/** The entries Settings places, by their exact (lower-case) name: one glyph each, never repeated in the column. */
const BY_LABEL: ReadonlyMap<string, LucideIcon> = new Map([
  // General
  ['general', SlidersHorizontalIcon],
  ['appearance', PaletteIcon],
  ['keyboard shortcuts', KeyboardIcon],
  ['thread list', ListIcon],
  ['layout', PanelsTopLeftIcon],
  ['status bar', PanelBottomIcon],
  ['composer', SquarePenIcon],
  ['transcript', MessageSquareTextIcon],
  ['editor', CodeIcon],
  ['archived threads', ArchiveIcon],
  ['language', LanguagesIcon],
  // Models & accounts: the accounts list and the one DeepSeek sign-in read apart.
  ['ai accounts', UsersRoundIcon],
  ['models', CpuIcon],
  ['model picker', ChevronsUpDownIcon],
  ['deepseek account', IdCardIcon],
  ['account', IdCardIcon],
  // Agents
  ['agent definitions', BotIcon],
  ['agents', BotIcon],
  ['agent presets', LayersIcon],
  ['subagents', WorkflowIcon],
  ['background jobs', TimerIcon],
  ['memory', BrainIcon],
  ['agent loop', RepeatIcon],
  // Tools & MCP: the servers agents call, and the endpoint DSH serves.
  ['mcp servers', PlugIcon],
  ['mcp endpoint', RadioTowerIcon],
  ['web search and fetch', GlobeIcon],
  ['jev', ScanTextIcon],
  // Projects & workspaces
  ['projects', FolderIcon],
  ['new thread', MessageSquarePlusIcon],
  ['thread workspaces', FolderGit2Icon],
  ['repository history', HistoryIcon],
  ['checks and tests', ListChecksIcon],
  ['preview and dev servers', AppWindowIcon],
  ['backlog', ListTodoIcon],
  ['pull requests', GitPullRequestIcon],
  ['automations', ZapIcon],
  // Hosts & network
  ['hosts', ServerIcon],
  ['network access', NetworkIcon],
  ['thread sharing', Share2Icon],
  // Security
  ['secrets', KeyRoundIcon],
  ['policies', ScrollTextIcon],
  ['shell sandbox', SquareTerminalIcon],
  ['thread cleanup', EraserIcon],
  ['thread log sharing', FileUpIcon],
  ['permission presets', ShieldCheckIcon],
  // Notifications
  ['thread notifications', BellIcon],
  // Plugins: what ships built in, what is installed, and where more come from.
  ['built-in plugins', PuzzleIcon],
  ['installed plugins', PackageIcon],
  ['plugins', PackageIcon],
  ['plugin market', StoreIcon],
  ['plugin updates', CircleArrowUpIcon],
  ['opencode plugins', BlocksIcon],
  ['capabilities hub', LayoutGridIcon],
  ['component gallery', ShapesIcon],
  ['plugin guide', BookOpenIcon],
  // About
  ['update dsh', RefreshCwIcon],
  ['getting started', CompassIcon],
  ['diagnostics', StethoscopeIcon],
])

/** What a category nobody listed is about, read from its name; its group's glyph otherwise. */
const BY_NAME: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/interface/u, SlidersHorizontalIcon],
  [/theme|colou?r/u, PaletteIcon],
  [/shortcut/u, KeyboardIcon],
  [/sidebar/u, ListIcon],
  [/pane|tabs/u, PanelsTopLeftIcon],
  [/prompt/u, SquarePenIcon],
  [/chat|turn/u, MessageSquareTextIcon],
  [/account/u, UsersRoundIcon],
  [/model/u, CpuIcon],
  [/agent/u, BotIcon],
  [/job/u, TimerIcon],
  [/mcp/u, PlugIcon],
  [/web|search|fetch/u, GlobeIcon],
  [/secret|key/u, KeyRoundIcon],
  [/polic|sandbox|security|privacy/u, ShieldIcon],
  [/notification/u, BellIcon],
  [/plugin|market|capabilit/u, PuzzleIcon],
  [/update|release/u, RefreshCwIcon],
  [/project|workspace|repositor/u, FolderIcon],
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

/** The secondary ink: the groups the ramp leaves neutral (Developer, Pages, About and the rest). */
const NEUTRAL = 'var(--dsw-alias-label-secondary)'

/**
 * Each group's identity tone (DESIGN.md › Colour roles: identity tells things apart and never says state), one per group
 * on the council's ramp (round 6 B3): General sky, Models & accounts violet, Agents rose, Tools & MCP orange, Projects
 * olive, Security slate, Plugins teal; the rest neutral. Slate is the sky step greyed into the secondary ink in sRGB,
 * so it stays on the kit's tokens in both schemes. Green and amber are skipped: they sit near the status hues.
 */
const TONE = {
  general: 'var(--dshx-identity-7)',
  models: 'var(--dshx-identity-2)',
  agents: 'var(--dshx-identity-4)',
  tools: 'var(--dshx-identity-3)',
  projects: 'var(--dshx-identity-6)',
  hosts: NEUTRAL,
  security: `color-mix(in srgb, var(--dshx-identity-7) 45%, ${NEUTRAL})`,
  notifications: NEUTRAL,
  plugins: 'var(--dshx-identity-1)',
  about: NEUTRAL,
  other: NEUTRAL,
  pages: NEUTRAL,
} as const satisfies Record<SettingsIconGroup, string>

const isGroup = (group: string): group is SettingsIconGroup => Object.hasOwn(BY_GROUP, group)

/** A group's tone, as a CSS colour value. */
const toneOf = (group: string): string => (isGroup(group) ? TONE[group] : NEUTRAL)

/** The custom property the glyph and tile classes read, set per element to its group's tone. */
const toneStyle = (group: string): CSSProperties & Record<'--settings-tone', string> => ({ '--settings-tone': toneOf(group) })

/** The glyph of one category: by its name, else by its group's. */
const glyphOf = (entry: { readonly label: string; readonly group: string }): LucideIcon => {
  const name = entry.label.trim().toLowerCase()
  const named = BY_LABEL.get(name) ?? BY_NAME.find(([pattern]) => pattern.test(name))?.[1]
  return named ?? (isGroup(entry.group) ? BY_GROUP[entry.group] : CircleDashedIcon)
}

/** The desktop column's mark: 16px in its group's tone, decorative (the row's label names it). */
export const SettingsEntryGlyph = (props: { readonly label: string; readonly group: string; readonly className?: string }): JSX.Element => (
  <span
    aria-hidden="true"
    data-settings-glyph={props.group}
    className={cn('dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:text-(--settings-tone)', props.className)}
    style={toneStyle(props.group)}
  >
    {createElement(glyphOf(props), { className: 'dshx:size-4', strokeWidth: 1.5 })}
  </span>
)

/** The phone root list's mark: a 28px tile, 14% of its group's tone, with the 16px glyph in the tone; decorative. */
export const SettingsEntryTile = (props: { readonly label: string; readonly group: string }): JSX.Element => (
  <span
    aria-hidden="true"
    data-settings-tile={props.group}
    className="dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:bg-(--settings-tone)/14 dshx:text-(--settings-tone)"
    style={toneStyle(props.group)}
  >
    {createElement(glyphOf(props), { className: 'dshx:size-4', strokeWidth: 1.75 })}
  </span>
)

export class SettingsIcons {
  static readonly glyphOf = glyphOf
  static readonly toneOf = toneOf
}
