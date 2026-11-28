import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { createEffortCommitter, EFFORT_SETTLE_MS, EffortControl } from '../src/effort-control.js'
import { ModelPickerModel } from '../src/model-picker-model.js'

const levels = ['Off', 'Minimal', 'Low', 'Medium', 'High', 'Xhigh', 'Max'].map(name => ({ id: name.toLowerCase(), name, description: '' }))

const render = (selected: string | undefined, efforts = levels): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <EffortControl efforts={efforts} onChange={() => undefined} selected={selected} />
    </TooltipProvider>,
  )

const text = (html: string): string => html.replace(/<[^>]+>/gu, '')

const radios = (html: string): string[] => [...html.matchAll(/<button[^>]*role="radio"[^>]*>(.*?)<\/button>/gu)].map(match => match[0])

describe('reasoning effort is a discrete, truthful choice (council picker C1)', () => {
  it('names every level with a short label', () => {
    expect(levels.map(effort => ModelPickerModel.effortShortLabel(effort))).toEqual(['Off', 'Min', 'Low', 'Med', 'High', 'XHigh', 'Max'])
    expect(ModelPickerModel.effortShortLabel({ id: 'turbo-plus', name: 'Turbo plus' })).toBe('Turbo plus')
  })

  it('is one radio per supported level after Auto, 28 px tall and 44 px on touch, with no slider', () => {
    const html = render('medium')
    const options = radios(html)
    expect(options).toHaveLength(8)
    for (const option of options) {
      expect(option).toMatch(/dshx:h-7/u)
      expect(option).toMatch(/dshx:pointer-coarse:h-11/u)
    }
    expect(html).toContain('role="radiogroup"')
    expect(html).not.toContain('role="slider"')
    expect(options.filter(option => option.includes('aria-checked="true"'))).toHaveLength(1)
    expect(options.find(option => option.includes('aria-checked="true"'))).toContain('>Med<')
  })

  it('says the selected level in the heading', () => {
    expect(text(render('medium'))).toContain('Reasoning effort · Medium')
  })

  it('says "No reasoning levels" when the model has none, with no radio group (round 4 T15)', () => {
    const html = render(undefined, [])
    expect(text(html)).toBe('Reasoning effortNo reasoning levels')
    expect(html).not.toContain('role="radiogroup"')
    expect(/<p[^>]*>No reasoning levels<\/p>/u.exec(html)?.[0]).toContain('dshx:text-muted-foreground')
  })
})

describe('the provider default is a real option, and arrowing commits only where it rests (council picker round 3, R6)', () => {
  it('makes "Auto" the first radio, named "Provider default", checked when the thread leaves effort to the provider', () => {
    const options = radios(render(undefined))
    expect(options[0]).toContain('aria-label="Auto, provider default"')
    expect(options[0]).toContain('>Auto<')
    expect(options[0]).toContain('aria-checked="true"')
    expect(options.filter(option => option.includes('aria-checked="true"'))).toHaveLength(1)
    expect(text(render(undefined))).toContain('Reasoning effort · Provider default')
  })

  it('always has exactly one checked radio, and no orphan default button outside the group', () => {
    for (const selected of [undefined, 'off', 'max', 'unknown-level']) {
      const html = render(selected)
      expect(radios(html).filter(option => option.includes('aria-checked="true"'))).toHaveLength(1)
      expect(html).not.toMatch(/aria-pressed/u)
    }
  })

  it('wraps on touch without a hole: one row up to seven segments on a 324 px track, else four to a row (round 4 T8)', () => {
    expect(/<div[^>]*role="radiogroup"[^>]*>/u.exec(render('low'))?.[0]).toContain('dshx:pointer-coarse:flex dshx:pointer-coarse:flex-wrap')
    const seven = radios(render('low', levels.slice(0, 6)))
    expect(seven).toHaveLength(7)
    for (const option of seven) {
      expect(option).toMatch(/dshx:pointer-coarse:min-w-11 dshx:pointer-coarse:flex-1/u)
      expect(option).toMatch(/dshx:pointer-coarse:basis-0 dshx:@max-\[20\.25rem\]\/effort:pointer-coarse:basis-1\/4/u)
    }
    // Round 5 U10: eight segments share one row from a 356 px track, else four to a row.
    for (const option of radios(render('low'))) expect(option).toMatch(/dshx:pointer-coarse:basis-1\/4 dshx:@min-\[22\.25rem\]\/effort:pointer-coarse:basis-0/u)
  })

  it('applies only the level arrowing settles on, at once on Enter, Space, a click or leaving the group', () => {
    const commits: (string | undefined)[] = []
    const timers: { run: () => void; ms: number; cancelled: boolean }[] = []
    const committer = createEffortCommitter({
      commit: value => commits.push(value),
      schedule: (run, ms) => {
        const timer = { run, ms, cancelled: false }
        timers.push(timer)
        return () => {
          timer.cancelled = true
        }
      },
    })
    for (const level of ['min', 'low', 'medium', 'high']) committer.preview(level)
    expect(commits).toEqual([])
    expect(timers.filter(timer => !timer.cancelled)).toHaveLength(1)
    const live = timers.find(timer => !timer.cancelled)
    expect(live?.ms).toBe(EFFORT_SETTLE_MS)
    live?.run()
    expect(commits).toEqual(['high'])

    committer.preview('max')
    committer.commitNow('max')
    expect(commits).toEqual(['high', 'max'])
    expect(timers.at(-1)?.cancelled).toBe(true)

    committer.preview(undefined)
    committer.flush()
    committer.flush()
    expect(commits).toEqual(['high', 'max', undefined])
  })

  it('names each radio with its visible word inside, and the group by its subject (round 4 T4)', () => {
    const html = render('medium')
    for (const option of radios(html)) {
      const label = /aria-label="([^"]*)"/u.exec(option)?.[1] ?? ''
      const visible = option.replace(/<[^>]+>/gu, '')
      expect([visible, label.toLowerCase().includes(visible.toLowerCase())]).toEqual([visible, true])
    }
    expect(/<div[^>]*role="radiogroup"[^>]*>/u.exec(html)?.[0]).toContain('aria-label="Reasoning effort"')
    expect(/<div[^>]*role="radiogroup"[^>]*>/u.exec(html)?.[0]).not.toContain('aria-labelledby')
  })

  it('sets touch segments edge to edge at 13 px, so eight fit one row at 44 pt (round 5 U10)', () => {
    expect(/<div[^>]*role="radiogroup"[^>]*>/u.exec(render('low'))?.[0]).toContain('dshx:pointer-coarse:gap-0')
    for (const option of radios(render('low'))) expect(option).toMatch(/dshx:pointer-coarse:min-w-11[\s\S]*dshx:pointer-coarse:text-sm/u)
  })
})
