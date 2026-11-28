// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutlineRegular: () => null,
  IconFolderCloseRegular: () => null,
  IconFolderOpenRegular: () => null,
  Tooltip: (props: { children: unknown }) => props.children,
}))

const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string): string => readFileSync(resolve(here, path), 'utf8')
const source = read('native/skeleton/ConversationContent.tsx')
const uncommented = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//gu, '')

/** Every innermost block with its selector and the at-rules around it. */
const blocks = (css: string): readonly { readonly selector: string; readonly body: string; readonly context: string }[] => {
  const text = uncommented(css)
  const found: { selector: string; body: string; context: string }[] = []
  const rule = /([^{}]+)\{([^{}]*)\}/gu
  for (let match = rule.exec(text); match !== null; match = rule.exec(text)) {
    const open: string[] = []
    for (const token of text.slice(0, match.index).matchAll(/([^{}]*)([{}])/gu)) {
      if (token[2] === '{') open.push((token[1] ?? '').trim())
      else open.pop()
    }
    found.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '', context: open.filter(prelude => prelude.startsWith('@')).join(' ') })
  }
  return found
}
const root = blocks(read('native/skeleton/ConversationRoot.module.css'))
const bar = blocks(read('native/skeleton/InputBar.module.css'))
const wide = (selector: string): string => root.filter(block => block.selector === selector && block.context === '').map(block => block.body).join('\n')

/** The place group as the composer renders it: multi-host's host chip and jj-integration's workspace segment. */
const placeGroup = (input: {
  readonly host?: 'local' | 'runtime'
  readonly hostLabel?: string
  readonly own?: boolean
  readonly defaultChoice?: boolean
  readonly remoteFolder?: string
}): HTMLElement => {
  const place = document.createElement('span')
  const host = input.host === undefined
    ? ''
    : `<span><button data-run-segment="host" data-host-kind="${input.host}"><svg></svg>${input.hostLabel ?? 'Local'}<svg></svg></button></span>`
  const folder = input.remoteFolder === undefined ? '' : `<button data-remote-folder=""><svg></svg>${input.remoteFolder}</button>`
  const workspace = input.own === undefined
    ? ''
    : `<button data-run-segment="workspace"${input.defaultChoice === true ? ' data-location-default=""' : ''}><svg></svg><span>${input.own ? 'Own workspace' : 'In the project'}</span>${input.own ? '<span>from <span>main</span></span>' : ''}<svg></svg></button>`
  place.innerHTML = `<span data-run-segment="project"><span data-slot="project-mark">BA</span><button>billing-api</button></span>${host}${folder}${workspace}`
  return place
}

// Council round 16 C1: the composer's host ("Local") and working location ("In the project") are ONE location control
// that shows a detail only when either differs from the default.
describe('the location chip', () => {
  it('says only "Local" while both pickers keep their defaults, and names both for assistive technology', async () => {
    const { readRunPlace } = await import('./native/skeleton/ConversationContent.tsx')
    expect(readRunPlace(placeGroup({ host: 'local', own: false, defaultChoice: true }))).toEqual({ full: 'Local · In the project', shown: 'Local', host: 'local' })
  })

  it('adds the working location once it differs from the default, words spaced ("Own workspace from main")', async () => {
    const { readRunPlace } = await import('./native/skeleton/ConversationContent.tsx')
    expect(readRunPlace(placeGroup({ host: 'local', own: true }))).toEqual({
      full: 'Local · Own workspace from main',
      shown: 'Local · Own workspace from main',
      host: 'local',
    })
    // The default can be isolation (Settings › jj-integration › isolate by default): then "In the project" is the detail.
    expect(readRunPlace(placeGroup({ host: 'local', own: true, defaultChoice: true }))?.shown).toBe('Local')
    expect(readRunPlace(placeGroup({ host: 'local', own: false }))?.shown).toBe('Local · In the project')
  })

  it('names a remote host and its folder, and never reads the project into the chip', async () => {
    const { readRunPlace } = await import('./native/skeleton/ConversationContent.tsx')
    expect(readRunPlace(placeGroup({ host: 'runtime', hostLabel: 'build-box', remoteFolder: 'billing-api' }))).toEqual({
      full: 'build-box · billing-api',
      shown: 'build-box · billing-api',
      host: 'remote',
    })
  })

  it('falls back to the working location without a host picker, and to no chip without either', async () => {
    const { readRunPlace } = await import('./native/skeleton/ConversationContent.tsx')
    expect(readRunPlace(placeGroup({ own: false, defaultChoice: true }))).toEqual({ full: 'In the project', shown: 'In the project', host: undefined })
    expect(readRunPlace(placeGroup({}))).toBeUndefined()
  })

  it('keeps the project chip out of the panel: the project leads, then the location chip, then the panel with host and workspace', () => {
    const project = source.indexOf('data-run-segment="project"')
    const summary = source.indexOf('data-place-summary=""')
    const sheet = source.indexOf('data-place-sheet=""')
    const slot = source.indexOf("renderSlot('conversation.hero.workspace'")
    expect(project).toBeGreaterThan(-1)
    expect(project).toBeLessThan(summary)
    expect(summary).toBeLessThan(sheet)
    expect(sheet).toBeLessThan(slot)
    expect(source).not.toContain('data-place-label="project"')
    // A button that says its state and the panel it opens; 44pt on touch.
    const button = source.slice(source.lastIndexOf('<button', summary), source.indexOf('</button>', summary))
    for (const part of ['aria-expanded={placeOpen || placeAlert}', 'aria-controls={placeSheetId}', "'dshx-hit-44'"]) expect(button).toContain(part)
  })

  it('opens its panel by itself while a picker in it shows an error, so no error waits behind the closed chip', () => {
    expect(source).toContain("data-place-open={placeOpen || placeAlert ? '' : undefined}")
    expect(source).toContain(`place.querySelector('[data-place-sheet] [role="alert"]') !== null`)
  })

  it('folds the pickers on every width: the chip shows and the panel waits closed outside the phone query', () => {
    expect(wide('.runPlace')).toMatch(/display: contents;/)
    expect(wide('.placeSummary')).toMatch(/display: inline-flex;/)
    expect(wide('.placeSummary')).toMatch(/height: 28px;/)
    expect(root.find(block => block.selector.split(',').map(part => part.trim()).includes('.placeSheet') && block.context === '')?.body).toMatch(/display: none;/)
    const open = wide('.runPlace[data-place-open] .placeSheet')
    expect(open).toMatch(/display: grid;/)
    // A line of its own under the bar, after Send.
    expect(open).toMatch(/order: 3;/)
    expect(open).toMatch(/flex: 0 0 100%;/)
    expect(wide('.placeSummary[data-place-empty]')).toMatch(/display: none;/)
  })
})

describe('the New thread writing area (council round 16 C1)', () => {
  it('is 10px taller than a started thread\'s while empty', () => {
    expect(bar.find(block => block.selector === '.input' && block.context === '')?.body).toMatch(/min-height: 44px;/)
    expect(bar.find(block => block.selector === '.hero .input' && block.context === '')?.body).toMatch(/min-height: 54px;/)
  })
})
