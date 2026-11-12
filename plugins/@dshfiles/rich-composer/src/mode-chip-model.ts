/** The mode chip's pure parts (composer redesign b:v9yh): plain labels, slash lines and the catalog snapshot. */
import type { PermissionCatalog, PresetOption } from '@deepseek-ai/dsh-permission-presets/client'

/** Presets that ask for an explicit acknowledgement before they apply, as the native picker does. */
const RISKY = new Set(['danger-full-access', 'auto'])

/** Plain words and one sentence per built-in preset; a Host-configured preset keeps its own name and description. */
const BUILT_IN = {
  'read-only': { label: 'Read only', detail: 'Reads and searches; asks before changing anything.' },
  'workspace-write': { label: 'Can edit', detail: 'Edits files in this workspace; asks before anything outside it.' },
  'danger-full-access': { label: 'Full access', detail: 'Edits anything and runs commands without asking.' },
  auto: { label: 'Auto review', detail: 'A reviewer approves routine actions; risky ones still ask.' },
} as const satisfies Readonly<Record<string, { readonly label: string; readonly detail: string }>>

/** The built-in entry for a preset value, if it is one. */
const builtIn = (value: string): { readonly label: string; readonly detail: string } | undefined =>
  // SAFETY: Object.hasOwn just proved `value` is one of BUILT_IN's own keys.
  Object.hasOwn(BUILT_IN, value) ? BUILT_IN[value as keyof typeof BUILT_IN] : undefined

/** `kebab-case` preset keys read as words; other Host names stay as written. */
const presetWords = (name: string): string =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) ? name.replace(/-/gu, ' ').replace(/^./u, first => first.toUpperCase()) : name

export class ModeChipModel {
  static readonly accessLabel = (value: string, name?: string): string => builtIn(value)?.label ?? presetWords(name ?? value)

  static readonly accessDetail = (option: PresetOption): string | undefined => builtIn(option.value)?.detail ?? option.description

  /** "Plan · Can edit" while planning; the access alone otherwise ("Can edit", "Full access"). */
  static readonly chipLabel = (input: { readonly plan: boolean; readonly access: string }): string => (input.plan ? `Plan · ${input.access}` : input.access)

  /** The slash line that moves plan mode to `on`; the Host reads any argument but `off` as on. */
  static readonly planLine = (on: boolean): string => (on ? '/plan' : '/plan off')

  static readonly isRisky = (value: string): boolean => RISKY.has(value)
}

/** The Remote faces the chip needs: one catalog read, its change event, and one slash command per Session. */
export interface ModeChipHost {
  readonly catalog: () => Promise<
    { readonly ok: true; readonly value: PermissionCatalog } | { readonly ok: false; readonly error: { readonly message: string } }
  >
  readonly onCatalogChanged: (listener: () => void) => () => void
  /** Run one slash line in a Session; resolves to an error message, or null when the command ran. */
  readonly run: (sessionId: string, line: string) => Promise<string | null>
}

/** One page-wide catalog snapshot: read on first use and again after every change event. */
export class ModeChipCatalog {
  private value: PermissionCatalog | null = null
  private readonly listeners = new Set<() => void>()
  private reading: Promise<void> | undefined
  private stop: (() => void) | undefined

  constructor(private readonly host: ModeChipHost) {}

  readonly get = (): PermissionCatalog | null => this.value

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.stop === undefined) this.stop = this.host.onCatalogChanged(() => void this.refresh())
    if (this.value === null) void this.refresh()
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly refresh = (): Promise<void> => {
    this.reading ??= this.host
      .catalog()
      .then(result => {
        if (result.ok) this.value = result.value
      })
      .catch(() => undefined)
      .finally(() => {
        this.reading = undefined
        for (const listener of this.listeners) listener()
      })
    return this.reading
  }

  readonly dispose = (): void => {
    this.stop?.()
    this.stop = undefined
    this.listeners.clear()
  }
}
