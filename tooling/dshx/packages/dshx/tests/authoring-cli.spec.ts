import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../src/cli/args.js'

const execute = promisify(execFile)
const executable = fileURLToPath(new URL('../dist/cli/bin.js', import.meta.url))

describe('advertised authoring commands', () => {
  it.each(['ui', 'panel', 'api', 'tool', 'command', 'hook'])('accepts add %s through the built executable', async target => {
    const result = await execute(process.execPath, [executable, 'add', target, '--help'])
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('add targets: ui, panel, api, tool, command, hook')
    expect(parseCliArgs(['add', target, '--dry-run']).addTarget).toBe(target)
  })

  it.each(['panel', 'api'])('rejects unrelated options for add %s', target => {
    expect(() => parseCliArgs(['add', target, '--event', 'ready'])).toThrow('--event is only valid with add hook')
    expect(parseCliArgs(['add', target, '--id', 'status', '--dry-run', '--json']).id).toBe('status')
  })

  it('reports the complete target list and refuses unknown targets', () => {
    expect(() => parseCliArgs(['add'])).toThrow('ui, panel, api, tool, command, or hook')
    expect(() => parseCliArgs(['add', 'unknown'])).toThrow('Unknown argument')
  })
})
