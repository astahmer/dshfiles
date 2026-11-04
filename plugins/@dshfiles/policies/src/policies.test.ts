import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { defineTool } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import plugin from './host.js'
import { Policies, type PolicyRule } from './policies.js'
import { PolicyRules } from './policy-rules.js'
import { policiesSettings } from './settings.js'

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

const namespace = policiesSettings.namespace

describe('PolicyRules', () => {
  const RulesSettings = Settings.Tag<{ readonly rules: readonly PolicyRule[] }>(namespace)
  const initial = { rules: [rule({ name: 'no rm', tool: 'shell', match: 'rm -rf' })] }

  it.layer(PolicyRules.layer.pipe(Layer.provideMerge(Settings.layerTest(namespace, initial))))(layer => {
    layer.effect('follows every committed settings revision', () =>
      Effect.gen(function* () {
        const rules = yield* PolicyRules
        const settings = yield* RulesSettings
        expect(yield* rules.check({ name: 'shell', arguments: { command: 'rm -rf /' } })).toContain('Denied by policy “no rm”')

        yield* settings.update({ rules: [] })
        yield* Effect.yieldNow

        expect(yield* rules.list).toEqual([])
        expect(yield* rules.check({ name: 'shell', arguments: { command: 'rm -rf /' } })).toBeUndefined()
        expect(rules.guard({ name: 'shell', arguments: { command: 'rm -rf /' } })).toBeUndefined()
      }),
    )
  })
})

const testHost = Effect.acquireRelease(
  Effect.promise(() => createTestHost()),
  host => Effect.promise(() => host.dispose()),
)

describe('the policies plugin in the real tool runtime', () => {
  it.effect('denies a matching call before its tool runs, follows settings updates and serves the list', () =>
    Effect.gen(function* () {
      const host = yield* testHost
      let document = { ns: namespace, value: { rules: [rule({ name: 'no rm', tool: 'shell', match: 'rm -rf', reason: 'destructive' })] }, revision: 1 }
      host.ctx.provide('settings', {
        configure: () => () => undefined,
        describe: () => [document],
        update: async () => undefined,
        replace: async () => undefined,
      })
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
      yield* Effect.acquireRelease(
        Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/policies' })),
        mounted => Effect.promise(() => mounted.dispose()),
      )
      const signal = new AbortController().signal
      const execute = (callId: string, command: string) =>
        Effect.promise(() => host.tools.execute({ callId: ToolCallId(callId), name: 'shell', arguments: { command }, signal }))

      const denied = yield* execute('call-1', 'rm -rf /')
      const allowed = yield* execute('call-2', 'ls')
      const listed = yield* Effect.promise(() =>
        host.connection
          .requestApi({ packageId: '@dshfiles/policies', apiId: 'policies', method: 'list', version: 1, input: {} })
          .then(response => response.json()),
      )
      document = { ns: namespace, value: { rules: [] }, revision: 2 }
      host.ctx.emit('settings/document-updated', namespace, 2)
      yield* Effect.yieldNow
      const afterRemoval = yield* execute('call-3', 'rm -rf /tmp/x')

      expect(denied.isError).toBe(true)
      expect(JSON.stringify(denied.content)).toContain('Denied by policy “no rm”: destructive')
      expect(allowed.isError).toBe(false)
      expect(listed).toMatchObject({ result: { ok: true, value: { output: { rules: [{ name: 'no rm', tool: 'shell' }] } } } })
      expect(afterRemoval.isError).toBe(false)
      expect(ran).toEqual(['{"command":"ls"}', '{"command":"rm -rf /tmp/x"}'])
    }).pipe(Effect.scoped),
  )
})
