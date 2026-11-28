import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en } from '../src/native/task-manager-locales.ts'

// DESIGN.md "One name per destination": the rail row, the tab title and the `h1` are the same words.
describe('the Schedules page name', () => {
  it('names the panel and the page heading "Schedules", as the rail does', () => {
    expect(en.panel).toBe('Schedules')
    expect(en.title).toBe('Schedules')
  })

  it('says what it does and points at Automations for a new thread', () => {
    expect(en.description).toBe('Prompts sent to a thread at a set time.')
    expect(`${en['description.otherBefore']}${en['description.otherLink']}${en['description.otherAfter']}`).toBe(
      'To start a new thread from a schedule or a webhook, use Automations.',
    )
  })

  it('puts its heading in a page-header slot, so the phone top bar alone prints the title', () => {
    const page = readFileSync(new URL('../src/native/TaskManagerPage.tsx', import.meta.url), 'utf8')
    expect(page).toMatch(/data-slot="page-header"[^>]*>\s*<div className=\{css\.pageTitle\}>\s*<h1/u)
  })
})
