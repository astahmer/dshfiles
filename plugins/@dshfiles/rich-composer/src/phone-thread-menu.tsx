import { defineContract, useContract, type Subscribable } from '@dshfiles/dshx/client'
import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore, type Context, type ReactNode } from 'react'

export { createPhoneThreadMenu } from './phone-thread-menu-service.js'

export interface PhoneMenuReader {
  readonly id: string
  readonly sessionId: string
}

/** How a tool's row reads in the ⋯ sheet (council round 35 P2). Each part is optional: a tool that sets none is a bare label. */
export interface PhoneMenuToolLook {
  /** A leading glyph, drawn at 20px in the ink. */
  readonly icon?: ReactNode
  /** A short value after the label, right-aligned in the tertiary ink ("@dsh" after Tools). */
  readonly detail?: string
  /** Picking the row opens another surface (a sheet, a panel): the row ends in a chevron. */
  readonly opens?: boolean
}

export interface PhoneMenuTool extends PhoneMenuToolLook {
  readonly id: string
  readonly readerId: string
  readonly label: string
  readonly open: () => void
}

export interface PhoneMenuSnapshot {
  readonly readers: readonly PhoneMenuReader[]
  readonly tools: readonly PhoneMenuTool[]
  readonly launcherReader: string | null
  readonly openReader: string | null
  readonly closeReason: 'dismiss' | 'pick'
}

export interface PhoneThreadMenuService {
  readonly scope: Context<string | null>
  readonly state: Subscribable<PhoneMenuSnapshot>
  registerReader(reader: PhoneMenuReader): () => void
  registerTool(tool: PhoneMenuTool): () => void
  attachLauncher(readerId: string): () => void
  toggle(readerId: string, returnFocus?: () => boolean): void
  returnFocus(readerId: string): boolean
  close(): void
  pick(tool: PhoneMenuTool): void
}

/** A tool registration being assembled: its optional look is added only when set (exactOptionalPropertyTypes). */
type PhoneMenuToolDraft = { -readonly [Key in keyof PhoneMenuTool]: PhoneMenuTool[Key] }

export const PhoneThreadMenu = defineContract<PhoneThreadMenuService>('@dshfiles/rich-composer.phone-thread-menu', { owner: '@dshfiles/rich-composer' })

let scopeContext: Context<string | null> | undefined
export const phoneMenuScope = (): Context<string | null> => (scopeContext ??= createContext<string | null>(null))

const EMPTY: PhoneMenuSnapshot = { readers: [], tools: [], launcherReader: null, openReader: null, closeReason: 'dismiss' }
const emptyState: Subscribable<PhoneMenuSnapshot> = { get: () => EMPTY, subscribe: () => () => undefined }

export const usePhoneThreadMenu = () => {
  const contract = useContract(PhoneThreadMenu)
  const service = contract.status === 'active' ? contract.value : undefined
  const state = service?.state ?? emptyState
  const snapshot = useSyncExternalStore(state.subscribe, state.get, state.get)
  return { service, snapshot }
}

export const usePhoneMenuReader = (reader: PhoneMenuReader | null): void => {
  const { service } = usePhoneThreadMenu()
  const id = reader?.id
  const sessionId = reader?.sessionId
  useLayoutEffect(() => {
    if (id === undefined || sessionId === undefined) return
    return service?.registerReader({ id, sessionId })
  }, [service, id, sessionId])
}

export const usePhoneThreadTool = (
  input: PhoneMenuToolLook & {
    readonly id: string
    readonly label: string
    readonly open: () => void
    readonly active?: boolean
    readonly available?: boolean
  },
) => {
  const { service, snapshot } = usePhoneThreadMenu()
  const readerId = useContext(service?.scope ?? phoneMenuScope())
  const open = useRef(input.open)
  open.current = input.open
  // A tool's glyph is a new element each render: the registration reads the latest, and a new one alone never re-registers.
  const icon = useRef(input.icon)
  icon.current = input.icon
  const available = input.available !== false
  const { detail, opens } = input
  useLayoutEffect(() => {
    if (readerId === null || !available) return
    const tool: PhoneMenuToolDraft = { id: input.id, label: input.label, readerId, open: () => open.current() }
    if (icon.current !== undefined) tool.icon = icon.current
    if (detail !== undefined) tool.detail = detail
    if (opens !== undefined) tool.opens = opens
    return service?.registerTool(tool)
  }, [service, readerId, input.id, input.label, available, detail, opens])
  const managed = readerId !== null && snapshot.launcherReader === readerId && snapshot.readers.some(reader => reader.id === readerId)
  return {
    triggerProps: {
      'data-phone-thread-tool': input.id,
      'data-phone-thread-tool-hidden': managed && !input.active ? '' : undefined,
    },
    onCloseAutoFocus: (event: Event): void => {
      if (managed && readerId !== null && service?.returnFocus(readerId)) event.preventDefault()
    },
  }
}
