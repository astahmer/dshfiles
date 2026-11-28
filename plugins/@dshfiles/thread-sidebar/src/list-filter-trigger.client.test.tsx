// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { filterTriggerTipAdds, useFilterTriggerTip, type FilterTriggerTip } from './list-filter-trigger.js'

afterEach(cleanup)

const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(join(here, 'client.tsx'), 'utf8')
const triggerModule = readFileSync(join(here, 'list-filter-trigger.ts'), 'utf8')
const filterControl = client.slice(client.indexOf('const filterMenu = ('), client.indexOf('<TooltipProvider delayDuration={500}>'))
const trigger = filterControl.slice(filterControl.indexOf('<PopoverTrigger asChild>'), filterControl.indexOf('</PopoverTrigger>'))

// Council round 34, A4 (round-33 follow-ups, item 1): the closed trigger read "2 All threads" with a tooltip that repeated
// its accessible name on every hover, opened again on the focus the panel gave back as it closed, and sat over the rows.
describe('the closed Filters trigger (council round 34, A4)', () => {
  it('shows its tooltip only when it adds something: a count, an edit or a cut name', () => {
    expect(filterTriggerTipAdds({ count: null, edited: false, truncated: false })).toBe(false)
    expect(filterTriggerTipAdds({ count: 2, edited: false, truncated: false })).toBe(true)
    expect(filterTriggerTipAdds({ count: null, edited: true, truncated: false })).toBe(true)
    expect(filterTriggerTipAdds({ count: null, edited: false, truncated: true })).toBe(true)
  })

  it('stays quiet on the focus the closing panel gives back, until the pointer or focus leaves the trigger', () => {
    let tip: FilterTriggerTip | undefined
    const report = (next: FilterTriggerTip): void => {
      tip = next
    }
    const Probe = (props: { readonly panelOpen: boolean; readonly adds: boolean; readonly onTip: (tip: FilterTriggerTip) => void }): null => {
      props.onTip(useFilterTriggerTip({ panelOpen: props.panelOpen, enabled: true, adds: () => props.adds }))
      return null
    }
    const view = render(<Probe panelOpen={false} adds onTip={report} />)
    const current = (): FilterTriggerTip => {
      if (tip === undefined) throw new Error('The probe did not render.')
      return tip
    }
    // A hover before the panel ever opened shows it.
    act(() => current().onOpenChange(true))
    expect(current().open).toBe(true)
    // Open the panel: closed, and focus moving into the panel does not release the quiet.
    view.rerender(<Probe panelOpen adds onTip={report} />)
    expect(current().open).toBe(false)
    act(() => current().release())
    // Escape: the panel closes and gives focus back to the trigger, whose focus asks the tooltip to open.
    view.rerender(<Probe panelOpen={false} adds onTip={report} />)
    act(() => current().onOpenChange(true))
    expect(current().open).toBe(false)
    // The pointer leaves (or focus moves on): the next hover shows it again.
    act(() => current().release())
    act(() => current().onOpenChange(true))
    expect(current().open).toBe(true)
  })

  it('never opens when it would only repeat the trigger', () => {
    let tip: FilterTriggerTip | undefined
    const report = (next: FilterTriggerTip): void => {
      tip = next
    }
    const Probe = (props: { readonly onTip: (tip: FilterTriggerTip) => void }): null => {
      props.onTip(useFilterTriggerTip({ panelOpen: false, enabled: true, adds: () => false }))
      return null
    }
    render(<Probe onTip={report} />)
    act(() => tip?.onOpenChange(true))
    expect(tip?.open).toBe(false)
  })

  it('wires the trigger to that rule, beside the list rather than over it, with no description restating its name', () => {
    expect(filterControl).toContain('<Tooltip open={filterTip.open} onOpenChange={filterTip.onOpenChange}>')
    expect(client).toContain('enabled: scopeSlot === null && !coarsePointer()')
    expect(filterControl).toMatch(/<TooltipContent side="right"[^>]*data-thread-list-filter-tooltip=""/u)
    expect(filterControl).not.toMatch(/<TooltipContent side="bottom"[^>]*data-thread-list-filter-tooltip/u)
    expect(trigger).toContain('aria-describedby={undefined}')
    expect(trigger).toContain('onPointerLeave={filterTip.release}')
    expect(trigger).toContain('onBlur={filterTip.release}')
  })

  // Council round 35 P5 (all three seats): the "· edited" suffix never showed at the default width (it gave way so the
  // name stayed whole), so it is gone. The count badge, the tooltip and the accessible name still say the preset is edited.
  it('draws no "· edited" suffix; the badge, the tooltip and the accessible name say it', () => {
    expect(trigger).not.toContain('data-filter-trigger-edited')
    expect(trigger).not.toContain('threadSidebarPresetEditedShort')
    expect(client).not.toMatch(/useEditedSuffixFit|filterTriggerSuffixRef|filterTriggerParts/u)
    expect(triggerModule).not.toMatch(/EditedSuffix/u)
    // The count badge on a desktop.
    expect(trigger).toContain('data-testid="thread-scope-count"')
    // The accessible name (and the tooltip, which shows it): "Filter: All threads (edited), 2 filters on".
    expect(client).toContain("props.tSidebar('threadSidebarPresetEdited', { name: activePresetLabel })")
    expect(trigger).toContain('aria-label={filterTriggerLabel}')
    expect(filterControl).toContain('{filterTriggerLabel}')
    // An edit alone is reason enough for the tooltip.
    expect(filterTriggerTipAdds({ count: null, edited: true, truncated: false })).toBe(true)
    // The name keeps the trigger's half of the row.
    expect(trigger).toContain("'dshx:max-w-[50%] dshx:min-w-0 dshx:shrink dshx:gap-1 dshx:px-2 dshx:phone:px-3'")
  })
})
