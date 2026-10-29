import { z } from 'zod/mini'
import { BrowserBroker, type Live, type Subscribable } from './broker.js'
import { HostCommandsModel } from './host-commands.js'
import { MarkdownLinks } from './links.js'
import { LocaleNamespaceModel } from './locale.js'

export interface ConfirmInput {
  readonly title: string
  readonly description?: string
  readonly confirm?: string
  readonly cancel?: string
  /** Styles confirm as destructive and starts focus on cancel. */
  readonly danger?: boolean
}

export interface AlertInput {
  readonly title: string
  readonly description?: string
}

export interface PromptInput {
  readonly title: string
  readonly description?: string
  readonly placeholder?: string
  readonly initial?: string
  /** Hides what the user types, for a token or a password. */
  readonly secret?: boolean
}

export interface SelectOption<Value extends string> {
  readonly title: string
  readonly description?: string
  readonly value: Value
  readonly group?: string
}

export interface SelectInput<Value extends string> {
  readonly title: string
  readonly options: readonly SelectOption<Value>[]
  readonly current?: Value
}

/** Ask the user in the app's own dialogs. Cancelling resolves false or undefined. */
export interface DialogsService {
  confirm(input: ConfirmInput): Promise<boolean>
  alert(input: AlertInput): Promise<void>
  /** Never resolves an empty string: submitting an empty field does nothing. */
  prompt(input: PromptInput): Promise<string | undefined>
  select<Value extends string>(input: SelectInput<Value>): Promise<Value | undefined>
}

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastInput {
  readonly title: string
  readonly description?: string
  readonly tone?: ToastTone
  readonly action?: { readonly label: string; readonly run: () => void }
  /** Milliseconds before it closes on its own; 0 keeps it until dismissed. */
  readonly duration?: number
}

export interface ToastsService {
  /** Show one toast; the returned function dismisses it. */
  show(input: ToastInput): () => void
}

/** A command the command palette lists and its keys run. */
export interface CommandItem {
  /** Unique across plugins; prefix it with the plugin id, e.g. `@dshfiles/backlog.capture`. */
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly keywords?: readonly string[]
  readonly group?: string
  /** Default key chord, e.g. `Mod+Shift+K`; the owner decides whether it binds. */
  readonly keys?: readonly string[]
  /** False takes it out of the palette and turns its keys off. */
  readonly enabled?: boolean
  /** Keeps it out of the palette; its keys still work. */
  readonly hidden?: boolean
  /** From a key press, false declines the key so it reaches its target. */
  run(): void | false | Promise<void>
}

export const Dialogs = BrowserBroker.defineContract<DialogsService>('dshx.dialogs')
export const Toasts = BrowserBroker.defineContract<ToastsService>('dshx.toasts')
export const Command = BrowserBroker.defineRegistry<CommandItem>('dshx.command')

/** Plain browser dialogs, used only while no plugin provides `Dialogs`. */
const browserDialogs: DialogsService = {
  confirm: async input => window.confirm(input.description === undefined ? input.title : `${input.title}\n\n${input.description}`),
  alert: async input => window.alert(input.description === undefined ? input.title : `${input.title}\n\n${input.description}`),
  prompt: async input => {
    const answer = window.prompt(input.title, input.initial ?? '')
    return answer === null || answer.trim() === '' ? undefined : answer
  },
  select: async input => {
    const listing = input.options.map((option, index) => `${index + 1}. ${option.title}`).join('\n')
    const answer = window.prompt(`${input.title}\n\n${listing}`, '')
    const index = answer === null ? Number.NaN : Number.parseInt(answer, 10) - 1
    return input.options[index]?.value
  },
}

const consoleToasts: ToastsService = {
  show: input => {
    console.info(`dshx toast: ${input.title}${input.description === undefined ? '' : ` — ${input.description}`}`)
    return () => {}
  },
}

const activeOr = <T>(source: Subscribable<Live<T>>, fallback: T): T => {
  const live = source.get()
  return live.status === 'active' ? live.value : fallback
}

const dialogs: DialogsService = {
  confirm: input => activeOr(BrowserBroker.live(Dialogs), browserDialogs).confirm(input),
  alert: input => activeOr(BrowserBroker.live(Dialogs), browserDialogs).alert(input),
  prompt: input => activeOr(BrowserBroker.live(Dialogs), browserDialogs).prompt(input),
  select: input => activeOr(BrowserBroker.live(Dialogs), browserDialogs).select(input),
}

const toast: ToastsService = {
  show: input => activeOr(BrowserBroker.live(Toasts), consoleToasts).show(input),
}

export interface CommandsService {
  /**
   * Run a command as picking it in the palette does: a contributed `Command` first, then a Host command.
   * @returns false when no enabled command has the id.
   */
  run(id: string): boolean
  /** Every contributed command, in contribution order. */
  readonly list: Subscribable<readonly CommandItem[]>
}

const createCommands = (shortcuts: () => unknown): CommandsService => ({
  list: BrowserBroker.items(Command),
  run: id => {
    const command = BrowserBroker.items(Command)
      .get()
      .find(item => item.id === id)
    if (command !== undefined) {
      if (command.enabled === false) return false
      void Promise.resolve()
        .then(() => command.run())
        .catch(error => console.error(`dshx: command ${id} failed`, error))
      return true
    }
    return HostCommandsModel.run(shortcuts(), id)
  },
})

interface NativeLayout {
  readonly panelInfo: { getSnapshot(): { readonly activePanelId: string | null }; subscribe(listener: () => void): () => void }
  selectPanel(panelId: never): void
  toggleSidebar(): void
}

/** The right side region of the session on screen: its native right pane, or the Workbench dock. */
export interface SideRegionService {
  /** Whether it shows its panel; false while no session is on screen or the Host has no side region. */
  readonly expanded: Subscribable<boolean>
  /** Each returns false when the Host has no side region or no session is on screen. */
  open(): boolean
  hide(): boolean
  toggle(): boolean
}

export interface LayoutService {
  /** The selected main panel id, or null while a conversation shows. */
  readonly panel: Subscribable<string | null>
  /** Show a registered main panel, or the conversation with null. Returns false when this Host has no layout. */
  openPanel(panelId: string | null): boolean
  toggleSidebar(): boolean
  readonly side: SideRegionService
}

interface NativeSideRegion {
  isExpanded(): boolean
  toggleExpanded(): void
  readonly expanded?: { getSnapshot(): boolean; subscribe(listener: () => void): () => void }
}

const isNativeSideRegion = (value: unknown): value is NativeSideRegion =>
  typeof value === 'object' &&
  value !== null &&
  'isExpanded' in value &&
  typeof value.isExpanded === 'function' &&
  'toggleExpanded' in value &&
  typeof value.toggleExpanded === 'function'

// The Host's toggle throws while no session is on screen; that is a refusal here, not an error.
const createSideRegion = (sidebarRight: () => unknown): SideRegionService => {
  const toggleWhen = (wanted: (expanded: boolean) => boolean): boolean => {
    const native = sidebarRight()
    if (!isNativeSideRegion(native)) return false
    try {
      if (wanted(native.isExpanded())) native.toggleExpanded()
      return true
    } catch {
      return false
    }
  }
  return {
    expanded: {
      get: () => {
        const native = sidebarRight()
        return isNativeSideRegion(native) && native.isExpanded()
      },
      subscribe: listener => {
        const native = sidebarRight()
        return isNativeSideRegion(native) && native.expanded !== undefined ? native.expanded.subscribe(listener) : () => {}
      },
    },
    open: () => toggleWhen(expanded => !expanded),
    hide: () => toggleWhen(expanded => expanded),
    toggle: () => toggleWhen(() => true),
  }
}

const isNativeLayout = (value: unknown): value is NativeLayout =>
  typeof value === 'object' &&
  value !== null &&
  'selectPanel' in value &&
  typeof value.selectPanel === 'function' &&
  'panelInfo' in value &&
  typeof value.panelInfo === 'object' &&
  value.panelInfo !== null

const createLayout = (input: { readonly layout: () => unknown; readonly sidebarRight: () => unknown }): LayoutService => ({
  side: createSideRegion(input.sidebarRight),
  panel: {
    get: () => {
      const native = input.layout()
      return isNativeLayout(native) ? native.panelInfo.getSnapshot().activePanelId : null
    },
    subscribe: listener => {
      const native = input.layout()
      return isNativeLayout(native) ? native.panelInfo.subscribe(listener) : () => {}
    },
  },
  openPanel: panelId => {
    const native = input.layout()
    if (!isNativeLayout(native)) return false
    // MainPanelId is a branded string; the Host validates the key and throws when it is unregistered.
    native.selectPanel(panelId as never)
    return true
  },
  toggleSidebar: () => {
    const native = input.layout()
    if (!isNativeLayout(native)) return false
    native.toggleSidebar()
    return true
  },
})

export interface SaveFileInput {
  readonly name: string
  readonly content: string | Blob
  /** Media type of string content; `text/plain` by default. */
  readonly type?: string
}

export interface SystemService {
  /** Copy text through the Host clipboard; false when the browser refused. */
  copy(text: string): Promise<boolean>
  /** Download content as a file named `name`; false outside a browser page. */
  save(input: SaveFileInput): boolean
  /** Open an http(s) or mailto URL in a new browser tab; false for any other URL. */
  openExternal(url: string): boolean
  /** Open a custom-scheme link (`jj:main`) through its `LinkHandler`, else as `openExternal`; false when neither can. */
  openLink(href: string): boolean
}

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

// The Host's clipboard helper falls back to execCommand where navigator.clipboard is missing (plain-http remote pages).
// The platform module is read through the Client module loader's `require` so the bundler leaves it alone.
const hostClipboard = (text: string): Promise<boolean> | undefined => {
  try {
    const load = typeof require === 'function' ? require : undefined
    const primitives: unknown = load?.(PRIMITIVES_MODULE)
    if (typeof primitives !== 'object' || primitives === null || !('writeClipboard' in primitives) || typeof primitives.writeClipboard !== 'function')
      return undefined
    return Promise.resolve(primitives.writeClipboard(text)).then(written => written === true)
  } catch {
    return undefined
  }
}

// Revoking the object URL right after the click cancels the download in some browsers.
const DOWNLOAD_URL_TTL_MS = 60_000

const system: SystemService = {
  copy: text =>
    hostClipboard(text) ??
    globalThis.navigator?.clipboard?.writeText(text).then(
      () => true,
      () => false,
    ) ??
    Promise.resolve(false),
  save: input => {
    if (typeof document === 'undefined') return false
    const blob = typeof input.content === 'string' ? new Blob([input.content], { type: input.type ?? 'text/plain' }) : input.content
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = input.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_TTL_MS)
    return true
  },
  openExternal: url => {
    if (typeof window === 'undefined' || !URL.canParse(url) || !EXTERNAL_PROTOCOLS.has(new URL(url).protocol)) return false
    window.open(url, '_blank', 'noopener,noreferrer')
    return true
  },
  openLink: href => MarkdownLinks.open(href) || system.openExternal(href),
}

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

export interface NotifyInput {
  readonly title: string
  readonly body?: string
  /** A later notification with the same tag replaces this one. */
  readonly tag?: string
  /** Runs once the page has focus, when the user clicks the notification. */
  readonly onClick?: () => void
}

export interface NotificationsService {
  /** `unsupported` where the browser has no Notification API. */
  permission(): NotificationPermissionState
  /** Ask the user to allow notifications; browsers only show the prompt from a user gesture. */
  requestPermission(): Promise<NotificationPermissionState>
  /** Show an OS notification without ever prompting; false without permission or when the browser refuses. */
  notify(input: NotifyInput): boolean
}

const BrowserNotificationPermission = z.enum(['default', 'granted', 'denied'])

const browserNotification = (): typeof Notification | undefined => (typeof window !== 'undefined' && 'Notification' in window ? window.Notification : undefined)

const readNotificationPermission = (): NotificationPermissionState => {
  const api = browserNotification()
  return api === undefined ? 'unsupported' : (BrowserNotificationPermission.safeParse(api.permission).data ?? 'unsupported')
}

const notifications: NotificationsService = {
  permission: readNotificationPermission,
  // Older Safari answers through a callback and resolves undefined, so the permission is read again.
  requestPermission: async () => {
    const api = browserNotification()
    if (api === undefined) return 'unsupported'
    try {
      return BrowserNotificationPermission.safeParse(await api.requestPermission()).data ?? readNotificationPermission()
    } catch {
      return readNotificationPermission()
    }
  },
  // Some browsers only allow notifications from a service worker and throw here.
  notify: input => {
    const api = browserNotification()
    if (api?.permission !== 'granted') return false
    try {
      const notification = new api(input.title, {
        ...(input.body !== undefined && { body: input.body }),
        ...(input.tag !== undefined && { tag: input.tag }),
      })
      notification.onclick = () => {
        window.focus()
        input.onClick?.()
        notification.close()
      }
      return true
    } catch {
      return false
    }
  },
}

export type TextDirection = 'ltr' | 'rtl'

export interface LocaleState {
  /** Active UI locale id, e.g. `en` or `zh`. */
  readonly id: string
  readonly direction: TextDirection
}

export interface AppearanceState {
  readonly colorScheme: 'light' | 'dark'
  /** CSS font-family list per role; absent while this Host has no theme service. */
  readonly fonts?: { readonly text: string; readonly code: string; readonly terminal: string }
}

export interface EnvironmentService {
  readonly locale: Subscribable<LocaleState>
  readonly appearance: Subscribable<AppearanceState>
}

interface NativeLocale {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}

interface NativeTheme {
  getTheme(): unknown
}

const isNativeLocale = (value: unknown): value is NativeLocale =>
  typeof value === 'object' &&
  value !== null &&
  'getSnapshot' in value &&
  typeof value.getSnapshot === 'function' &&
  'subscribe' in value &&
  typeof value.subscribe === 'function'

const isNativeTheme = (value: unknown): value is NativeTheme =>
  typeof value === 'object' && value !== null && 'getTheme' in value && typeof value.getTheme === 'function'

const LocaleSnapshot = z.object({ active: z.string().check(z.minLength(1)) })
const ThemeSnapshot = z.object({
  active: z.object({ colorScheme: z.enum(['light', 'dark']) }),
  fontFamilies: z.object({ text: z.string(), code: z.string(), terminal: z.string() }),
})
const TextInfo = z.object({ direction: z.string() })

const activeLocaleOf = (snapshot: unknown): string | undefined => LocaleSnapshot.safeParse(snapshot).data?.active

const appearanceOf = (snapshot: unknown): AppearanceState | undefined => {
  const theme = ThemeSnapshot.safeParse(snapshot).data
  return theme === undefined ? undefined : { colorScheme: theme.active.colorScheme, fonts: theme.fontFamilies }
}

// Chromium and Firefox ship `getTextInfo()`; older engines and Node expose the `textInfo` getter instead.
const directionOf = (localeId: string): TextDirection => {
  try {
    const locale = new Intl.Locale(localeId)
    const info: unknown =
      'getTextInfo' in locale && typeof locale.getTextInfo === 'function' ? locale.getTextInfo() : 'textInfo' in locale ? locale.textInfo : undefined
    return TextInfo.safeParse(info).data?.direction === 'rtl' ? 'rtl' : 'ltr'
  } catch {
    return 'ltr'
  }
}

const createEnvironment = (input: {
  readonly service: (name: 'locale' | 'theme') => unknown
  readonly on: (event: 'theme/change', listener: () => void) => () => void
}): EnvironmentService => {
  let locale: LocaleState | undefined
  const readLocale = (): LocaleState => {
    const native = input.service('locale')
    const id = (isNativeLocale(native) ? activeLocaleOf(native.getSnapshot()) : undefined) ?? LocaleNamespaceModel.active()
    if (locale?.id !== id) locale = { id, direction: directionOf(id) }
    return locale
  }
  const fallbackAppearance: AppearanceState = {
    colorScheme: typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  }
  let appearance: { readonly source: unknown; readonly state: AppearanceState } | undefined
  const readAppearance = (): AppearanceState => {
    const native = input.service('theme')
    if (!isNativeTheme(native)) return fallbackAppearance
    const source = native.getTheme()
    if (appearance !== undefined && appearance.source === source) return appearance.state
    const state = appearanceOf(source) ?? fallbackAppearance
    appearance = { source, state }
    return state
  }
  return {
    locale: {
      get: readLocale,
      subscribe: listener => {
        const native = input.service('locale')
        return isNativeLocale(native) ? native.subscribe(listener) : () => {}
      },
    },
    appearance: { get: readAppearance, subscribe: listener => input.on('theme/change', listener) },
  }
}

export class AppServicesModel {
  static readonly dialogs = dialogs
  static readonly toast = toast
  static readonly browserDialogs = browserDialogs
  static readonly createCommands = createCommands
  static readonly createLayout = createLayout
  static readonly system = system
  static readonly notifications = notifications
  static readonly createEnvironment = createEnvironment
}
