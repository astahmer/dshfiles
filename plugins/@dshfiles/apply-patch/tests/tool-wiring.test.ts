import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import host from '../src/host.js'

/**
 * The 2026-10-24 weekly review found 453 failures across 193 Sessions with
 * `cannot get property "workingDirectory" without inject`: the tool body read
 * the filesystem services off the scoped Agent context, which does not inject
 * them. These checks pin the wiring that fixed it.
 */
const source = (file: string): string => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

describe('apply_patch wiring', () => {
  it('reads the filesystem services from the plugin context, never the Agent one', () => {
    const tool = source('patch-tool.ts')
    expect(tool).toContain('createApplyPatchTool = (ctx: Context)')
    expect(tool).toContain('ctx.workingDirectory.ensure')
    expect(tool).toContain('ctx.fs.resolve')
    expect(tool).not.toContain('agent.ctx')
    expect(tool).not.toContain('execution.agent?.ctx')
  })

  it('registers the tool from setup so it closes over that context', () => {
    expect(host.setup).toBeTypeOf('function')
    expect(source('host.ts')).not.toContain('tools: [')
    expect(host.inject).toEqual(expect.arrayContaining(['tools', 'fs', 'workingDirectory']))
  })
})
