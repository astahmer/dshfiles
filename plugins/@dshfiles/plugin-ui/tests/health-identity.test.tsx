// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { agentToneGlow, agentToneSoft, agentToneSolid } from '../src/components/motion/agent-avatar.js'
import { StatusIcon } from '../src/components/tool-card.js'
import { HealthDot, healthTextClass } from '../src/components/ui/status-dot.js'

afterEach(cleanup)

const classes = (element: Element | null): readonly string[] => (element?.getAttribute('class') ?? '').split(/\s+/)

describe('HealthDot (DESIGN.md › Colour roles 4)', () => {
  it('draws one dot per health: green connected, amber limited, red down, a faint ring when off', () => {
    const view = render(
      <>
        <HealthDot health="ok" aria-label="Connected" />
        <HealthDot health="limited" aria-label="Rate limited" />
        <HealthDot health="down" aria-label="Signed out" />
        <HealthDot health="off" aria-label="Off" />
      </>,
    )
    const dot = (name: string): Element => view.getByRole('img', { name })
    expect(classes(dot('Connected'))).toContain('dshx:bg-health-ok')
    expect(classes(dot('Rate limited'))).toContain('dshx:bg-health-limited')
    expect(classes(dot('Signed out'))).toContain('dshx:bg-health-down')
    expect(classes(dot('Off'))).toEqual(expect.arrayContaining(['dshx:border', 'dshx:border-health-off']))
    expect(classes(dot('Off')).join(' ')).not.toMatch(/(?:^| )dshx:bg-/)
    expect(dot('Connected').getAttribute('data-health')).toBe('ok')
    expect(dot('Connected').getAttribute('data-slot')).toBe('status-dot')
  })

  it('is decorative without a label', () => {
    const view = render(<HealthDot health="ok" />)
    expect(view.container.querySelector('[data-slot="status-dot"]')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps a healthy label muted and colours it only when not healthy', () => {
    expect(healthTextClass.ok).toBe('dshx:text-muted-foreground')
    expect(healthTextClass.off).toBe('dshx:text-muted-foreground')
    expect(healthTextClass.limited).toBe('dshx:text-health-limited')
    expect(healthTextClass.down).toBe('dshx:text-health-down')
  })
})

describe('agent tones (DESIGN.md › Colour roles 5)', () => {
  it('wear identity hues, never a status or chart hue', () => {
    for (const table of [agentToneSoft, agentToneSolid, agentToneGlow]) {
      for (const [tone, value] of Object.entries(table)) {
        expect(value, tone).not.toMatch(/chart-|info|success|warning|destructive|violet|teal/)
        if (tone !== 'muted') expect(value, tone).toMatch(/identity-[1-8]/)
      }
    }
    // The key names stay, so callers that pass `tone="chart-4"` keep compiling.
    expect(Object.keys(agentToneSoft)).toEqual(['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'violet', 'teal', 'muted'])
  })

  it('gives every named tone its own identity hue', () => {
    const hues = Object.entries(agentToneSolid)
      .filter(([tone]) => tone !== 'muted')
      .map(([, value]) => value)
    expect(new Set(hues).size).toBe(hues.length)
  })
})

describe('ToolCard status (DESIGN.md › Colour roles 3)', () => {
  it('confirms a passed step with a green check', () => {
    const view = render(<StatusIcon status="passed" />)
    expect(classes(view.container.querySelector('svg'))).toContain('dshx:text-success')
  })
})
