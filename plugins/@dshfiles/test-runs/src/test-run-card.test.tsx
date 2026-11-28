import { readFileSync } from 'node:fs'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { TestRunCard } from './test-run-card.js'
import { VitestReport } from './vitest-report.js'

// The Host's row draws the status icon, the title and the collapsed line; its content renders here open or not.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  writeClipboard: async () => undefined,
  DisclosureRow: (props: { readonly icon: ReactNode; readonly title: string; readonly collapsedContent: ReactNode; readonly children?: ReactNode }) => (
    <div>
      <span data-row-icon="">{props.icon}</span>
      {props.title}
      {props.collapsedContent}
      {props.children}
    </div>
  ),
}))

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** A verbose all-pass run over two files, so the card lists passed files. */
const ALL_PASS = [
  '',
  ' RUN  v4.1.11 /repo/shop',
  '',
  ' ✓ src/cart/pricing.test.ts > applyCoupon > takes 10% off the subtotal 2ms',
  ' ✓ src/lib/money.test.ts > adds cents 5ms',
  '',
  ' Test Files  2 passed (2)',
  '      Tests  2 passed (2)',
  '   Duration  1.10s',
].join('\n')

const card = (name: string): string => {
  const run = VitestReport.parse(`${name === 'all-pass' ? ALL_PASS : fixture(name)}\n[exit code: 0]`)
  if (run === undefined) throw new Error(`${name} has no run`)
  return renderToStaticMarkup(<TestRunCard actions={undefined} openFailures={false} openFile={() => undefined} run={run} />)
}

/** Status glyphs drawn in the success colour (the diff's "-" marker is text, not a glyph). */
const greenGlyphs = (html: string): number => (html.match(/<svg[^>]*dshx:text-success/gu) ?? []).length

describe('a test run card', () => {
  it('leads an all-pass run with one green check: the card status, not every passed file', () => {
    const html = card('all-pass')
    expect(html).toContain('money.test.ts')
    expect(html).toMatch(/data-row-icon=""><svg[^>]*dshx:text-success/u)
    expect(greenGlyphs(html)).toBe(1)
  })

  it('draws the counts in ink and only a failure count red', () => {
    const passing = card('vitest-pass.txt')
    const counts = [...passing.matchAll(/data-tool-card-timing="own">([\s\S]*?)<\/span><\/span>/gu)].map(match => match[1] ?? '')
    expect(counts.join('')).not.toMatch(/text-muted-foreground/u)
    expect(counts.join('')).toMatch(/dshx:text-foreground/u)
    const failing = card('vitest-default.txt')
    expect(failing).toMatch(/<span class="dshx:text-destructive">2 failed<\/span>/u)
    // A failing run confirms nothing: its passed files are not green either.
    expect(greenGlyphs(failing)).toBe(0)
  })
})
