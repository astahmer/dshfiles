import type { Health } from '@dshfiles/plugin-ui/components/ui/status-dot'
import type { StatusGlyphState } from '@dshfiles/plugin-ui/components/work-status'
import type { RuntimeSummary } from '../api.js'

/**
 * A host is a resource that is up or down, so it shows one health dot (DESIGN.md › Colour roles 4): green connected,
 * a faint ring when idle or never connected, red on error. Its label carries the recovery step.
 */
const hostHealth = (tone: HostState['tone']): Health => (tone === 'error' ? 'down' : tone === 'online' ? 'ok' : 'off')

/** A connection-test step: passed is the muted check, failed the red cross. */
const stepGlyph = (ok: boolean): StatusGlyphState => (ok ? 'done' : 'failed')

/** Status of one host as the chip, the dialog and the Hosts page show it: plain words, with a next step when it needs one. */
export type HostState = { readonly tone: 'online' | 'idle' | 'error'; readonly label: string }

const hostState = (runtime: RuntimeSummary | undefined): HostState => {
  if (runtime === undefined) return { tone: 'error', label: 'Not set up yet. Edit this host to set its DSH home.' }
  if (runtime.connected) return { tone: 'online', label: 'Connected' }
  if (runtime.lastError !== undefined) return { tone: 'error', label: runtime.lastError.message }
  return { tone: 'idle', label: runtime.lastSeenAt === undefined ? 'Not connected yet' : `Idle · last seen ${new Date(runtime.lastSeenAt).toLocaleString()}` }
}

/** How a host's connection reads: its state words, its health dot, and a connection-test step's glyph. */
export class HostStatus {
  static readonly state = hostState
  static readonly health = hostHealth
  static readonly stepGlyph = stepGlyph
}
