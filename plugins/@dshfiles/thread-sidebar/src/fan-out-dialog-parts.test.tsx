import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FanOutChosen, accountTagOf, fanOutSendState } from './fan-out-dialog-parts.js'

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

  it('labels the prompt, puts the chips before it, and opens as a bottom sheet on the phone', () => {
    const shell = readFileSync(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')
    const dialog = shell.slice(shell.indexOf('data-fan-out-dialog'))
    expect(dialog.indexOf('<FanOutChosen')).toBeLessThan(dialog.indexOf('<Textarea'))
    expect(dialog).toMatch(/<label[^>]*>\s*\{text\(props\.t, 'threadSidebarFanOutPrompt'\)\}\s*<Textarea/u)
    expect(dialog).toContain("'threadSidebarFanOutSendTo'")
    expect(shell).toMatch(/dshx:in-\[html\[data-shell-phone-nav\]\]:bottom-0[^"]*dshx:in-\[html\[data-shell-phone-nav\]\]:rounded-b-none/u)
    const locales = readFileSync(new URL('./locales.ts', import.meta.url), 'utf8')
    expect(locales).toContain("threadSidebarFanOutPromptPlaceholder: 'Prompt for each model…'")
    expect(locales).toContain("threadSidebarFanOutSendTo: 'Send to {count} models'")
  })
})
