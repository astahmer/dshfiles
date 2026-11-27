import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { SegmentedFilter } from './segmented-filter.js'

const read = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

afterEach(() => {
  document.body.replaceChildren()
})

describe('segmented filter (DESIGN.md: one segmented control)', () => {
  it('draws the kit segmented control: the raised track at the control height and one selected thumb', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        <SegmentedFilter
          label="Source"
          onChange={() => {}}
          optionAttribute="data-origin-option"
          options={[
            { id: 'all', label: 'All', count: 3 },
            { id: 'dsh', label: 'DSH', count: 1 },
          ]}
          value="all"
        />,
      ),
    )
    const track = container.querySelector('[role="group"]')
    for (const token of ['dshx:bg-muted', 'dshx:h-(--dshx-control-h)', 'dshx:p-[3px]', 'dshx:rounded-lg']) expect(track?.className).toContain(token)
    const selected = container.querySelector('[aria-pressed="true"]')
    expect(selected?.className).toContain('dshx:segment-thumb')
    expect(selected?.className).toContain('dshx:font-selected')
    expect(container.querySelector('[aria-pressed="false"]')?.className).not.toContain('segment-thumb')
    // Not a second segmented look of its own: no shadow thumb, no numeric duration.
    expect(read('segmented-filter.tsx')).not.toMatch(/shadow-s1|duration-\d/u)
    act(() => root.unmount())
  })

  it('keeps Plugins by category on the design tokens: sentence-case heads, 8px cards, a guarded spinner', () => {
    const page = read('dshfiles-plugins-page.tsx')
    expect(page).not.toContain('dshx:uppercase')
    expect(page).not.toContain('dshx:rounded-xl')
    expect(page).not.toMatch(/duration-\d/u)
    expect(page).toContain('dshx:motion-safe:animate-spin')
    expect(page).not.toMatch(/'dshx:animate-spin'/u)
  })
})
