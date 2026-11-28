import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const english = (): string => {
  const source = read('locales.ts')
  return source.slice(source.indexOf('const en = {'), source.indexOf('const zh = {'))
}

describe('the Messages page', () => {
  it('writes plurals as words, never "(s)"', () => {
    expect(english()).not.toContain('(s)')
  })

  it('draws no "Connected to DSH" chip on a healthy page and keeps Diagnostics out of the tabs', () => {
    const panel = read('agent-communication-panel.tsx')
    expect(panel).not.toContain("t('connected')")
    expect(panel).not.toMatch(/value: 'diagnostics', label: t\('diagnostics'\)/u)
    expect(panel).toMatch(/id: 'diagnostics',[^}]*placement: 'overflow'/u)
  })

  it('counts the messages the list shows, and a channel draws no subscriber number beside its name', () => {
    const panel = read('agent-communication-panel.tsx')
    expect(panel).toContain('const shownMessageCount = messages.length')
    expect(panel).not.toContain('<span className="dshx:text-xs dshx:text-muted-foreground">{subscribers}</span>')
  })

  it('names a project channel it cannot resolve without its hash', () => {
    expect(read('agent-communication-panel.tsx')).not.toContain("`${props.t('workspace')} · ${topic.slice(")
  })
})
