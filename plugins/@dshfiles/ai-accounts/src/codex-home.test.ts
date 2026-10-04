import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CodexHomeError, resolveCodexHomeLayout } from './codex-home.js'

describe('resolveCodexHomeLayout', () => {
  it('resolves homes inside the user home', () => {
    expect(resolveCodexHomeLayout({ homePath: '~/.codex', shadowHomePath: '~/.codex-dshx/work' })).toEqual({
      mode: 'authOverlay',
      sharedHomePath: join(homedir(), '.codex'),
      effectiveHomePath: join(homedir(), '.codex-dshx', 'work'),
    })
  })

  it.each(['/etc', '~/../../etc', homedir(), `${homedir()}-sibling/.codex`])('refuses %s', homePath => {
    expect(() => resolveCodexHomeLayout({ homePath })).toThrow(CodexHomeError)
    expect(() => resolveCodexHomeLayout({ shadowHomePath: homePath })).toThrow(CodexHomeError)
  })
})
