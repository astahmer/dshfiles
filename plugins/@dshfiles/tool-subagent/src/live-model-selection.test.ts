import { Context, resolveConfig } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import * as tool from './native/index.ts'
import type { AllowedModelRoute } from './native/model-selection.ts'
import {
  followedSubagentModelSelectionProjectionDefinition,
  followingSubagentModelSelection,
  subagentModelSelectionPolicy,
} from './native/model-selection-state.ts'

const FAST = { provider: 'alpha', model: 'fast-model' }
const ADDED = { provider: 'beta', model: 'added-model' }

interface SelectionSettings {
  enabled: boolean
  allowedModels: readonly AllowedModelRoute[]
}

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

const mountSettings = async (ctx: Context, initial: SelectionSettings) => {
  await ctx.plugin(Loader)
  ctx.loader.builtins['subagent-model-selection'] = SubagentModelSelectionConfig
  const id = await ctx.loader.create({
    id: 'subagent-model-selection',
    name: 'cordis:subagent-model-selection',
    config: initial,
  })
  const entry = ctx.loader.resolve(id)
  await entry.fiber?.await()
  return async (next: SelectionSettings) => {
    const fiber = entry.fiber
    if (fiber?.runtime === undefined) throw new Error('settings row is not running')
    resolveConfig(
      fiber.runtime,
      fiber.ctx.waterfall(fiber, 'internal/config', next, () => next),
    )
    await entry.update({ config: next })
    await entry.fiber?.await()
  }
}

const boot = async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const updateSettings = await mountSettings(ctx, { enabled: true, allowedModels: [FAST] })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(WorkingDirectoryService, { defaultDirectory: tmpdir() })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SubagentRuntime)
  const recorded = await ctx.sessionProjections.register(followedSubagentModelSelectionProjectionDefinition)
  const session = Session.create(SessionId('live-policy'))
  session.append('subagent/model-selection-policy', { allowedModels: [FAST] })
  const policy = followingSubagentModelSelection(recorded, () => ctx.get('subagentModelSelection'))
  return { ctx, session, policy, recorded, updateSettings }
}

describe('subagent model selection in a running Session', () => {
  it('follows a route added to the setting after the Session recorded its policy', async () => {
    const { session, policy, recorded, updateSettings } = await boot()
    expect(subagentModelSelectionPolicy(policy, session)).toEqual([FAST])

    await updateSettings({ enabled: true, allowedModels: [FAST, ADDED] })

    expect(subagentModelSelectionPolicy(recorded, session)).toEqual([FAST])
    expect(subagentModelSelectionPolicy(policy, session)).toEqual([FAST, ADDED])
    expect(subagentModelSelectionPolicy(recorded, session)).toEqual([FAST, ADDED])
  })

  it('keeps the recorded routes when the setting is turned off mid-Session', async () => {
    const { session, policy, updateSettings } = await boot()
    await updateSettings({ enabled: false, allowedModels: [ADDED] })

    expect(subagentModelSelectionPolicy(policy, session)).toEqual([FAST])
  })

  it('leaves a Session without a recorded policy restricted to its parent route', async () => {
    const { policy } = await boot()
    expect(subagentModelSelectionPolicy(policy, Session.create(SessionId('no-policy')))).toBeUndefined()
  })

  it('registers discovery and model-selectable delegation from the Agent-scoped composition', async () => {
    const { ctx } = await boot()
    await tool.apply(ctx, { provider: 'spawn', modelSelection: true, modelDiscovery: true })
    expect(ctx.tools.get('list_subagent_models')).toBeDefined()
  })
})
