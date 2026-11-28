import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FanOutChosen, accountTagOf, fanOutModelName, fanOutSendState } from './fan-out-dialog-parts.js'

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
    expect(shell).toMatch(/dshx:in-\[html\[data-shell-phone-nav\]\]:bottom-\[var\(--dsh-keyboard-inset,0px\)\][^"]*dshx:in-\[html\[data-shell-phone-nav\]\]:rounded-b-none/u)
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
    expect(shell).toContain('dshx:in-[html[data-shell-phone-nav]]:max-h-[calc(85dvh-var(--dsh-keyboard-inset,0px))]')
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
