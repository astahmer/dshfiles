import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { describe, expect, it } from 'vitest'
import type { RuntimeDriverAdapter, RuntimeDriverDescriptor, RuntimeDriverSession } from '@deepseek-ai/dsh-agent'
import { runtimeDriverDescriptorSchema } from '@deepseek-ai/dsh-agent'

const descriptorFor = (resume: boolean): RuntimeDriverDescriptor => runtimeDriverDescriptorSchema.parse({
  id: 'secondary-loop',
  title: 'Secondary runtime route',
  protocolVersion: 1,
  capabilities: { create: true, resume, fork: false, historyReplay: false, steering: true, rollback: false },
})

const createRuntimeDriver = (descriptor: RuntimeDriverDescriptor) => {
  const counts = { created: 0, resumed: 0, prompted: 0, acknowledged: 0, disposed: 0 }
  const session = (): RuntimeDriverSession => ({
    prompt: async (_request, publish) => {
      counts.prompted += 1
      publish({ type: 'text-delta', text: `response-${counts.prompted}` })
      return { outcome: 'completed' as const }
    },
    acknowledgePrompt: async () => { counts.acknowledged += 1 },
    cancel: () => {},
    dispose: async () => { counts.disposed += 1 },
  })
  const adapter: RuntimeDriverAdapter = {
    descriptor,
    create: async () => {
      counts.created += 1
      return session()
    },
    resume: async () => {
      counts.resumed += 1
      return session()
    },
    status: async () => ({ availability: 'available', authentication: 'authenticated' }),
  }
  return { adapter, counts }
}

const createRuntime = async () => {
  const context = new Context()
  await mountAgentLoopTestDependencies(context)
  await mountAgentLoopTestHarness(context)
  return context
}

describe('named runtime drivers', () => {
  it('defaults portable history replay off for adapters with older descriptors', () => {
    const descriptor = runtimeDriverDescriptorSchema.parse({
      id: 'legacy-driver',
      title: 'Legacy runtime driver',
      protocolVersion: 1,
      capabilities: { create: true, resume: false, fork: false, steering: true, rollback: false },
    })
    expect(descriptor.capabilities.historyReplay).toBe(false)
  })

  it('keeps DSH lifecycle ownership while substituting only the external turn runner', async () => {
    const context = await createRuntime()
    const runtime = createRuntimeDriver(descriptorFor(true))
    try {
      context.agents.registerRuntimeDriver(runtime.adapter)
      const ordinary = await context.agents.create({ sessionId: SessionId('ordinary') })
      const selected = await context.agents.create({
        sessionId: SessionId('selected'),
        meta: { runtimeBinding: { driverKind: runtime.adapter.descriptor.id, instanceId: 'test-account' } },
      })
      expect(context.agents.get(ordinary.agent.id)).toBe(ordinary.agent)
      expect(context.agents.get(selected.agent.id)).toBe(selected.agent)
      expect(selected.agent.status).toBe('idle')

      selected.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first prompt' }] }))
      await selected.agent.whenIdle()
      selected.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second prompt' }] }))
      await selected.agent.whenIdle()

      const events = selected.agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(2)
      expect(runtime.counts).toEqual({ created: 1, resumed: 1, prompted: 2, acknowledged: 2, disposed: 2 })
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
    const runtime = createRuntimeDriver(descriptorFor(false))
    try {
      context.agents.registerRuntimeDriver(runtime.adapter)
      await expect(context.agents.create({
        sessionId: SessionId('unknown'),
        meta: { runtimeBinding: { driverKind: 'missing', instanceId: 'test-account' } },
      })).rejects.toThrow('runtime driver unavailable')
      await expect(context.agents.resume({
        resumeSessionId: SessionId('unsupported'),
        runtimeBinding: { driverKind: runtime.adapter.descriptor.id, instanceId: 'test-account' },
      })).rejects.toThrow('does not support resume')
      expect(context.sessions.get(SessionId('unknown'))).toBeUndefined()
      expect(context.sessions.get(SessionId('unsupported'))).toBeUndefined()
    } finally {
      await context.fiber.dispose()
    }
  })

  it('binds registration to plugin lifetime and snapshots capability metadata', async () => {
    const context = await createRuntime()
    const runtime = createRuntimeDriver(descriptorFor(false))
    try {
      const plugin = context.plugin({
        inject: ['agents'],
        apply: (owner: Context) => {
          owner.agents.registerRuntimeDriver(runtime.adapter)
        },
      })
      await plugin
      runtime.adapter.descriptor.capabilities.resume = true
      const discovered = context.agents.listRuntimeDrivers()
      expect(discovered[0]?.capabilities.resume).toBe(false)
      if (discovered[0] !== undefined) discovered[0].capabilities.resume = true
      expect(context.agents.listRuntimeDrivers()[0]?.capabilities.resume).toBe(false)
      expect(() => context.agents.registerRuntimeDriver(runtime.adapter)).toThrow('already registered')
      await plugin.dispose()
      expect(context.agents.listRuntimeDrivers()).toEqual([])
      context.agents.registerRuntimeDriver(createRuntimeDriver(descriptorFor(true)).adapter)
      expect(context.agents.listRuntimeDrivers()).toHaveLength(1)
    } finally {
      await context.fiber.dispose()
    }
  })

  it('validates adapter status before exposing it', async () => {
    const context = await createRuntime()
    const runtime = createRuntimeDriver(descriptorFor(true))
    try {
      context.agents.registerRuntimeDriver(runtime.adapter)
      await expect(context.agents.runtimeDriverStatus(runtime.adapter.descriptor.id, { instanceId: 'test-account' }))
        .resolves.toEqual({ availability: 'available', authentication: 'authenticated' })
    } finally {
      await context.fiber.dispose()
    }
  })

  it('rolls failed unpublished setup back through the actual loop lifecycle', async () => {
    const context = await createRuntime()
    const runtime = createRuntimeDriver(descriptorFor(true))
    try {
      context.agents.registerRuntimeDriver(runtime.adapter)
      const sessionId = SessionId('rejected-setup')
      await expect(context.agents.create({
        sessionId,
        meta: { runtimeBinding: { driverKind: runtime.adapter.descriptor.id, instanceId: 'test-account' } },
        setup: () => { throw new Error('setup rejected') },
      })).rejects.toThrow('setup rejected')
      expect(context.agents.get(sessionId)).toBeUndefined()
      expect(context.sessions.get(sessionId)).toBeUndefined()
    } finally {
      await context.fiber.dispose()
    }
  })
})
