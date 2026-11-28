// @vitest-environment jsdom
/**
 * The marker rule (council round 11 A1): a selected row whose first visual is a glyph, tile or mark draws no selection
 * pill; the wash and the 550 title carry the selection (Linear, Things). The pill stays on plain-text rows. Checked by
 * matching rendered kit rows against the compiled sheet's own `selected-marker` selector, so what the test proves is
 * what the browser runs.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import type * as React from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { EntityRow } from '../src/components/entity-row.js'
import { ModelMark, NativeProviderMark } from '../src/components/model-mark.js'
import { LEADING_GLYPH_ATTRIBUTE, MARKER_KEEP, MARKER_OPT_OUT } from '../src/components/selection.js'
import { PlaceGlyph } from '../src/components/ui/place-glyph.js'
import { ProjectMark } from '../src/components/ui/project-mark.js'
import { StatusGlyph } from '../src/components/work-status.js'

type Compiler = { build(candidates: readonly string[]): string }
type CompileOptions = { readonly base: string; readonly onDependency: (path: string) => void }
let selector = ''

beforeAll(async () => {
  const vite = createRequire(join(process.cwd(), 'package.json')).resolve('@tailwindcss/vite')
  // SAFETY: the module is the Tailwind v4 compiler the kit's Vite plugin loads; `compile` and `build` are its public API.
  const node = (await import(createRequire(vite).resolve('@tailwindcss/node'))) as { compile(css: string, options: CompileOptions): Promise<Compiler> }
  const compiler = await node.compile(readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8'), { base: join(process.cwd(), 'src'), onDependency: () => undefined })
  const sheet = compiler.build(['dshx:selected-marker'])
  const at = sheet.indexOf('.dshx\\:selected-marker')
  selector = sheet.slice(at, sheet.indexOf(' {', at))
})

afterEach(cleanup)

/** Whether the compiled marker rule paints this selected row. */
const draws = (row: React.ReactElement): boolean => {
  const view = render(row)
  const element = view.container.querySelector('.dshx\\:selected-marker')
  expect(element, 'the row carries the marker class').not.toBeNull()
  return element!.matches(selector)
}

describe('selection marker skips rows that lead with a glyph, tile or mark (council round 11 A1)', () => {
  it('compiles to one rule: the opt-in, then the rows that do not lead with a glyph', () => {
    expect(selector).toMatch(/^\.dshx\\:selected-marker\[data-marker='pill'\],\s*\.dshx\\:selected-marker:not\(/u)
  })

  it('keeps the pill on a plain-text row', () => {
    expect(draws(<EntityRow heading="Fix invoice tax rounding" selected onSelect={() => undefined} />)).toBe(true)
    expect(draws(<div className="dshx:selected-marker">General</div>)).toBe(true)
  })

  it('keeps the pill when a glyph sits later in the row, not at its start', () => {
    const meta = (
      <span>
        web-app · <StatusGlyph status="ready" />
      </span>
    )
    expect(draws(<EntityRow heading="Cart badge count" meta={meta} selected onSelect={() => undefined} />)).toBe(true)
    expect(
      draws(
        <div className="dshx:selected-marker">
          <span>Cart badge count</span>
          <span>
            <ProjectMark name="web-app" />
          </span>
        </div>,
      ),
    ).toBe(true)
  })

  it('draws no pill on an EntityRow that leads with its status glyph', () => {
    expect(draws(<EntityRow status="working" heading="Fix invoice tax rounding" selected onSelect={() => undefined} />)).toBe(false)
    expect(draws(<EntityRow status="ready" heading="Cart badge count" selected />)).toBe(false)
  })

  it('draws no pill on a palette row that leads with a project tile', () => {
    const row = (
      <div className="dshx:selected-marker">
        <span aria-hidden="true">
          <ProjectMark name="web-app" />
        </span>
        <span>Cart badge count</span>
      </div>
    )
    expect(draws(row)).toBe(false)
  })

  it('draws no pill on a row that leads with a provider or model mark, or a place glyph', () => {
    const provider = (
      <li className="dshx:selected-marker">
        <button type="button">
          <NativeProviderMark label="DeepSeek" size="list" />
          <span>DeepSeek</span>
        </button>
      </li>
    )
    expect(draws(provider)).toBe(false)
    const model = (
      <div className="dshx:selected-marker">
        <ModelMark modelId="gpt-6-luna" />
        <span>gpt-6-luna</span>
      </div>
    )
    expect(draws(model)).toBe(false)
    const place = (
      <a className="dshx:selected-marker" href="#general">
        <PlaceGlyph tone="settings" selected={false}>
          <svg />
        </PlaceGlyph>
        <span>General</span>
      </a>
    )
    expect(draws(place)).toBe(false)
  })

  it('honours the hooks a plugin row uses: a leading-glyph attribute anywhere, or the row opting out', () => {
    expect(LEADING_GLYPH_ATTRIBUTE).toEqual({ 'data-leading-glyph': '' })
    expect(MARKER_OPT_OUT).toEqual({ 'data-marker': 'none' })
    const tagged = (
      <div className="dshx:selected-marker">
        <span />
        <div>
          <div>
            <div>
              <span>
                <svg {...LEADING_GLYPH_ATTRIBUTE} />
              </span>
            </div>
          </div>
        </div>
      </div>
    )
    expect(draws(tagged)).toBe(false)
    expect(
      draws(
        <div className="dshx:selected-marker" {...MARKER_OPT_OUT}>
          General
        </div>,
      ),
    ).toBe(false)
  })

  it('keeps the pill on a row that opts in: a selected Needs-you or Failed row shows its attention wash, not the selected one', () => {
    expect(MARKER_KEEP).toEqual({ 'data-marker': 'pill' })
    expect(draws(<EntityRow status="needs-you" heading="Publish preview build" selected onSelect={() => undefined} {...MARKER_KEEP} />)).toBe(true)
    const row = (
      <div className="dshx:selected-marker" {...MARKER_KEEP}>
        <span>
          <ProjectMark name="billing-api" />
        </span>
        <span>Reconcile Stripe payouts</span>
      </div>
    )
    expect(draws(row)).toBe(true)
  })

  it('keeps the place-seat rule: a selected tile anywhere in the row already shows the selection', () => {
    const row = (
      <div className="dshx:selected-marker">
        <span>Threads</span>
        <span className="dshx:place-seat" data-selected="true" />
      </div>
    )
    expect(draws(row)).toBe(false)
  })
})
