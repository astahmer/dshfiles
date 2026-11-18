import { describeClientTool, type ClientToolItem } from '@dshfiles/dshx/client'
import { BridgeLimits, type ClientToolDescriptorView, type WindowState } from './api.js'

/**
 * A random id for this page load. getRandomValues also works on a plain-HTTP LAN or tailnet page, where
 * crypto.randomUUID is missing.
 */
const newClientId = (): string => `w-${Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('')}`

const CLIENT_ID_KEY = 'dshfiles-client-bridge.client-id'
const CLIENT_ID = /^w-[0-9a-f]{24}$/u

/**
 * This window's id: kept across a reload, so the Host replaces the window instead of listing it twice until the old
 * entry expires (the `leave` a closing page sends may not arrive), and an Agent's `clientId` still names it. Any other
 * navigation, a duplicated tab included (it copies sessionStorage), gets a new one.
 * @param input - the tab's sessionStorage (absent when the browser refuses it) and how this page was reached.
 * @returns the id to announce.
 */
const clientIdFor = (input: { readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined; readonly navigation: string | undefined }): string => {
  let kept: string | null = null
  try {
    kept = input.navigation === 'reload' ? (input.storage?.getItem(CLIENT_ID_KEY) ?? null) : null
  } catch {
    kept = null
  }
  const id = kept !== null && CLIENT_ID.test(kept) ? kept : newClientId()
  try {
    input.storage?.setItem(CLIENT_ID_KEY, id)
  } catch {
    // A storage-less page still works; it only gets a new id on reload.
  }
  return id
}

/**
 * A short, non-identifying name for this browser so an Agent can tell two windows apart ("Chrome on macOS").
 * @param userAgent - `navigator.userAgent`.
 * @param narrow - true on a phone-sized viewport.
 * @returns the label.
 */
const label = (userAgent: string, narrow: boolean): string => {
  const browser = /Edg\//u.test(userAgent)
    ? 'Edge'
    : /Firefox\//u.test(userAgent)
      ? 'Firefox'
      : /Chrome\//u.test(userAgent)
        ? 'Chrome'
        : /Safari\//u.test(userAgent)
          ? 'Safari'
          : 'Browser'
  const os = /iPhone|iPad/u.test(userAgent)
    ? 'iOS'
    : /Android/u.test(userAgent)
      ? 'Android'
      : /Mac OS X/u.test(userAgent)
        ? 'macOS'
        : /Windows/u.test(userAgent)
          ? 'Windows'
          : /Linux/u.test(userAgent)
            ? 'Linux'
            : 'unknown OS'
  return `${browser} on ${os}${narrow ? ' (narrow)' : ''}`
}

/**
 * The tools this window announces: first registration wins a duplicated name, a tool whose schema cannot be published
 * is skipped with a warning, and the list is capped.
 */
const descriptors = (tools: readonly ClientToolItem[], warn: (message: string) => void): ClientToolDescriptorView[] => {
  const seen = new Set<string>()
  const out: ClientToolDescriptorView[] = []
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      warn(`client-bridge: ignored a second client tool named ${tool.name}`)
      continue
    }
    seen.add(tool.name)
    try {
      const descriptor = describeClientTool(tool)
      // SAFETY: a projected tool schema is a JSON Schema object, which is a JSON object.
      out.push({ ...descriptor, inputSchema: descriptor.inputSchema as ClientToolDescriptorView['inputSchema'] })
    } catch (error) {
      warn(`client-bridge: ignored client tool ${tool.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (out.length >= BridgeLimits.maxTools) break
  }
  return out
}

const build = (input: {
  readonly clientId: string
  readonly label: string
  readonly focused: boolean
  readonly visible: boolean
  readonly sessionId: string | undefined
  readonly tools: readonly ClientToolDescriptorView[]
}): WindowState => ({
  clientId: input.clientId,
  label: input.label,
  focused: input.focused,
  visible: input.visible,
  sessionId: input.sessionId ?? null,
  tools: input.tools,
})

export class WindowStateModel {
  static readonly newClientId = newClientId
  static readonly clientIdFor = clientIdFor
  static readonly label = label
  static readonly descriptors = descriptors
  static readonly build = build
}
