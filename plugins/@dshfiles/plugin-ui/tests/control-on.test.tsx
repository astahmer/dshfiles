// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Checkbox } from '../src/components/ui/checkbox.js'
import { RadioGroup, RadioGroupItem } from '../src/components/ui/radio-group.js'
import { Switch } from '../src/components/ui/switch.js'

afterEach(cleanup)

const classes = (element: Element | null): readonly string[] => (element?.getAttribute('class') ?? '').split(/\s+/)

/** DESIGN.md › Colour roles 6: the on state of a switch, checkbox or radio is the accent (`control-on`), not ink. */
describe('control on state', () => {
  it('fills a checked switch track with control-on and keeps a full-size background knob in dark', () => {
    const view = render(<Switch checked onCheckedChange={() => undefined} aria-label="On" />)
    const track = classes(view.container.querySelector('[data-slot="switch"]'))
    expect(track).toContain('dshx:data-[state=checked]:bg-control-on')
    expect(track.join(' ')).not.toMatch(/checked\]:bg-primary\b/)
    // Only the colours and the knob move, in the 120ms fade, never `transition-all` (layout would animate too).
    expect(track).not.toContain('dshx:transition-all')
    expect(track).toContain('dshx:transition-[background-color,transform]')
    expect(track).toContain('dshx:duration-(--dshx-duration-fade)')
    const knob = classes(view.container.querySelector('[data-slot="switch-thumb"]'))
    expect(knob).toContain('dshx:bg-background')
    expect(knob.join(' ')).not.toMatch(/scale-75|checked\]:bg-primary-foreground/)
    expect(knob).toContain('dshx:duration-(--dshx-duration-fade)')
  })

  it('fills a checked checkbox with control-on in both schemes', () => {
    const view = render(<Checkbox checked aria-label="On" />)
    const box = classes(view.container.querySelector('[data-slot="checkbox"]'))
    expect(box).toEqual(expect.arrayContaining(['dshx:data-[state=checked]:border-control-on', 'dshx:data-[state=checked]:bg-control-on', 'dshx:dark:data-[state=checked]:bg-control-on']))
    expect(box.join(' ')).not.toMatch(/checked\]:(?:bg|border)-primary\b/)
    expect(box).toContain('dshx:duration-(--dshx-duration-fade)')
  })

  it('draws a checked radio in control-on', () => {
    const view = render(
      <RadioGroup value="a" aria-label="Pick">
        <RadioGroupItem value="a" aria-label="A" />
      </RadioGroup>,
    )
    const item = classes(view.container.querySelector('[data-slot="radio-group-item"]'))
    expect(item).toEqual(expect.arrayContaining(['dshx:text-control-on', 'dshx:data-[state=checked]:border-control-on']))
    expect(item).not.toContain('dshx:text-primary')
    const dot = view.container.querySelector('[data-slot="radio-group-indicator"] svg')
    expect(classes(dot)).toContain('dshx:fill-control-on')
  })
})
