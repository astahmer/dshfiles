import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import host from '../src/host.js'

const source = (file: string): string => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

describe('apply_patch wiring', () => {
  it('captures injected filesystem services from the plugin root Layer', () => {
    const tool = source('patch-tool.ts')
    const hostSource = source('host.ts')
    expect(tool).toContain('services.workingDirectory.ensure')
    expect(tool).toContain('services.fs.resolve')
    expect(tool).not.toContain('agent.ctx')
    expect(tool).not.toContain('execution.agent?.ctx')
    expect(tool).toContain("ctx.get('sandboxPolicy')")
    expect(hostSource).toContain('DshxEffect.plugin({')
  })

  it('resolves the write sandbox from the caller Session', () => {
    const tool = source('patch-tool.ts')
    expect(tool).toContain('services.sessions.get(agent.id)')
    expect(tool).toContain('policy?.resolve(session === undefined ? {} : { session })')
    expect(tool).toContain('services.fs.writeText(target, result.value.content, undefined, signal, sandboxPolicy)')
    expect(tool).toContain('Effect.runPromise(')
  })

  it('registers the tool from scoped setup and preserves injected services', () => {
    expect(host.setup).toBeTypeOf('function')
    expect(source('host.ts')).toContain('Effect.acquireRelease(')
    expect(source('host.ts')).not.toContain('tools: [')
    expect(host.inject).toEqual(expect.arrayContaining(['tools', 'fs', 'workingDirectory', 'sessions']))
  })
})
