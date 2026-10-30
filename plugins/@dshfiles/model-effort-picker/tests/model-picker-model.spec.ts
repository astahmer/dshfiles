import { describe, expect, it } from 'vitest'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { ModelPickerModel } from '../src/model-picker-model.js'

const nova = {
  id: 'nova-3',
  name: 'Nova 3',
  reasoning: {
    defaultEffort: 'balanced',
    efforts: [
      { id: 'fast', name: 'Fast' },
      { id: 'balanced', name: 'Balanced' },
      { id: 'deep', name: 'Deep' },
    ],
  },
}
const spark = { id: 'spark-1', name: 'Spark 1' }
const northstar = { id: 'northstar', name: 'Northstar AI', models: [nova, spark] }
const redwood = { id: 'redwood', name: 'Redwood', models: [{ id: 'r2', name: 'Redwood 2' }] }
const groups = [northstar, redwood] satisfies ModelDirectoryState['groups']

const currentSelection: ModelSelection = {
  provider: 'northstar',
  model: 'nova-3',
  reasoningEffort: 'deep',
}

describe('model picker selection rules', () => {
  it('searches provider names and model names without flattening provider groups', () => {
    expect(ModelPickerModel.filterGroups(groups, 'northstar')).toEqual([northstar])
    expect(ModelPickerModel.filterGroups(groups, 'spark')).toEqual([{ ...northstar, models: [spark] }])
  })

  it('uses the chosen model’s advertised default, but preserves effort on the same route', () => {
    expect(ModelPickerModel.selectionForModel(northstar, nova, currentSelection)).toEqual(currentSelection)
    expect(ModelPickerModel.selectionForModel(northstar, spark, currentSelection)).toEqual({
      provider: 'northstar',
      model: 'spark-1',
    })
    expect(ModelPickerModel.selectionForModel({ id: 'another-account' }, nova, currentSelection)).toEqual({
      provider: 'another-account',
      model: 'nova-3',
      reasoningEffort: 'deep',
    })
    expect(
      ModelPickerModel.selectionForModel(
        { id: 'another-account' },
        { ...nova, reasoning: { defaultEffort: 'fast', efforts: [{ id: 'fast', name: 'Fast' }] } },
        currentSelection,
      ),
    ).toEqual({
      provider: 'another-account',
      model: 'nova-3',
      reasoningEffort: 'fast',
    })
    expect(ModelPickerModel.selectionForModel(northstar, nova, null)).toEqual({
      provider: 'northstar',
      model: 'nova-3',
      reasoningEffort: 'balanced',
    })
  })

  it('lets the user return to the provider default and labels unknown retained efforts safely', () => {
    expect(ModelPickerModel.selectionForEffort(currentSelection, undefined)).toEqual({ provider: 'northstar', model: 'nova-3' })
    expect(ModelPickerModel.effortName(nova, currentSelection)).toBe('Deep')
    expect(ModelPickerModel.effortName(nova, { ...currentSelection, reasoningEffort: 'retired' })).toBe('retired')
  })

  it('drops the account prefix from the trigger and names the provider only when the model name is shared', () => {
    const alex = { id: 'opencode-go-alex', name: 'OpenCode Go Alex', models: [{ id: 'deepseek-v4', name: 'opencode-go-alex/DeepSeek V4' }] }
    const work = { id: 'opencode-go-work', name: 'OpenCode Go Work', models: [{ id: 'deepseek-v4', name: 'opencode-go-work/DeepSeek V4' }] }
    const alexSelection: ModelSelection = { provider: 'opencode-go-alex', model: 'deepseek-v4' }

    expect(ModelPickerModel.triggerLabel({ groups: [alex, redwood], current: alexSelection })).toEqual({
      model: 'DeepSeek V4',
      title: 'OpenCode Go Alex · DeepSeek V4',
    })
    expect(ModelPickerModel.triggerLabel({ groups: [alex, work], current: alexSelection })).toEqual({
      model: 'DeepSeek V4',
      providerTag: 'OGA',
      title: 'OpenCode Go Alex · DeepSeek V4',
    })
    expect(ModelPickerModel.triggerLabel({ groups: [], current: alexSelection })).toBeUndefined()
  })

  describe('account swap', () => {
    const luna = {
      id: 'gpt-6-luna',
      name: 'GPT-6 Luna',
      reasoning: {
        defaultEffort: 'medium',
        efforts: [
          { id: 'medium', name: 'Medium' },
          { id: 'max', name: 'Max' },
        ],
      },
    }
    const lunaWithoutMax = { ...luna, reasoning: { defaultEffort: 'medium', efforts: [{ id: 'medium', name: 'Medium' }] } }
    const alex1 = { id: 'codex-alex1', name: 'Codex alex1', models: [luna] }
    const alex2 = { id: 'codex-alex2', name: 'Codex alex2', models: [luna] }
    const other = { id: 'opencode', name: 'OpenCode', models: [{ id: 'kimi', name: 'Kimi' }] }
    const alex3 = { id: 'codex-alex3', name: 'Codex alex3', models: [lunaWithoutMax] }
    const accounts = [alex1, alex2, other, alex3] satisfies ModelDirectoryState['groups']
    const onAlex2: ModelSelection = { provider: 'codex-alex2', model: 'gpt-6-luna', reasoningEffort: 'max' }

    it('moves to the next route offering the same model, skipping routes without it', () => {
      expect(ModelPickerModel.nextAccountSelection({ groups: accounts, current: { ...onAlex2, provider: 'codex-alex1' }, routes: [] })?.selection).toEqual(
        onAlex2,
      )
      expect(ModelPickerModel.nextAccountSelection({ groups: accounts, current: onAlex2, routes: [] })?.group.id).toBe('codex-alex3')
    })

    it('wraps around and falls back to the target default when it lacks the current effort', () => {
      expect(ModelPickerModel.nextAccountSelection({ groups: accounts, current: onAlex2, routes: [] })?.selection).toEqual({
        provider: 'codex-alex3',
        model: 'gpt-6-luna',
        reasoningEffort: 'medium',
      })
      expect(ModelPickerModel.nextAccountSelection({ groups: accounts, current: { ...onAlex2, provider: 'codex-alex3' }, routes: [] })?.group.id).toBe(
        'codex-alex1',
      )
    })

    it('rotates only through the configured routes, and offers nothing when no other route qualifies', () => {
      expect(ModelPickerModel.nextAccountSelection({ groups: accounts, current: onAlex2, routes: ['codex-alex1', 'codex-alex2'] })?.group.id).toBe(
        'codex-alex1',
      )
      expect(ModelPickerModel.nextAccountSelection({ groups: accounts, current: onAlex2, routes: ['codex-alex2'] })).toBeUndefined()
      expect(ModelPickerModel.nextAccountSelection({ groups: accounts, current: { provider: 'opencode', model: 'kimi' }, routes: [] })).toBeUndefined()
    })
  })
})

describe('model picker fallback chain', () => {
  const claude = { provider: 'redwood', model: 'r2' }
  const deep = { provider: 'northstar', model: 'nova-3', reasoningEffort: 'deep' }

  it('adds the current selection once, with its explicit effort', () => {
    const route = ModelPickerModel.fallbackFor(currentSelection)
    expect(route).toEqual(deep)
    expect(ModelPickerModel.withFallback([deep], { provider: 'northstar', model: 'nova-3' })).toEqual([deep])
    expect(ModelPickerModel.withFallback([deep], claude)).toEqual([deep, claude])
  })

  it('reorders and removes rungs without leaving the chain', () => {
    expect(ModelPickerModel.movedFallback([deep, claude], 1, -1)).toEqual([claude, deep])
    expect(ModelPickerModel.movedFallback([deep, claude], 0, -1)).toEqual([deep, claude])
    expect(ModelPickerModel.withoutFallback([deep, claude], 0)).toEqual([claude])
  })

  it('names rungs from the catalog and keeps ids for routes it no longer lists', () => {
    expect(ModelPickerModel.fallbackLabel(groups, deep)).toEqual({ provider: 'Northstar AI', model: 'Nova 3', effort: 'Deep' })
    expect(ModelPickerModel.fallbackLabel(groups, { provider: 'gone', model: 'm1' })).toEqual({ provider: 'gone', model: 'm1', effort: undefined })
  })
})
