import { BrowserBroker, type Live, type Subscribable } from './broker.js'
import { HostCommandsModel } from './host-commands.js'

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

export interface LayoutService {
  /** The selected main panel id, or null while a conversation shows. */
  readonly panel: Subscribable<string | null>
  /** Show a registered main panel, or the conversation with null. Returns false when this Host has no layout. */
  openPanel(panelId: string | null): boolean
  toggleSidebar(): boolean
}

const isNativeLayout = (value: unknown): value is NativeLayout =>
  typeof value === 'object' &&
  value !== null &&
  'selectPanel' in value &&
  typeof value.selectPanel === 'function' &&
  'panelInfo' in value &&
  typeof value.panelInfo === 'object' &&
  value.panelInfo !== null

const createLayout = (layout: () => unknown): LayoutService => ({
  panel: {
    get: () => {
      const native = layout()
      return isNativeLayout(native) ? native.panelInfo.getSnapshot().activePanelId : null
    },
    subscribe: listener => {
      const native = layout()
      return isNativeLayout(native) ? native.panelInfo.subscribe(listener) : () => {}
    },
  },
  openPanel: panelId => {
    const native = layout()
    if (!isNativeLayout(native)) return false
    // MainPanelId is a branded string; the Host validates the key and throws when it is unregistered.
    native.selectPanel(panelId as never)
    return true
  },
  toggleSidebar: () => {
    const native = layout()
    if (!isNativeLayout(native)) return false
    native.toggleSidebar()
    return true
  },
})

export class AppServicesModel {
  static readonly dialogs = dialogs
  static readonly toast = toast
  static readonly browserDialogs = browserDialogs
  static readonly createCommands = createCommands
  static readonly createLayout = createLayout
}
