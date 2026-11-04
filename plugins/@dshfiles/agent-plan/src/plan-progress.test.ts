import { describe, expect, it } from 'vitest'
import { PlanProgress, type PlanItem, type PlanWrite } from './plan-progress.js'

const write = (seq: number, time: number, todos: readonly PlanItem[], turn = 1): PlanWrite => ({ seq, time, turn, todos })
const item = (content: string, status: PlanItem['status']): PlanItem => ({ content, status })

describe('PlanProgress', () => {
  it('times each step from the writes that started and finished it and points at the active step', () => {
    const history = [
      write(1, 1_000, [item('Read', 'in_progress'), item('Edit', 'pending'), item('Test', 'pending')]),
      write(2, 31_000, [item('Read', 'completed'), item('Edit', 'in_progress'), item('Test', 'pending')]),
      write(3, 95_000, [item('Read', 'completed'), item('Edit', 'completed'), item('Test', 'in_progress')]),
    ]
    const progress = PlanProgress.progress(history[2]?.todos ?? [], history)
    expect(PlanProgress.label(progress)).toBe('Step 3 of 3')
    expect(progress.currentStep?.content).toBe('Test')
    expect(progress.steps.map(step => PlanProgress.elapsed(step, 100_000))).toEqual([30_000, 64_000, 5_000])
    expect(PlanProgress.formatDuration(64_000)).toBe('1m 04s')
  })

  it('times a step that jumped straight to completed from the write before and reports a finished plan', () => {
    const history = [write(1, 0, [item('A', 'in_progress'), item('B', 'pending')]), write(2, 4_000, [item('A', 'completed'), item('B', 'completed')])]
    const progress = PlanProgress.progress(history[1]?.todos ?? [], history)
    expect(progress.done).toBe(true)
    expect(PlanProgress.label(progress)).toBe('2 of 2 done')
    expect(progress.steps.map(step => PlanProgress.elapsed(step, 9_000))).toEqual([4_000, 4_000])
  })

  it('reads only valid todo_write arguments and follows a plan back across turns until an unrelated or restarted one', () => {
    expect(PlanProgress.itemsFromArguments('{"todos":[{"content":" Ship ","status":"pending"}]}')).toEqual([item('Ship', 'pending')])
    expect(PlanProgress.itemsFromArguments('{"todos":[{"content":"x","status":"done"}]}')).toBeUndefined()
    expect(PlanProgress.itemsFromArguments('{"todos":[')).toBeUndefined()
    const writes = [
      write(1, 10, [item('Old', 'in_progress')], 1),
      write(2, 20, [item('A', 'in_progress'), item('B', 'pending')], 1),
      write(3, 30, [item('A', 'completed'), item('B', 'in_progress')], 2),
      write(4, 40, [item('B', 'completed'), item('C', 'pending')], 3),
    ]
    expect(PlanProgress.lineage(writes, 3).map(entry => entry.seq)).toEqual([2, 3, 4])
    expect(PlanProgress.lineage(writes, 0).map(entry => entry.seq)).toEqual([1])
    const restarted = [write(1, 10, [item('A', 'completed'), item('B', 'in_progress')]), write(2, 20, [item('A', 'in_progress'), item('B', 'pending')])]
    expect(PlanProgress.lineage(restarted, 1).map(entry => entry.seq)).toEqual([2])
  })
})
