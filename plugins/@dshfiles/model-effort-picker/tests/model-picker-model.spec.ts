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
})
