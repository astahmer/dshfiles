import { Context, resolveConfig } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
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
import { subagentModelSelectionPolicy } from './native/model-selection-state.ts'

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
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(WorkingDirectoryService, { defaultDirectory: tmpdir() })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SubagentRuntime)
  const session = Session.create(SessionId('live-policy'))
  await tool.apply(ctx, { provider: 'spawn', modelSelectionSettings: true }, session)
  return { ctx, session, updateSettings }
}

let callCounter = 0
const listModelsOutcome = async (ctx: Context, args: Record<string, string>): Promise<string> => {
  try {
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId(`list-${++callCounter}`),
      name: 'list_subagent_models',
      arguments: args,
    })
    return JSON.stringify(result)
  } catch (error) {
    return String(error)
  }
}

describe('subagent model selection in a running Session', () => {
  it('allows a route added to the setting after the Session recorded its policy', async () => {
    const { ctx, session, updateSettings } = await boot()
    expect(subagentModelSelectionPolicy(ctx.sessionProjections, session)).toEqual([FAST])
    expect(await listModelsOutcome(ctx, { provider: ADDED.provider })).toContain(`LLM provider \\"${ADDED.provider}\\" is not allowed for this Session`)

    await updateSettings({ enabled: true, allowedModels: [FAST, ADDED] })

    expect(await listModelsOutcome(ctx, { provider: ADDED.provider })).not.toContain('is not allowed for this Session')
    expect(subagentModelSelectionPolicy(ctx.sessionProjections, session)).toEqual([FAST, ADDED])
  })

  it('keeps the recorded routes when the setting is turned off mid-Session', async () => {
    const { ctx, session, updateSettings } = await boot()
    await updateSettings({ enabled: false, allowedModels: [ADDED] })

    expect(await listModelsOutcome(ctx, { provider: FAST.provider })).not.toContain('is not allowed for this Session')
    expect(subagentModelSelectionPolicy(ctx.sessionProjections, session)).toEqual([FAST])
  })
})
