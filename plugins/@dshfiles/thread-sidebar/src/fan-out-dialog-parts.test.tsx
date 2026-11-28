import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FanOutChosen, FanOutSummary, accountTagOf, fanOutModelName, fanOutSendState } from './fan-out-dialog-parts.js'

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
    expect(dialog).toMatch(/<FanOutChosen[\s\S]{0,200}className="dshx:in-\[html\[data-phone-keyboard\]\]:hidden"/u)
    expect(dialog).toMatch(/<FanOutSummary[\s\S]{0,80}className="dshx:hidden dshx:in-\[html\[data-phone-keyboard\]\]:flex"/u)
  })

  it('lets the prompt take the sheet while the keyboard is up, and left-aligns the title', () => {
    expect(dialog).toContain('dshx:in-[html[data-phone-keyboard]]:min-h-[5.5rem] dshx:in-[html[data-phone-keyboard]]:flex-1')
    expect(dialog).toMatch(/<DialogHeader className="[^"]*dshx:text-left/u)
  })

  it('puts the helper text and Cancel / Send on one footer row, and Edit models at the end of the chips', () => {
    expect(dialog).toMatch(/className="dshx:flex dshx:shrink-0 dshx:flex-row dshx:items-center[^"]*"\s+data-fan-out-footer/u)
    expect(dialog).toMatch(/trailing=\{\s*<Button[\s\S]{0,600}variant="ghost"/u)
  })
})
