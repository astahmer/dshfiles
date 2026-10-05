import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertNoProjectCursorConfig, cursorPermissionRequest, cursorPermissionResponse } from '../src/cursor-acp-adapter.js'

describe('Cursor ACP adapter boundaries', () => {
  it.each(['cli.json', 'mcp.json'])('refuses project .cursor/%s configuration in a workspace ancestor', async (fileName: 'cli.json' | 'mcp.json') => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cursor-config-'))
    const cwd = join(root, 'workspace', 'nested')
    try {
      await mkdir(join(root, 'workspace', '.cursor'), { recursive: true })
      await mkdir(cwd, { recursive: true })
      await writeFile(join(root, 'workspace', '.cursor', fileName), '{}')
      await expect(assertNoProjectCursorConfig(cwd)).rejects.toThrow(`.cursor/${fileName}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts a workspace without project Cursor configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cursor-config-'))
    try {
      await expect(assertNoProjectCursorConfig(root)).resolves.toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('maps an ACP permission to a bounded DSH approval without a transcript tool id', () => {
    const signal = new AbortController().signal
    const title = `  Run\n${'x'.repeat(300)}  `
    const request = cursorPermissionRequest(
      {
        title,
        kind: 'execute',
        name: 'Shell Command',
      },
      signal,
    )

    expect(request).toEqual({
      toolName: 'cursor-shell-command',
      reason: `Run ${'x'.repeat(236)}`,
      signal,
    })
  })

  it('maps only an explicit allow-once choice to DSH approval', () => {
    const options = [
      { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject once', kind: 'reject_once' },
    ] as const

    expect(cursorPermissionResponse(options, 'allowed-once')).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })
    expect(cursorPermissionResponse(options, 'rejected')).toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } })
    expect(cursorPermissionResponse(options, 'unavailable')).toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } })
    expect(cursorPermissionResponse(options, 'cancelled')).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(cursorPermissionResponse(options.slice(1), 'allowed-once')).toEqual({ outcome: { outcome: 'cancelled' } })
  })
})
