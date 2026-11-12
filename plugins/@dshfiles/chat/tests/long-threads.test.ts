// @vitest-environment jsdom
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findInLoadedRows, findTextRanges } from '../src/native/chat/find-reveal.ts'
import { SinceYouLeftRecapModel } from '../src/native/chat/since-you-left.ts'
import { ThreadFindModel, type FindHit } from '../src/native/chat/thread-find-model.ts'
import { mergeTurnRailItems, type TurnRailItem } from '../src/native/chat/turn-rail-items.ts'
import { SinceYouLeftModel, ThreadToolsModel } from '../src/thread-tools.ts'
import { TurnMarksModel, type TurnMark } from '../src/turn-marks.ts'

const mark = (turn: number, seq: number, extra: Partial<TurnMark> = {}): TurnMark => ({
  turn,
  seq,
  question: false,
  questionOpen: false,
  failed: false,
  files: [],
  fileCount: 0,
  added: 0,
  removed: 0,
  ...extra,
})

const outline = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ turn: index + 1, seq: (index + 1) * 10, prompt: `prompt ${String(index + 1)}`, response: '' }))

afterEach(() => {
  document.body.replaceChildren()
})

describe('turn marks: kind derivation', () => {
  it('lets the strongest fact win: failed, then question, then edited, else a plain prompt', () => {
    expect(TurnMarksModel.kindOf(undefined)).toBe('prompt')
    expect(TurnMarksModel.kindOf(mark(1, 1))).toBe('prompt')
    expect(TurnMarksModel.kindOf(mark(1, 1, { fileCount: 2 }))).toBe('edited')
    expect(TurnMarksModel.kindOf(mark(1, 1, { fileCount: 2, question: true }))).toBe('question')
    expect(TurnMarksModel.kindOf(mark(1, 1, { fileCount: 2, question: true, failed: true }))).toBe('failed')
  })

  it('filters: questions include a failed Turn that asked, edits count files, errors only failures', () => {
    const askedThenFailed = mark(1, 1, { question: true, failed: true, fileCount: 1 })
    expect(TurnMarksModel.matches('all', 'prompt')).toBe(true)
    expect(TurnMarksModel.matches('questions', 'failed', askedThenFailed)).toBe(true)
    expect(TurnMarksModel.matches('edits', 'failed', askedThenFailed)).toBe(true)
    expect(TurnMarksModel.matches('errors', 'failed', askedThenFailed)).toBe(true)
    expect(TurnMarksModel.matches('errors', 'question')).toBe(false)
  })

  it('narrows wire entries one by one and drops only the malformed ones', () => {
    const marks = TurnMarksModel.byTurn([mark(1, 10, { failed: true }), { turn: 'two' }, mark(3, 30)])
    expect([...marks.keys()]).toEqual([1, 3])
    expect(TurnMarksModel.byTurn(undefined).size).toBe(0)
    expect(TurnMarksModel.byTurn('nope').size).toBe(0)
  })
})

describe('turn rail items carry sequences and kinds', () => {
  it('types every Turn, loaded or not, and keeps the outline sequence for a loaded Turn', () => {
    const marks = TurnMarksModel.byTurn([mark(1, 10, { question: true }), mark(2, 20, { failed: true }), mark(3, 30, { fileCount: 1 })])
    const items = mergeTurnRailItems([{ turn: 3, prompt: 'loaded', response: '', anchorKey: 'node-3' }], outline(4), marks)
    expect(items.map(item => [item.turn, item.kind, item.seq, item.anchor.kind])).toEqual([
      [1, 'question', 10, 'unloaded'],
      [2, 'failed', 20, 'unloaded'],
      [3, 'edited', 30, 'loaded'],
      [4, 'prompt', 40, 'unloaded'],
    ])
  })

  it('falls back to the mark sequence when the outline lacks the Turn', () => {
    const items = mergeTurnRailItems([{ turn: 7, prompt: 'p', response: '', anchorKey: 'k' }], [], TurnMarksModel.byTurn([mark(7, 70)]))
    expect(items[0]?.seq).toBe(SessionSeq(70))
  })
})

describe('find model', () => {
  it('adds a prefix star to a word still being typed, and leaves a finished query alone', () => {
    expect(ThreadFindModel.indexQuery('q')).toBeNull()
    expect(ThreadFindModel.indexQuery('quart')).toBe('quart*')
    expect(ThreadFindModel.indexQuery('quart ')).toBe('quart')
    expect(ThreadFindModel.indexQuery('"pricing rule"')).toBe('"pricing rule"')
    expect(ThreadFindModel.indexQuery('"pricing ru')).toBe('"pricing ru')
    expect(ThreadFindModel.indexQuery("can't")).toBe("can't*")
    expect(ThreadFindModel.indexQuery('step-4!')).toBe('step-4!')
  })

  it('highlights phrases and words, longest first, without stars or quotes', () => {
    expect(ThreadFindModel.terms('"pricing rule" Quartz*')).toEqual(['pricing rule', 'quartz'])
  })

  it('maps an event to its Turn by turn/start sequence (binary search, and linear when a sequence is missing)', () => {
    const anchors = [10, 20, 30, 40].map((seq, index) => ({ turn: index + 1, seq }))
    expect(ThreadFindModel.turnOf(anchors, 9)).toBeNull()
    expect(ThreadFindModel.turnOf(anchors, 10)).toBe(1)
    expect(ThreadFindModel.turnOf(anchors, 29)).toBe(2)
    expect(ThreadFindModel.turnOf(anchors, 999)).toBe(4)
    expect(
      ThreadFindModel.turnOf(
        [
          { turn: 1, seq: 10 },
          { turn: 2, seq: null },
          { turn: 3, seq: 30 },
        ],
        35,
      ),
    ).toBe(3)
  })

  it('starts at the newest match above the reader, numbers from the newest and wraps both ways', () => {
    const hits: FindHit[] = [5, 15, 25, 35].map(seq => ({ seq, snippet: '' }))
    expect(ThreadFindModel.initialIndex(hits, null)).toBe(3)
    expect(ThreadFindModel.initialIndex(hits, 20)).toBe(1)
    expect(ThreadFindModel.initialIndex(hits, 1)).toBe(3)
    expect(ThreadFindModel.initialIndex([], 1)).toBe(-1)
    expect(ThreadFindModel.label(3, 4, 4)).toBe('1 of 4')
    expect(ThreadFindModel.label(1, 4, 5)).toBe('3 of 4+')
    expect(ThreadFindModel.label(-1, 0, 0)).toBe('0 of 0')
    expect(ThreadFindModel.step(3, 4, 'older')).toBe(2)
    expect(ThreadFindModel.step(0, 4, 'older')).toBe(3)
    expect(ThreadFindModel.step(3, 4, 'newer')).toBe(0)
  })

  it('picks the row that renders an event: the last row of the Turn starting at or before it', () => {
    const rows = [
      { key: 'user', seq: 100 },
      { key: 'step-1', seq: 101 },
      { key: 'tool-a', seq: 104 },
      { key: 'answer', seq: 110 },
    ]
    expect(ThreadFindModel.rowFor(rows, 105)).toBe('tool-a')
    expect(ThreadFindModel.rowFor(rows, 110)).toBe('answer')
    expect(ThreadFindModel.rowFor(rows, 99)).toBeNull()
  })
})

describe('find in the rendered rows', () => {
  it('finds every occurrence of the first term present, case-insensitively, across text nodes', () => {
    document.body.innerHTML = '<div id="row">Quartzite and <b>quartzite</b> grains <script>quartzite</script></div>'
    const row = document.getElementById('row')
    if (row === null) throw new Error('fixture')
    expect(findTextRanges(row, ['lodestar', 'quartzite']).map(range => range.toString())).toEqual(['Quartzite', 'quartzite'])
    expect(findTextRanges(row, ['missing'])).toEqual([])
  })

  it('counts loaded-window matches per innermost row, including rows inside folds', () => {
    document.body.innerHTML = [
      '<div id="list">',
      '<div data-chat-node-key="a">quartzite one</div>',
      '<div data-chat-group-key="g" hidden="until-found"><div data-chat-node-key="b">two quartzite, quartzite</div></div>',
      '<div data-chat-node-key="c">nothing</div>',
      '</div>',
    ].join('')
    const list = document.getElementById('list')
    if (list === null) throw new Error('fixture')
    expect(findInLoadedRows(list, ['quartzite']).map(hit => [hit.nodeKey, hit.occurrence])).toEqual([
      ['a', 0],
      ['b', 0],
      ['b', 1],
    ])
  })
})

describe('since you left: recap math', () => {
  const items = (): readonly TurnRailItem[] =>
    mergeTurnRailItems(
      [],
      outline(6),
      TurnMarksModel.byTurn([
        mark(3, 30, {
          fileCount: 2,
          added: 40,
          removed: 3,
          files: [
            { path: 'src/pricing.ts', added: 30, removed: 3 },
            { path: 'src/cart.ts', added: 10, removed: 0 },
          ],
        }),
        mark(4, 40, { failed: true }),
        mark(5, 50, {
          fileCount: 2,
          added: 6,
          removed: 1,
          files: [
            { path: 'src/pricing.ts', added: 6, removed: 1 },
            { path: 'docs/a.md', added: 0, removed: 0 },
          ],
        }),
        mark(6, 60, { question: true, questionOpen: true }),
      ]),
    )

  it('starts at the Turn of the first unseen finish and sums files, lines, failures and open questions', () => {
    const recap = SinceYouLeftRecapModel.recap(items(), { sessionId: 's', firstUnreadSeq: 39, finishedSeq: 69 })
    expect(recap).toMatchObject({
      firstTurn: 3,
      turns: 4,
      fileCount: 3,
      added: 46,
      removed: 4,
      failedTurns: [4],
      questionTurns: [6],
      questionsWaiting: 1,
    })
    expect(recap?.files.map(file => [file.path, file.added, file.removed, file.turn])).toEqual([
      ['src/pricing.ts', 36, 4, 5],
      ['src/cart.ts', 10, 0, 3],
      ['docs/a.md', 0, 0, 5],
    ])
  })

  it('without a first-unread sequence covers only the newest finished Turn, and nothing before any Turn', () => {
    expect(SinceYouLeftRecapModel.recap(items(), { sessionId: 's', firstUnreadSeq: null, finishedSeq: 61 })).toMatchObject({ firstTurn: 6, turns: 1 })
    expect(SinceYouLeftRecapModel.recap(items(), { sessionId: 's', firstUnreadSeq: 1, finishedSeq: 2 })).toBeNull()
  })

  it('counts files a Turn listed past its limit', () => {
    const many = mergeTurnRailItems([], outline(1), TurnMarksModel.byTurn([mark(1, 10, { fileCount: 15, files: [{ path: 'a.ts', added: 1, removed: 0 }] })]))
    expect(SinceYouLeftRecapModel.recap(many, { sessionId: 's', firstUnreadSeq: 10, finishedSeq: 10 })?.fileCount).toBe(15)
    expect(SinceYouLeftRecapModel.fileName('src/native/chat/x.ts')).toBe('x.ts')
  })
})

describe('thread tools handoff', () => {
  it('delivers a find or Turns request once, to the addressed thread, until it expires', () => {
    const heard = vi.fn()
    const stop = ThreadToolsModel.listen('session-a', heard)
    ThreadToolsModel.request({ sessionId: 'session-a', tool: 'turns', now: 1_000 })
    ThreadToolsModel.request({ sessionId: 'session-b', tool: 'find', now: 1_000 })
    expect(heard).toHaveBeenCalledTimes(1)
    expect(ThreadToolsModel.take('session-a', 1_001)).toBe('turns')
    expect(ThreadToolsModel.take('session-a', 1_002)).toBeNull()
    expect(ThreadToolsModel.take('session-b', 999_999)).toBeNull()
    stop()
  })

  it('keeps one note per thread and refuses a malformed one', () => {
    SinceYouLeftModel.note({ sessionId: 'session-c', firstUnreadSeq: 12, finishedSeq: 40, now: 5 })
    SinceYouLeftModel.note({ sessionId: '', firstUnreadSeq: 1, finishedSeq: 2 })
    expect(SinceYouLeftModel.take('session-c', 6)).toEqual({ sessionId: 'session-c', firstUnreadSeq: 12, finishedSeq: 40 })
    expect(SinceYouLeftModel.take('', 6)).toBeNull()
  })
})
