import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@dshfiles/dshx/host'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { Policies, type PolicyRule } from './policies.js'

const rule = (overrides: Partial<PolicyRule>): PolicyRule => ({ name: '', tool: '*', match: '', reason: '', enabled: true, ...overrides })

describe('Policies.denying', () => {
  it('matches the tool glob and the argument pattern, and skips disabled rules', () => {
    const rules = [
      rule({ name: 'no force push', tool: 'bash', match: 'git push.*--force' }),
      rule({ name: 'no MCP', tool: 'mcp__*', enabled: false }),
      rule({ name: 'no web', tool: 'web_*' }),
    ]
    expect(Policies.denying(rules, { name: 'bash', arguments: { command: 'git push origin main --force' } })?.name).toBe('no force push')
    expect(Policies.denying(rules, { name: 'bash', arguments: { command: 'git push origin main' } })).toBeUndefined()
    expect(Policies.denying(rules, { name: 'bash_extra', arguments: { command: 'git push --force' } })).toBeUndefined()
    expect(Policies.denying(rules, { name: 'mcp__github__merge', arguments: {} })).toBeUndefined()
    expect(Policies.denying(rules, { name: 'web_fetch', arguments: { url: 'https://example.com' } })?.name).toBe('no web')
  })

  it('fails closed on a pattern that does not compile', () => {
    const rules = [rule({ name: 'broken', tool: 'read', match: '(' })]
    expect(Policies.denying(rules, { name: 'read', arguments: { path: '/etc/hosts' } })?.name).toBe('broken')
    expect(Policies.denying(rules, { name: 'write', arguments: {} })).toBeUndefined()
  })

  it('tells the agent the refusal is final and where the user changes it', () => {
    const text = Policies.refusal(rule({ name: 'no force push', reason: 'main is protected' }))
    expect(text).toContain('Denied by policy “no force push”: main is protected.')
    expect(text).toContain('Settings › dshfiles-policies')
  })
})

describe('the policy guard in the real tool runtime', () => {
  let host: TestHost | undefined

  afterEach(async () => {
    await host?.dispose()
    host = undefined
  })

  it('denies a matching call before its tool runs and lets other calls through', async () => {
    host = await createTestHost()
    const ran: string[] = []
    host.tools.register(
      defineTool({
        name: 'shell',
        description: 'Run a command.',
        parameters: { command: { type: 'string' } },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        execute: async args => {
          ran.push(JSON.stringify(args))
          return 'ran'
        },
      }),
    )
    let rules: readonly PolicyRule[] = [rule({ name: 'no rm', tool: 'shell', match: 'rm -rf', reason: 'destructive' })]
    host.tools.guard(Policies.guard(() => rules))
    const signal = new AbortController().signal

    const denied = await host.tools.execute({ callId: ToolCallId('call-1'), name: 'shell', arguments: { command: 'rm -rf /' }, signal })
    const allowed = await host.tools.execute({ callId: ToolCallId('call-2'), name: 'shell', arguments: { command: 'ls' }, signal })
    rules = []
    const afterRemoval = await host.tools.execute({ callId: ToolCallId('call-3'), name: 'shell', arguments: { command: 'rm -rf /tmp/x' }, signal })

    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied.content)).toContain('Denied by policy “no rm”: destructive')
    expect(allowed.isError).toBe(false)
    expect(afterRemoval.isError).toBe(false)
    expect(ran).toEqual(['{"command":"ls"}', '{"command":"rm -rf /tmp/x"}'])
  })
})
