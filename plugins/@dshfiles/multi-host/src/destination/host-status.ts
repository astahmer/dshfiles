import type { StatusGlyphState } from '@dshfiles/plugin-ui/components/work-status'

/**
 * A host on the shared status vocabulary. A connected host is quiet (the faint ring), one that never connected or
 * was last seen a while ago is the dashed ring, and only a failed one is coloured.
 */
export const hostGlyph = (tone: 'online' | 'idle' | 'error'): StatusGlyphState => (tone === 'error' ? 'failed' : tone === 'online' ? 'idle' : 'stale')

/** A connection-test step: passed is the muted check, failed the red cross. */
export const stepGlyph = (ok: boolean): StatusGlyphState => (ok ? 'done' : 'failed')
