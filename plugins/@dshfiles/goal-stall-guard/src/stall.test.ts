import { describe, expect, it } from 'vitest'
import { Config } from './host.js'
import { DEFAULT_STALL_POLICY, goalRoundFrom, isGoalOpeningPrompt, StallDetector } from './stall.js'

const roundPrompt = (round: number, total = 256): string =>
  `<goal_round>\nObjective: "restyle the sidebar"\nRound: ${round}/${total}\n\nContinue working toward the objective.`

describe('goalRoundFrom', () => {
  it('reads a positive goal round', () => {
    expect(goalRoundFrom(roundPrompt(7))).toEqual({ round: 7 })
  })

  it('rejects the round-zero message that opens a goal', () => {
    expect(goalRoundFrom(roundPrompt(0))).toBeUndefined()
  })

  it('rejects an ordinary prompt that mentions rounds', () => {
    expect(goalRoundFrom('we shipped 3/4 of the work, continue')).toBeUndefined()
  })

  it('rejects an empty prompt', () => {
    expect(goalRoundFrom('')).toBeUndefined()
  })
})

describe('isGoalOpeningPrompt', () => {
  it('recognises the goal block', () => {
    expect(isGoalOpeningPrompt(roundPrompt(1))).toBe(true)
  })

  it('rejects a human prompt', () => {
    expect(isGoalOpeningPrompt('fix the sidebar')).toBe(false)
  })
})

describe('StallDetector', () => {
  const runRound = (detector: ReturnType<typeof StallDetector>, round: number, produced: boolean): ReturnType<ReturnType<typeof StallDetector>['turnEnded']> => {
    detector.turnStarted()
    detector.promptEntered(roundPrompt(round))
    detector.turnIdentified(round)
    if (produced) detector.contentProduced()
    return detector.turnEnded()
  }

  it('does not stall below the threshold', () => {
    const detector = StallDetector()
    expect(runRound(detector, 1, false)).toMatchObject({ stalled: false, consecutiveEmptyRounds: 1 })
    expect(runRound(detector, 2, false)).toMatchObject({ stalled: false, consecutiveEmptyRounds: 2 })
  })

  it('stalls on the third consecutive empty round', () => {
    const detector = StallDetector()
    runRound(detector, 1, false)
    runRound(detector, 2, false)
    const decision = runRound(detector, 3, false)
    expect(decision.stalled).toBe(true)
    expect(decision.consecutiveEmptyRounds).toBe(3)
    expect(decision.round).toBe(3)
  })

  it('resets the run when a round produces content', () => {
    const detector = StallDetector()
    runRound(detector, 1, false)
    runRound(detector, 2, false)
    expect(runRound(detector, 3, true).consecutiveEmptyRounds).toBe(0)
    expect(runRound(detector, 4, false).consecutiveEmptyRounds).toBe(1)
    expect(runRound(detector, 5, false).stalled).toBe(false)
  })

  it('ignores empty turns that are not goal rounds', () => {
    const detector = StallDetector()
    for (let index = 0; index < 10; index += 1) {
      detector.turnStarted()
      detector.promptEntered('a human typed something')
      detector.turnIdentified(index)
      const decision = detector.turnEnded()
      expect(decision.stalled).toBe(false)
      expect(decision.consecutiveEmptyRounds).toBe(0)
      expect(decision.round).toBeUndefined()
    }
  })

  it('ignores a tool-only round because its tool call is content', () => {
    const detector = StallDetector()
    detector.turnStarted()
    detector.promptEntered(roundPrompt(1))
    detector.turnIdentified(1)
    detector.contentProduced()
    expect(detector.turnEnded().stalled).toBe(false)
  })

  it('honours a custom threshold', () => {
    const detector = StallDetector({ threshold: 1 })
    expect(runRound(detector, 1, false).stalled).toBe(true)
  })

  it('defaults to three', () => {
    expect(DEFAULT_STALL_POLICY.threshold).toBe(3)
  })

  it('reproduces the recorded loop: rounds 1-53 work, 54-164 do not', () => {
    const detector = StallDetector()
    let stalledAt: number | undefined
    for (let round = 1; round <= 164; round += 1) {
      const empty = round > 53
      const decision = runRound(detector, round, !empty)
      if (decision.stalled && stalledAt === undefined) stalledAt = round
    }
    expect(stalledAt).toBe(56)
  })
})

describe('Config', () => {
  it('accepts the absent config a row without a config key produces', () => {
    expect(Config.parse(undefined)).toEqual({ stallThreshold: DEFAULT_STALL_POLICY.threshold })
  })

  it('accepts an explicit empty config', () => {
    expect(Config.parse({})).toEqual({ stallThreshold: DEFAULT_STALL_POLICY.threshold })
  })

  it('keeps an explicit threshold', () => {
    expect(Config.parse({ stallThreshold: 9 })).toEqual({ stallThreshold: 9 })
  })

  it('rejects a threshold below the floor', () => {
    expect(() => Config.parse({ stallThreshold: 1 })).toThrow()
  })
})
