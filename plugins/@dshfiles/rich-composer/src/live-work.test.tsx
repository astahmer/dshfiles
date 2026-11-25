// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LiveWork, LiveWorkSummary, useLiveWorkCounts } from './live-work.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'native/skeleton/ConversationRoot.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const DOCK = ":global([data-slot='conversation.input.dock'])"

/** The body of every rule inside `@media (max-width: 27.99rem)`, keyed by selector. */
const narrowRules = (): Map<string, string> => {
  const start = css.indexOf('@media (max-width: 27.99rem)')
  const rules = new Map<string, string>()
  if (start < 0) return rules
  let depth = 0
  let end = start
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) {
      end = index
      break
    }
  }
  const block = css.slice(css.indexOf('{', start) + 1, end)
  for (const match of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.set((match[1] ?? '').trim(), match[2] ?? '')
  return rules
}

const jobRow = '<section data-dshfiles-live-preview="job" data-dshfiles-live-preview-seat="dock"></section>'
const agentRow = '<section data-dshfiles-live-preview="agent" data-dshfiles-live-preview-seat="dock"></section>'
const markup = (inner: string): HTMLElement => {
  const dock = document.createElement('div')
  dock.setAttribute('data-slot', 'conversation.input.dock')
  dock.innerHTML = inner
  return dock
}
const english = (key: string, params: { readonly count: number }): string =>
  ({ 'liveWork.job': '{count} job', 'liveWork.jobs': '{count} jobs', 'liveWork.subagent': '{count} subagent', 'liveWork.subagents': '{count} subagents' })[key]!.replace(
    '{count}',
    String(params.count),
  )

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('Live work on a narrow phone (unslop r5 C1)', () => {
  it('counts the rows the job and subagent docks render, and a closed fold by its stated count', () => {
    const dock = markup(
      `<div data-dshfiles-live-preview-dock="jobs">${jobRow}</div><div data-dshfiles-live-preview-dock="subagents">${agentRow}</div>`,
    )
    expect(LiveWork.count(dock)).toEqual({ jobs: 1, subagents: 1 })
    const folded = markup(
      '<div data-dshfiles-live-preview-dock="jobs"><button data-dshfiles-live-preview-fold="jobs"><svg></svg><span>3 running</span><span>4m 02s</span></button></div>',
    )
    expect(LiveWork.count(folded)).toEqual({ jobs: 3, subagents: 0 })
    expect(LiveWork.count(markup('<div data-todo=""></div>'))).toEqual({ jobs: 0, subagents: 0 })
  })

  it('says "1 job · 1 subagent", plural where it counts more, and drops a zero part', () => {
    expect(LiveWork.detail({ jobs: 1, subagents: 1 }, english)).toBe('1 job · 1 subagent')
    expect(LiveWork.detail({ jobs: 2, subagents: 0 }, english)).toBe('2 jobs')
    expect(LiveWork.detail({ jobs: 0, subagents: 4 }, english)).toBe('4 subagents')
  })

  it('counts the outlet live under 28rem and draws one 44px disclosure; nothing without live work', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 27.99rem)', addEventListener: () => undefined, removeEventListener: () => undefined }))
    const host = document.createElement('div')
    document.body.append(host)
    const Stack = () => {
      const ref = useRef<HTMLDivElement>(null)
      const counts = useLiveWorkCounts(ref)
      return (
        <div ref={ref}>
          <LiveWorkSummary counts={counts} open={false} onToggle={() => undefined} label="Live work" detail={LiveWork.detail(counts, english)} />
          <div data-slot="conversation.input.dock" />
        </div>
      )
    }
    const root = createRoot(host)
    await act(async () => root.render(<Stack />))
    expect(host.querySelector('[data-live-work-summary]')).toBeNull()
    await act(async () => {
      host.querySelector("[data-slot='conversation.input.dock']")!.innerHTML =
        `<div data-dshfiles-live-preview-dock="jobs">${jobRow}</div><div data-dshfiles-live-preview-dock="subagents">${agentRow}</div>`
      await Promise.resolve()
    })
    const summary = host.querySelector('[data-live-work-summary]')
    expect(summary?.textContent).toBe('Live work·1 job · 1 subagent')
    expect(summary?.getAttribute('aria-expanded')).toBe('false')
    expect(summary?.className).toContain('dshx:h-11')
    await act(async () => root.unmount())
  })

  it('hides live work behind the closed summary and gives every dock entry the full width below 28rem', () => {
    const rules = narrowRules()
    const phone = ':global(html[data-shell-phone-nav])'
    expect(rules.get(`${phone} .liveWork`)).toMatch(/display:\s*flex/)
    expect(rules.get(`${phone} .composerStack > ${DOCK} > *`)).toMatch(/flex-basis:\s*100%/)
    const closed = `${phone} .composerStack:has(> .liveWork):not([data-live-work-open]) > ${DOCK}`
    expect(rules.get(`${closed} > :global([data-dshfiles-live-preview-dock])`)).toMatch(/display:\s*none/)
    // Outside the narrow phone the summary never shows.
    expect(css).toMatch(/\n\.liveWork \{\s*display: none;\s*\}/)
  })
})
