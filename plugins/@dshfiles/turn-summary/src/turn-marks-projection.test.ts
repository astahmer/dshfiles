import { describe, expect, it } from 'vitest'
import { TURN_MARKS_FILE_LIMIT } from '@dshfiles/chat/turn-marks'
import { TURN_MARKS_TURN_LIMIT, TurnMarksProjectionModel, turnMarksProjectionDefinition, type TurnMarksState } from './turn-marks-projection.js'

let seq = 0
const start = (turn: number) => ({ type: 'turn/start', seq: ++seq, data: { turn } })
const call = (turn: number, callId: string, name: string, args: unknown) => ({
  type: 'tool/call',
  seq: ++seq,
  data: { turn, callId, name, arguments: JSON.stringify(args) },
})
const result = (callId: string, isError = false) => ({ type: 'tool/result', seq: ++seq, data: { message: { toolCallId: callId, isError, content: [] } } })
const end = (turn: number, kind = 'completed') => ({ type: 'turn/end', seq: ++seq, data: { turn, reason: { kind } } })

const fold = (events: readonly unknown[], from: TurnMarksState = TurnMarksProjectionModel.initialState()): TurnMarksState =>
  events.reduce<TurnMarksState>((state, event) => TurnMarksProjectionModel.applyEvent(state, event), from)

describe('turn marks projection', () => {
  it('marks an accepted edit with its lines, and skips a rejected one', () => {
    const state = fold([
      start(1),
      call(1, 'a', 'write', { file_path: 'notes/a.ts', content: 'one\ntwo\n' }),
      result('a'),
      call(1, 'b', 'edit', { file_path: 'notes/b.ts', old_string: 'x', new_string: 'y\nz' }),
      result('b', true),
      call(1, 'c', 'edit', { file_path: 'notes/a.ts', old_string: 'one', new_string: 'uno' }),
      result('c'),
      end(1),
    ])
    expect(state.open).toBeNull()
    expect(state.turns).toEqual([
      expect.objectContaining({
        turn: 1,
        failed: false,
        question: false,
        fileCount: 1,
        added: 3,
        removed: 1,
        files: [{ path: 'notes/a.ts', added: 3, removed: 1 }],
      }),
    ])
  })

  it('marks a question at once and closes it on its result', () => {
    const asked = fold([start(2), call(2, 'q', 'ask_user_question', { questions: [] })])
    expect(asked.turns.at(-1)).toMatchObject({ turn: 2, question: true, questionOpen: true })
    const answered = fold([result('q'), end(2)], asked)
    expect(answered.turns.at(-1)).toMatchObject({ question: true, questionOpen: false })
  })

  it('marks a Turn that ended in an error as failed and keeps earlier entries by identity', () => {
    const first = fold([start(3), end(3)])
    const failed = fold([start(4), end(4, 'error')], first)
    expect(failed.turns[0]).toBe(first.turns[0])
    expect(failed.turns.at(-1)).toMatchObject({ turn: 4, failed: true })
  })

  it('publishes nothing while an open Turn only edits', () => {
    const opened = fold([start(5)])
    const editing = fold([call(5, 'w', 'write', { file_path: 'x.ts', content: 'a' }), result('w')], opened)
    expect(editing.turns).toBe(opened.turns)
    expect(turnMarksProjectionDefinition.wire.view(editing)).toBe(opened.turns)
  })

  it('caps files per Turn and Turns per thread', () => {
    const events: unknown[] = [start(6)]
    for (let index = 0; index < TURN_MARKS_FILE_LIMIT + 3; index += 1) {
      events.push(call(6, `f${index}`, 'write', { file_path: `f${index}.ts`, content: 'a\n' }), result(`f${index}`))
    }
    events.push(end(6))
    const mark = fold(events).turns.at(-1)
    expect(mark?.files).toHaveLength(TURN_MARKS_FILE_LIMIT)
    expect(mark?.fileCount).toBe(TURN_MARKS_FILE_LIMIT + 3)
    let state = TurnMarksProjectionModel.initialState()
    for (let turn = 1; turn <= TURN_MARKS_TURN_LIMIT + 5; turn += 1) state = fold([start(turn), end(turn)], state)
    expect(state.turns).toHaveLength(TURN_MARKS_TURN_LIMIT)
    expect(state.turns[0]?.turn).toBe(6)
  })

  it('ignores replays of an older turn/start and unrelated events', () => {
    const state = fold([start(8), end(8)])
    expect(fold([start(7), { type: 'assistant/message', seq: 99, data: {} }], state)).toBe(state)
  })

  it('validates its own state and view with the registered schemas', () => {
    const state = fold([start(9), call(9, 'q', 'ask_user_question', {}), end(9)])
    expect(turnMarksProjectionDefinition.stateSchema.safeParse(state).success).toBe(true)
    expect(turnMarksProjectionDefinition.wire.viewSchema.safeParse(state.turns).success).toBe(true)
  })
})
