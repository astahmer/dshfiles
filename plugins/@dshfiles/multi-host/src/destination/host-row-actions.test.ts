import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hostRowActions } from './host-row-actions.js'

describe('host row actions', () => {
  it('gives an SSH host one inline verb and keeps every other control in its menu', () => {
    const row = hostRowActions({ kind: 'ssh', failed: false })
    expect(row.inline).toBe('open')
    expect(row.menu).toEqual(['copy-link', 'clone', 'sync', 'add-folder', 'link-back', 'reconnect', 'edit', 'hide', 'move-up', 'move-down', 'remove'])
  })
  it('leads a failed host with Diagnose and moves Open host into the menu', () => {
    const row = hostRowActions({ kind: 'ssh', failed: true })
    expect(row.inline).toBe('diagnose')
    expect(row.menu[0]).toBe('open')
    expect(row.menu).not.toContain('diagnose')
  })
  it('keeps this machine and a linked machine to their own verbs', () => {
    expect(hostRowActions({ kind: 'local', failed: false })).toEqual({ inline: null, menu: ['reconnect', 'hide', 'move-up', 'move-down', 'remove'] })
    expect(hostRowActions({ kind: 'link', failed: false })).toEqual({
      inline: null,
      menu: ['add-folder', 'link-back', 'reconnect', 'hide', 'move-up', 'move-down', 'remove'],
    })
  })
  it('draws a row as one verb and one menu: no strip of icon buttons', () => {
    const page = readFileSync(new URL('hosts-page.tsx', import.meta.url), 'utf8')
    expect(page).not.toContain('<IconAction')
    expect(page).toContain('aria-label={`Actions for ${host.name}`}')
    expect(page).toMatch(/<AlertDialogTitle>Remove \{host\.name\}\?<\/AlertDialogTitle>/u)
  })
})
