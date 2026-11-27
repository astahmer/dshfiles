// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PaletteMath, WARM_STONE, type Oklch } from '@dshfiles/plugin-ui/theme/palette'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { filterTriggerTipAdds, textTruncated, useEditedSuffixFit, useFilterTriggerTip, type FilterTriggerTip } from './list-filter-trigger.js'

afterEach(cleanup)

const client = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.tsx'), 'utf8')
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

  it('says "All threads · edited" on a desktop, the edit in the secondary ink and never cut', () => {
    const edited = trigger.slice(trigger.indexOf('{scopeSlot === null && presetEdited ? ('))
    expect(edited.length).toBeGreaterThan(0)
    const tag = edited.slice(0, edited.indexOf('</span>'))
    expect(tag).toContain('data-filter-trigger-edited=""')
    expect(tag).toContain('dshx:text-muted-foreground')
    expect(tag).toContain('dshx:shrink-0')
    expect(tag).toContain("{`· ${props.tSidebar('threadSidebarPresetEditedShort')}`}")
    // Half the row still (the project picker keeps its room); the suffix is measured, not the trigger widened.
    expect(trigger).toContain("'dshx:max-w-[50%] dshx:min-w-0 dshx:shrink dshx:gap-1 dshx:px-2 dshx:phone:px-3'")
    expect(tag).toContain('ref={filterTriggerSuffixRef}')
    expect(client).toContain('useEditedSuffixFit(filterTriggerParts, scopeSlot === null && presetEdited)')
  })

  // Measured at 1440px: "2 All threads · edited" needs 149px of the row's 231, and the trigger has half of it, so the name
  // read "All t… · edited". The suffix goes first; the name is cut only once it is gone; the badge always shows.
  describe('the edited suffix gives way before the name (council round 34, A4)', () => {
    /** A name span that is cut while the suffix shows in a narrow row, whole otherwise. */
    const parts = (row: { wide: boolean }) => {
      const suffix = document.createElement('span')
      const name = document.createElement('span')
      const cut = (): boolean => !row.wide && suffix.style.display !== 'none'
      Object.defineProperty(name, 'scrollWidth', { get: () => 66 })
      Object.defineProperty(name, 'clientWidth', { get: () => (cut() ? 35 : 66) })
      return { name, suffix }
    }

    /** The trigger's parts in a row, measured by the hook as the client mounts it. */
    const mount = (name: HTMLElement, suffix: HTMLElement): void => {
      const host = document.createElement('div')
      const trigger = document.createElement('button')
      host.append(trigger)
      const refs = { trigger: { current: trigger }, name: { current: name }, suffix: { current: suffix } }
      const Probe = (): null => {
        useEditedSuffixFit(refs, true)
        return null
      }
      render(<Probe />)
    }

    it('hides the suffix at the default width, so the name fits with no ellipsis', () => {
      const { name, suffix } = parts({ wide: false })
      mount(name, suffix)
      expect(suffix.style.display).toBe('none')
      expect(textTruncated(name)).toBe(false)
    })

    it('shows it in a wider sidebar, and measures again whenever the row is resized', () => {
      const row = { wide: true }
      const { name, suffix } = parts(row)
      let resized: (() => void) | undefined
      const original = globalThis.ResizeObserver
      globalThis.ResizeObserver = class {
        constructor(callback: ResizeObserverCallback) {
          resized = () => callback([], this)
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
      try {
        mount(name, suffix)
        expect(suffix.style.display).toBe('')
        // The sidebar narrows to the default width: the suffix goes; widened again, it comes back.
        row.wide = false
        act(() => resized?.())
        expect(suffix.style.display).toBe('none')
        row.wide = true
        act(() => resized?.())
        expect(suffix.style.display).toBe('')
      } finally {
        globalThis.ResizeObserver = original
      }
    })
  })

  /** `over` at `alpha` on an opaque `under`, in gamma sRGB as a browser paints it. */
  const paint = (under: Oklch, over: Oklch): Oklch => {
    const channels = (color: Oklch): readonly number[] => (PaletteMath.toHex(color).slice(1).match(/../g) ?? []).map(pair => Number.parseInt(pair, 16))
    const [u, o] = [channels(under), channels(over)]
    const alpha = over.alpha ?? 1
    return PaletteMath.hexToOklch(`#${u.map((value, i) => Math.round(value * (1 - alpha) + (o[i] ?? 0) * alpha).toString(16).padStart(2, '0')).join('')}`)
  }
  // The tertiary step the council asked for sits 4.47:1 on the light trigger fill: the secondary ink keeps AA.
  it.each(['light', 'dark'] as const)('keeps "· edited" at AA on the trigger fill (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const secondary = p.neutral[9]
    if (secondary === undefined) throw new Error('The palette has no secondary step.')
    for (const surface of [p.neutral[0], p.neutral[1], p.navSurface]) {
      if (surface === undefined) throw new Error('The palette has no such surface.')
      expect(PaletteMath.contrastRatio(secondary, paint(surface, p.triggerFill))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
