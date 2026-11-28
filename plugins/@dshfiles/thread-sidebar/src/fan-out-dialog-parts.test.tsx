import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FanOutChosen, FanOutSummary, accountTagOf, fanOutFamilies, fanOutModelName, fanOutSendState } from './fan-out-dialog-parts.js'

const text = (html: string): string => html.replace(/<!-- -->/gu, '').replace(/<[^>]+>/gu, '')

describe('fan-out dialog (council picker round 1, N7)', () => {
  it('shows the chosen models first as removable chips with their marks and accounts', () => {
    const html = renderToString(
      <FanOutChosen
        accountOf={provider => (provider === 'cc1' ? 'CC1' : 'CC2')}
        label="Chosen models"
        onRemove={() => undefined}
        removeLabel={model => `Remove ${model}`}
        routes={[
          { provider: 'cc1', model: 'claude-sonnet-5-5' },
          { provider: 'cc2', model: 'google/gemini-3.8-flash' },
        ]}
      />,
    )
    const chips = [...html.matchAll(/<span[^>]*data-fan-out-chip[^>]*>.*?<\/button><\/span>/gu)].map(match => match[0])
    expect(chips).toHaveLength(2)
    expect(chips[0]).toContain('data-model-mark="claude"')
    expect(text(chips[1] ?? '')).toContain('gemini-3.8-flash')
    expect(text(chips[1] ?? '')).toContain('CC2')
    expect(chips[1]).toContain('aria-label="Remove gemini-3.8-flash"')
  })

  it('says how many models Send goes to, and why it waits', () => {
    expect(fanOutSendState({ count: 1, prompt: 'hi', pending: false })).toEqual({ count: 1, disabled: true, reason: 'needs-two' })
    expect(fanOutSendState({ count: 2, prompt: '  ', pending: false })).toEqual({ count: 2, disabled: true, reason: 'needs-prompt' })
    expect(fanOutSendState({ count: 2, prompt: 'Compare', pending: false })).toEqual({ count: 2, disabled: false, reason: null })
    expect(accountTagOf('Command Code 2')).toBe('CC2')
  })

  it('names catalog rows the way the chips and the picker do', () => {
    expect(fanOutModelName('codex_work_1', 'gpt-6-luna', 'GPT-6 Luna')).toBe('gpt-6-luna')
    expect(fanOutModelName('cc1', 'google/gemini-3.8-flash', 'Gemini 3.8 Flash')).toBe('gemini-3.8-flash')
    expect(readFileSync(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')).toContain('{fanOutModelName(group.id, model.id, model.name)}')
  })

  it('labels the prompt, puts the chips before it, and opens as a bottom sheet on the phone', () => {
    const shell = readFileSync(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')
    const dialog = shell.slice(shell.indexOf('data-fan-out-dialog'))
    expect(dialog.indexOf('<FanOutChosen')).toBeLessThan(dialog.indexOf('<Textarea'))
    expect(dialog).toMatch(/<label[^>]*>\s*\{text\(props\.t, 'threadSidebarFanOutPrompt'\)\}\s*<Textarea/u)
    expect(dialog).toContain("'threadSidebarFanOutSendTo'")
    expect(shell).toMatch(
      /dshx:in-\[html\[data-shell-phone-nav\]\]:bottom-\[var\(--dsh-keyboard-inset,0px\)\][^"]*dshx:in-\[html\[data-shell-phone-nav\]\]:rounded-b-none/u,
    )
    const locales = readFileSync(new URL('./locales.ts', import.meta.url), 'utf8')
    expect(locales).toContain("threadSidebarFanOutPromptPlaceholder: 'Prompt for each model…'")
    expect(locales).toContain("threadSidebarFanOutSendTo: 'Send to {count} models'")
  })
})

describe('fan-out sheet on the phone (council picker round 3, R2)', () => {
  const shell = readFileSync(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')
  const dialog = shell.slice(shell.indexOf('data-fan-out-dialog'), shell.indexOf('</DialogContent>', shell.indexOf('data-fan-out-dialog')))
  const tag = (marker: string): string => {
    const at = dialog.indexOf(marker)
    return dialog.slice(dialog.lastIndexOf('<', at), dialog.indexOf('>\n', at))
  }

  it('has one scroller between the header and a footer that never scrolls away', () => {
    expect(dialog.match(/overflow-y-auto/gu) ?? []).toHaveLength(1)
    expect(tag('data-fan-out-body')).toMatch(/dshx:min-h-0 dshx:flex-1[^"]*dshx:overflow-y-auto/u)
    expect(dialog).not.toContain('max-h-64')
    expect(dialog.indexOf('data-fan-out-footer')).toBeGreaterThan(dialog.lastIndexOf('</div>', dialog.indexOf('data-fan-out-footer')) - 1)
    expect(tag('data-fan-out-footer')).toMatch(/dshx:shrink-0/u)
    expect(tag('data-fan-out-footer')).toContain('safe-area-inset-bottom')
  })

  it('sits on the software keyboard under the phone shell, so Send stays in view with the prompt focused', () => {
    expect(shell).toContain('dshx:in-[html[data-shell-phone-nav]]:bottom-[var(--dsh-keyboard-inset,0px)]')
    // Round 4 T3: with the keyboard up the sheet takes the visual viewport less 12 px.
    expect(shell).toContain('dshx:in-[html[data-phone-keyboard]]:h-[calc(100dvh-var(--dsh-keyboard-inset,0px)-12px)]')
  })

  it('labels a 6-line prompt with no resize grip, and keeps the checklist behind Add / Edit models', () => {
    expect(tag('data-fan-out-prompt')).toMatch(/dshx:resize-none/u)
    expect(tag('data-fan-out-prompt')).toContain('rows={6}')
    expect(tag('data-fan-out-edit')).toContain('aria-expanded={fanOutPicking}')
    expect(dialog).toMatch(/\{fanOutPicking \? \(\s*<div[^>]*data-fan-out-models/u)
    expect(shell).toContain('setFanOutPicking((fanOutPreset ?? []).length === 0)')
  })

  it('draws the chips on the UI radius, not as pills', () => {
    const html = renderToString(
      <FanOutChosen
        accountOf={() => 'CC1'}
        label="Chosen"
        onRemove={() => undefined}
        removeLabel={model => `Remove ${model}`}
        routes={[{ provider: 'cc1', model: 'gpt-6-luna' }]}
      />,
    )
    expect(/<span[^>]*data-fan-out-chip[^>]*>/u.exec(html)?.[0]).toMatch(/dshx:rounded-lg/u)
    expect(html).not.toContain('rounded-full')
  })
})

describe('fan-out sheet with the keyboard open (council picker round 4, T3)', () => {
  const shell = readFileSync(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')
  const dialog = shell.slice(shell.indexOf('data-fan-out-dialog'), shell.indexOf('</DialogContent>', shell.indexOf('data-fan-out-dialog')))

  it('folds the chips into one summary row of overlapping marks, the count and Edit', () => {
    const html = renderToString(
      <FanOutSummary
        countLabel="6 models"
        editLabel="Edit"
        onEdit={() => undefined}
        routes={[
          { provider: 'cc1', model: 'gpt-6-luna' },
          { provider: 'cc1', model: 'claude-sonnet-5-5' },
        ]}
      />,
    )
    expect(html.match(/data-model-mark/gu) ?? []).toHaveLength(2)
    expect(html).toContain('dshx:-ml-1.5')
    expect(text(html)).toContain('6 models')
    expect(html).toMatch(/<button[^>]*>Edit<\/button>/u)
    expect(dialog).toMatch(/<FanOutChosen[\s\S]{0,400}className="dshx:in-\[html\[data-phone-keyboard\]\]:hidden"/u)
    expect(dialog).toMatch(/<FanOutSummary[\s\S]{0,80}className="dshx:hidden dshx:in-\[html\[data-phone-keyboard\]\]:flex"/u)
  })

  it('lets the prompt take the sheet while the keyboard is up, and left-aligns the title', () => {
    expect(dialog).toContain('dshx:in-[html[data-phone-keyboard]]:min-h-[5.5rem] dshx:in-[html[data-phone-keyboard]]:flex-1')
    expect(dialog).toMatch(/<DialogHeader className="[^"]*dshx:text-left/u)
  })

  it('puts Cancel / Send on one footer row, and Edit models at the end of the chips', () => {
    expect(dialog).toMatch(/className="dshx:flex dshx:shrink-0 dshx:flex-row dshx:items-center[^"]*"\s+data-fan-out-footer/u)
    // Round 5 U2: Edit models is the chip row's last chip (outline, dashed).
    expect(dialog).toMatch(/trailing=\{\s*<Button[\s\S]{0,600}variant="outline"/u)
  })
})

describe('fan-out sheet, round 5 (council picker U2)', () => {
  const shell = readFileSync(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')
  const dialog = shell.slice(shell.indexOf('data-fan-out-dialog'), shell.indexOf('</DialogContent>', shell.indexOf('data-fan-out-dialog')))
  const footer = dialog.slice(dialog.indexOf('data-fan-out-footer'))

  it('keeps the footer to actions (Cancel one part, Send two on the phone) and says what Send does under the prompt', () => {
    expect(footer).not.toContain('data-fan-out-reason')
    expect(footer).toContain('dshx:in-[html[data-shell-phone-nav]]:grid dshx:in-[html[data-shell-phone-nav]]:grid-cols-[1fr_2fr]')
    expect(dialog.indexOf('data-fan-out-reason')).toBeGreaterThan(dialog.indexOf('data-fan-out-prompt'))
    expect(dialog).toContain("text(props.t, fanOutSend.reason === 'needs-two' ? 'threadSidebarFanOutNeedsTwo' : 'threadSidebarFanOutHelp')")
    expect(dialog).toMatch(/<Textarea\s+ref=\{fanOutPromptRef\}\s+aria-describedby="thread-sidebar-fan-out-reason"/u)
  })

  it('gives the prompt four lines and one focus ring, and the sheet the picker sheet handle and radius', () => {
    expect(dialog).toContain('dshx:min-h-28 dshx:resize-none dshx:font-normal dshx:focus-visible:border-transparent')
    expect(dialog).toContain('data-fan-out-handle')
    expect(shell).toContain('dshx:in-[html[data-shell-phone-nav]]:rounded-t-2xl')
  })

  it('draws each chip with its account dot, on the field border in dark', () => {
    const html = renderToString(
      <FanOutChosen
        accentOf={() => ({ light: 'oklch(0.52 0.12 200)', dark: 'oklch(0.76 0.11 200)', hue: 200 })}
        accountOf={() => 'CC1'}
        label="Chosen"
        onRemove={() => undefined}
        removeLabel={model => `Remove ${model}`}
        routes={[{ provider: 'cc1', model: 'gpt-6-luna' }]}
      />,
    )
    expect(html.indexOf('data-account-dot')).toBeGreaterThan(-1)
    expect(html.indexOf('data-account-dot')).toBeLessThan(html.indexOf('CC1'))
    expect(/<span[^>]*data-fan-out-chip[^>]*>/u.exec(html)?.[0]).toContain('dshx:dark:border-field-border')
  })

  it('shows one mark per distinct family, at most three, in the keyboard summary', () => {
    const routes = ['gpt-6-luna', 'gpt-6-sol', 'claude-sonnet-5-5', 'gemini-3.8-flash', 'deepseek-v4-flash'].map(model => ({ provider: 'cc1', model }))
    expect(fanOutFamilies(routes).map(route => route.model)).toEqual(['gpt-6-luna', 'claude-sonnet-5-5', 'gemini-3.8-flash'])
  })
})

describe('fan-out prompt focus, round 6 (council picker V3)', () => {
  const shell = readFileSync(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')

  it('focuses the prompt on open with a pointer, and leaves touch to the default', () => {
    expect(shell).toMatch(
      /onOpenAutoFocus=\{event => \{\s*if \(window\.matchMedia\('\(pointer: coarse\)'\)\.matches\) return\s*event\.preventDefault\(\)\s*fanOutPromptRef\.current\?\.focus\(\)/u,
    )
    expect(shell).toMatch(/<Textarea\s+ref=\{fanOutPromptRef\}/u)
  })

  it('says what to write and what happens, under the prompt it describes', async () => {
    const { threadSidebarDictionaries } = await import('./locales.js')
    expect(threadSidebarDictionaries.en.threadSidebarFanOutHelp).toBe('Write one prompt. Each model replies in a separate thread.')
  })
})
