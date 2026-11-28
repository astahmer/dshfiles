import { Context, Service } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentMentionToneSource, createComposerAgentPorts } from './composer-wiring.js'
import type { ComposerAgentPorts } from './composer-agent-preparer.js'

/** Like the page's Remote: a Service, so `ctx.remote.agentPresets` resolves the `remote.agentPresets` service. */
class Remote extends Service {
  constructor(ctx: Context) {
    super(ctx, 'remote')
  }
}

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/**
 * The agents client entry's services: a sibling plugin (the page's Host connection) provides `remote.agentPresets`, and
 * the entry does not inject it. Cordis resolves an uninjected service only from the consumer's own ancestors.
 */
const portsInClientEntry = async (select: (sessionId: string, preset: string) => Promise<{ ok: true } | { ok: false; error: { message: string } }>) => {
  const root = new Context()
  contexts.push(root)
  await root
    .plugin({
      apply: (ctx: Context) => {
        new Remote(ctx)
        ctx.provide('remote.agentPresets', { select })
        ctx.provide('remote.session', {})
        ctx.provide('workspaces', { list: createSnapshotStore({ items: [] }) })
      },
    })
    .await()
  let ports: ComposerAgentPorts | undefined
  await root
    .plugin({
      inject: ['remote', 'remote.session', 'workspaces'],
      apply: (ctx: Context) => {
        ports = createComposerAgentPorts(ctx)
      },
    })
    .await()
  if (ports === undefined) throw new Error('the client entry never ran')
  return ports
}

describe('composer agent ports', () => {
  it('applies the agent preset through the preset Remote the client entry does not inject', async () => {
    const select = vi.fn(async () => ({ ok: true as const }))
    const ports = await portsInClientEntry(select)
    await expect(ports.applyPreset('session-1', 'standard')).resolves.toBeNull()
    expect(select).toHaveBeenCalledExactlyOnceWith('session-1', 'standard')
  })
})

describe('agent mention colours', () => {
  it("answers rich-composer's mention tones with each agent's chosen slot, and null when the list did not load", async () => {
    const source = createAgentMentionToneSource(async () => [{ handle: 'luna', tone: 3 }, { handle: 'plain' }])
    expect(source.id).toBe('@dshfiles/agents.tones')
    await expect(source.load()).resolves.toEqual(new Map([['luna', 3]]))
    await expect(createAgentMentionToneSource(async () => null).load()).resolves.toBeNull()
  })
})
