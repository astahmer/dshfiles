import { describe, expect, it } from 'vitest'
import { ShellCommand } from './shell-command.js'

const { isWindowsAbsolutePath, posixQuote, withEnvironment: commandWithEnvironment } = ShellCommand

describe('copyable environment commands', () => {
  it('keeps the one-command POSIX form for a POSIX path', () => {
    expect(commandWithEnvironment('CODEX_HOME', "/synthetic/it's", 'codex login')).toBe("CODEX_HOME='/synthetic/it'\\''s' codex login")
    expect(posixQuote("a'b")).toBe("'a'\\''b'")
  })

  it('sets the variable for one PowerShell command and restores it for a Windows path', () => {
    expect(commandWithEnvironment('CLAUDE_CONFIG_DIR', "C:\\Users\\me\\it's", 'claude auth login')).toBe(
      "& { $previous = $env:CLAUDE_CONFIG_DIR; $env:CLAUDE_CONFIG_DIR = 'C:\\Users\\me\\it''s'; try { claude auth login } finally { $env:CLAUDE_CONFIG_DIR = $previous } }",
    )
  })

  it('recognizes drive-absolute paths with either separator only', () => {
    expect(isWindowsAbsolutePath('C:\\Users')).toBe(true)
    expect(isWindowsAbsolutePath('d:/work')).toBe(true)
    expect(isWindowsAbsolutePath('C:')).toBe(false)
    expect(isWindowsAbsolutePath('/home/me')).toBe(false)
    expect(isWindowsAbsolutePath('~/work')).toBe(false)
  })
})
