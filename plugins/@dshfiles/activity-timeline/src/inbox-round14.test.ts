import { readFileSync } from 'node:fs'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'
import { INBOX_CHIP } from './triage-stage.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')

describe('the phone failed card\'s Review (council round 14 C2)', () => {
  it('is drawn 44pt tall on a touch screen, 28px on a desktop', () => {
    const merged = cn(INBOX_CHIP, cn('dshx:shrink', InboxView.HEAD_VERB))
    expect(merged).toContain('dshx:pointer-coarse:h-11')
    expect(merged).not.toContain('pointer-coarse:h-7')
    expect(merged).toContain('dshx:h-7')
  })

  it('sits centred in the 52px head band (4px above and below), so the head and the card keep their height', () => {
    // 6px head padding less 2px each side: a 44pt seat takes the band's 40px inner height, no more.
    const seat = cn(InboxView.HEAD_SEAT, InboxView.HEAD_SEAT_VERB)
    expect(seat).toContain('dshx:@max-pane-narrow:-my-0.5!')
    expect(seat).not.toContain('dshx:@max-pane-narrow:-my-2!')
    // Only a touch screen's head that holds a verb (a bodyless failed card): a ⋯ alone stays level with the title.
    expect(panel).toContain('className={cn(InboxView.HEAD_SEAT, phone && !footed && InboxView.HEAD_SEAT_VERB)}')
  })
})
