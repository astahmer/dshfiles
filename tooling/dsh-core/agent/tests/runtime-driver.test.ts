import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { describe, expect, it } from 'vitest'
import { runtimeDriverDescriptorSchema } from '@deepseek-ai/dsh-agent'

const descriptor = runtimeDriverDescriptorSchema.parse({
  id: 'secondary-loop',
  title: 'Secondary native loop route',
  protocolVersion: 1,
  capabilities: { create: true, resume: false, fork: false, steering: true, rollback: false },
})

const createRuntime = async () => {
  const context = new Context()
  await mountAgentLoopTestDependencies(context)
  await mountAgentLoopTestHarness(context)
  return context
}

describe('named runtime drivers', () => {
  it('routes a real native loop through the caller-owned registry without replacing the default factory', async () => {
    const context = await createRuntime()
    try {
      context.agents.registerRuntimeDriver({ descriptor, factory: context.agentLoop })
      const ordinary = await context.agents.create({ sessionId: SessionId('ordinary') })
      const selected = await context.agents.create({ sessionId: SessionId('selected'), runtimeDriver: descriptor.id })
      expect(context.agents.get(ordinary.agent.id)).toBe(ordinary.agent)
      expect(context.agents.get(selected.agent.id)).toBe(selected.agent)
      expect(selected.agent.status).toBe('idle')
      await selected.dispose()
      expect(context.agents.get(selected.agent.id)).toBeUndefined()
      expect(context.agents.get(ordinary.agent.id)).toBe(ordinary.agent)
      await ordinary.dispose()
    } finally {
      await context.fiber.dispose()
    }
  })

  it('rejects unknown and unsupported targets before creating or loading a session', async () => {
    const context = await createRuntime()
    try {
      context.agents.registerRuntimeDriver({ descriptor, factory: context.agentLoop })
      await expect(context.agents.create({ sessionId: SessionId('unknown'), runtimeDriver: 'missing' })).rejects.toThrow('runtime driver unavailable')
      await expect(context.agents.resume({ resumeSessionId: SessionId('unsupported'), runtimeDriver: descriptor.id })).rejects.toThrow('does not support resume')
      expect(context.sessions.get(SessionId('unknown'))).toBeUndefined()
      expect(context.sessions.get(SessionId('unsupported'))).toBeUndefined()
    } finally {
      await context.fiber.dispose()
    }
  })

  it('binds registration to plugin lifetime and snapshots capability metadata', async () => {
    const context = await createRuntime()
    try {
      const mutable = runtimeDriverDescriptorSchema.parse(descriptor)
      const plugin = context.plugin({
        inject: ['agents', 'agentLoop'],
        apply: (owner: Context) => {
          owner.agents.registerRuntimeDriver({ descriptor: mutable, factory: owner.agentLoop })
        },
      })
      await plugin
      mutable.capabilities.resume = true
      const discovered = context.agents.listRuntimeDrivers()
      expect(discovered[0]?.capabilities.resume).toBe(false)
      if (discovered[0] !== undefined) discovered[0].capabilities.resume = true
      expect(context.agents.listRuntimeDrivers()[0]?.capabilities.resume).toBe(false)
      expect(() => context.agents.registerRuntimeDriver({ descriptor, factory: context.agentLoop })).toThrow('already registered')
      await plugin.dispose()
      expect(context.agents.listRuntimeDrivers()).toEqual([])
      context.agents.registerRuntimeDriver({ descriptor, factory: context.agentLoop })
      expect(context.agents.listRuntimeDrivers()).toHaveLength(1)
    } finally {
      await context.fiber.dispose()
    }
  })

  it('rolls failed unpublished setup back through the actual loop lifecycle', async () => {
    const context = await createRuntime()
    try {
      context.agents.registerRuntimeDriver({ descriptor, factory: context.agentLoop })
      const sessionId = SessionId('rejected-setup')
      await expect(context.agents.create({ sessionId, runtimeDriver: descriptor.id, setup: () => { throw new Error('setup rejected') } })).rejects.toThrow('setup rejected')
      expect(context.agents.get(sessionId)).toBeUndefined()
      expect(context.sessions.get(sessionId)).toBeUndefined()
    } finally {
      await context.fiber.dispose()
    }
  })
})
