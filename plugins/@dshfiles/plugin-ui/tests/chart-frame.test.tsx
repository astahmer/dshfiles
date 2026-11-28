// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Chart, ChartFrame, barY, colorLegend, defineChart, scaleBand, scaleLinear } from '../src/chart.js'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'

afterEach(cleanup)

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')

describe('ChartFrame (round five K5)', () => {
  it('maps the TanStack chart palette onto the data ramp, not the status hues', () => {
    const view = render(
      <ChartFrame title="Tokens">
        <svg />
      </ChartFrame>,
    )
    const classes = view.container.querySelector('figure')!.className
    for (let n = 1; n <= 6; n += 1) expect(classes, `series ${n}`).toContain(`dshx:[--ts-chart-${n}:var(--dshx-data-${n})]`)
    expect(classes).not.toMatch(/--ts-chart-\d:var\(--dsw-alias-state-/)
  })
})

describe('ChartFrame labels (round five A5)', () => {
  /** The kit rule that sets axis and legend text: its selector list and its declarations. */
  const rule = /([^{}]*\.dshx-chart-frame[^{]*)\{([^}]*)\}/u.exec(roles.replace(/\/\*[\s\S]*?\*\//gu, ''))
  const selector = rule?.[1]?.trim() ?? ':not(*)'
  const body = rule?.[2] ?? ''

  const rows = [
    { label: 'Mon', value: 3, key: 'Input' },
    { label: 'Tue', value: 5, key: 'Output' },
  ]
  const definition = defineChart({
    marks: [barY(rows, { x: 'label', y: 'value', color: 'key' })],
    scales: { x: { scale: () => scaleBand<string>().domain(['Mon', 'Tue']) }, y: { scale: scaleLinear, grid: true } },
    color: { domain: ['Input', 'Output'], range: ['var(--dshx-data-1)', 'var(--dshx-data-2)'], legend: colorLegend({ placement: 'bottom' }) },
  })

  it('reads axis ticks and legend labels at full secondary ink, 12px and tabular, and leaves the gridlines alone', () => {
    const view = render(
      <ChartFrame title="Tokens">
        <Chart ariaLabel="Tokens" definition={definition} height={200} />
      </ChartFrame>,
    )
    const figure = view.container.querySelector('figure')!
    expect(figure.classList.contains('dshx-chart-frame')).toBe(true)
    expect(figure.className).toContain('dshx:text-muted-foreground')
    const texts = [...figure.querySelectorAll('text')]
    const ticks = texts.filter(node => node.getAttribute('data-ts-key')?.includes('tick-label'))
    const legend = texts.filter(node => node.getAttribute('data-ts-key')?.startsWith('legend-label'))
    expect(ticks.length).toBeGreaterThan(0)
    expect(legend.map(node => node.textContent)).toEqual(['Input', 'Output'])
    // The library draws them at 68–78% opacity of currentColor (2.95:1 measured): the kit rule must reach every one.
    for (const node of [...ticks, ...legend]) {
      expect(node.getAttribute('fill-opacity'), node.getAttribute('data-ts-key') ?? '').not.toBe('1')
      expect(node.matches(selector), node.getAttribute('data-ts-key') ?? '').toBe(true)
    }
    for (const line of figure.querySelectorAll('line[data-ts-key*="grid"]')) expect(line.matches(selector)).toBe(false)
    expect(body).toMatch(/fill-opacity:\s*1;/u)
    expect(body).toMatch(/font-size:\s*var\(--dshx-density-text-meta\);/u)
    expect(body).toMatch(/font-variant-numeric:\s*tabular-nums;/u)
  })

  it('reaches every other axis and legend text at 12px minimum, and the frame itself never drops below 12px (council round 10 A8)', () => {
    const view = render(
      <ChartFrame title="Tokens">
        <svg>
          {['x-label', 'y-label', 'legend-step-label:0:5', 'legend-gradient:min', 'legend-gradient:max', 'facet:Mon:label'].map(key => (
            <text key={key} data-ts-key={key}>
              {key}
            </text>
          ))}
          <text data-ts-key="interactive-legend-label:Input">Input</text>
          <text data-ts-key="bar:Mon">3</text>
        </svg>
      </ChartFrame>,
    )
    const figure = view.container.querySelector('figure')!
    // The frame's own text (a caption, an HTML legend a plugin draws) is the 12px meta step, never the 11px minimum.
    expect(figure.className).toContain('dshx:text-xs')
    expect(figure.className).not.toContain('dshx:text-2xs')
    for (const node of figure.querySelectorAll('text:not([data-ts-key^="interactive"]):not([data-ts-key^="bar"])'))
      expect(node.matches(selector), node.getAttribute('data-ts-key') ?? '').toBe(true)
    // The interactive legend keeps its own dimmed hidden-series opacity; it takes the size only.
    const interactive = figure.querySelector('[data-ts-key^="interactive-legend-label"]')!
    expect(interactive.matches(selector)).toBe(false)
    const sizeOnly = /([^{}]*interactive-legend-label[^{]*)\{([^}]*)\}/u.exec(roles.replace(/\/\*[\s\S]*?\*\//gu, ''))
    expect(interactive.matches(sizeOnly?.[1]?.trim() ?? ':not(*)')).toBe(true)
    expect(sizeOnly?.[2]).toMatch(/font-size:\s*var\(--dshx-density-text-meta\);/u)
    expect(sizeOnly?.[2]).not.toMatch(/fill-opacity/u)
    // A value label on a mark is not an axis or legend label.
    expect(figure.querySelector('[data-ts-key="bar:Mon"]')!.matches(selector)).toBe(false)
  })

  const schemes: readonly Scheme[] = ['light', 'dark']
  it.each(schemes)('holds that ink at AA where charts sit (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const step of [0, 1, 2]) expect(PaletteMath.contrastRatio(p.neutral[9]!, p.neutral[step]!)).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.toHex(p.neutral[9]!)).toBe(scheme === 'light' ? '#646362' : '#a7a4a1')
  })
})
