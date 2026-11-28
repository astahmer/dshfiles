import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const glyph = readFileSync(new URL('./inbox-glyph.tsx', import.meta.url), 'utf8')

// Round five C4 (council round 4): the Inbox count was a black (light) / white (dark) blob drawn over the glyph's
// top-right corner. It is the kit's attention badge (A3), seated beside the glyph in its trailing corner.
describe('the Inbox count on the rail and the phone tab bar', () => {
  it("is the kit's attention badge, not a primary-ink blob", () => {
    expect(glyph).toMatch(/import \{ AttentionBadge \} from '@dshfiles\/plugin-ui\/components\/ui\/attention-badge'/u)
    expect(glyph).toMatch(/<AttentionBadge\s[^>]*count=\{count\}/u)
    expect(glyph).not.toMatch(/dshx:bg-primary/u)
  })

  it("sits past the glyph's trailing edge, never over it", () => {
    const badge = /<AttentionBadge\s[^>]*className="([^"]*)"/u.exec(glyph)?.[1] ?? ''
    expect(badge).toContain('dshx:absolute')
    expect(badge).toContain('dshx:left-full')
    expect(badge).not.toMatch(/-right-/u)
  })
})
