import type { StatusGlyphState } from '@dshfiles/plugin-ui/components/work-status'
import type { RuntimeSummary } from '../api.js'

/**
 * A host on the shared status vocabulary. A connected host is quiet (the faint ring), one that never connected or
 * was last seen a while ago is the dashed ring, and only a failed one is coloured.
 */
export const hostGlyph = (tone: 'online' | 'idle' | 'error'): StatusGlyphState => (tone === 'error' ? 'failed' : tone === 'online' ? 'idle' : 'stale')

/** A connection-test step: passed is the muted check, failed the red cross. */
export const stepGlyph = (ok: boolean): StatusGlyphState => (ok ? 'done' : 'failed')

/** Status of one host as the chip, the dialog and the Hosts page show it: plain words, with a next step when it needs one. */
export const hostState = (runtime: RuntimeSummary | undefined): { readonly tone: 'online' | 'idle' | 'error'; readonly label: string } => {
  if (runtime === undefined) return { tone: 'error', label: 'Not set up yet. Edit this host to set its DSH home.' }
  if (runtime.connected) return { tone: 'online', label: 'Connected' }
  if (runtime.lastError !== undefined) return { tone: 'error', label: runtime.lastError.message }
  return { tone: 'idle', label: runtime.lastSeenAt === undefined ? 'Not connected yet' : `Idle · last seen ${new Date(runtime.lastSeenAt).toLocaleString()}` }
}
