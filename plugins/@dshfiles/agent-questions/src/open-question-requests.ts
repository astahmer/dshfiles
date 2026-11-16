import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'

/** The parts of one `user-questions/request` dispatch this holder reads. `signal` is replaced for the listeners after it. */
export interface OpenQuestionRequest {
  readonly agent?: { readonly id: string } | undefined
  readonly questions: ReadonlyArray<{ readonly id: string }>
  signal?: AbortSignal | undefined
  readonly wait?: { readonly callId: string } | undefined
}

interface Held {
  readonly questionIds: readonly string[]
  readonly settle: (answer: AskUserQuestionAnswer) => void
  readonly retract: AbortController
}

const keyOf = (sessionId: string, callId: string): string => `${sessionId}:${callId}`

/**
 * Native question forms that are still open, held so the Host can settle them.
 *
 * DSH asks an open form through the `user-questions/request` waterfall and its `answer` method takes continued forms
 * only, so until now only the browser showing the form could answer it. This holder is one more answerer on that
 * waterfall: it hands the request on to the browser as before and races its own answer against the browser's. The
 * tool call receives whichever comes first, as its ordinary result; nothing is recorded that DSH would not record.
 *
 * When the Host answers, the request the browser still shows is retracted through the request's own cancellation
 * signal, the same one a cancelled turn uses, so no card is left waiting for an answer nobody reads.
 */
export class OpenQuestionRequests {
  static readonly keyOf = keyOf
  readonly #held = new Map<string, Held>()

  /** Whether the form of this tool call is open and held here. */
  has(sessionId: string, callId: string): boolean {
    return this.#held.has(keyOf(sessionId, callId))
  }

  /**
   * Settle a held form with a complete batch, one item per question.
   * @returns `answered`, `not-held` when no open form of that call is held, or `bad-answer` for an incomplete batch.
   */
  answer(input: { readonly sessionId: string; readonly callId: string; readonly answer: AskUserQuestionAnswer }): 'answered' | 'not-held' | 'bad-answer' {
    const key = keyOf(input.sessionId, input.callId)
    const held = this.#held.get(key)
    if (held === undefined) return 'not-held'
    const answered = new Set(input.answer.answers.map(item => item.id))
    if (answered.size !== input.answer.answers.length || answered.size !== held.questionIds.length || !held.questionIds.every(id => answered.has(id))) {
      return 'bad-answer'
    }
    this.#held.delete(key)
    held.settle(input.answer)
    held.retract.abort(new Error('ask_user_question was answered from outside its thread'))
    return 'answered'
  }

  /**
   * The waterfall listener: hold a keyed request of a live agent, pass every other one through untouched.
   * @param request - the dispatch's request; later listeners read the cancellation signal set here.
   * @param next - the listeners after this one (the browser answerer).
   */
  readonly listener = <Request extends OpenQuestionRequest>(request: Request, next: () => Promise<AskUserQuestionAnswer>): Promise<AskUserQuestionAnswer> => {
    const sessionId = request.agent?.id
    const callId = request.wait?.callId
    if (sessionId === undefined || callId === undefined) return next()
    const key = keyOf(String(sessionId), String(callId))
    // One open request per tool call: a second dispatch for a held call is not ours to race.
    if (this.#held.has(key)) return next()
    const retract = new AbortController()
    try {
      request.signal = request.signal === undefined ? retract.signal : AbortSignal.any([request.signal, retract.signal])
    } catch {
      // A request that cannot carry the retraction is left to the browser alone, as before.
      return next()
    }
    let settle: (answer: AskUserQuestionAnswer) => void = () => undefined
    const outside = new Promise<AskUserQuestionAnswer>(resolve => {
      settle = resolve
    })
    const held: Held = { questionIds: request.questions.map(question => question.id), settle, retract }
    this.#held.set(key, held)
    const release = (): void => {
      if (this.#held.get(key) === held) this.#held.delete(key)
    }
    const forwarded = Promise.resolve().then(next).finally(release)
    // Once the outside answer wins, the retracted browser request rejects; that rejection has no reader left.
    forwarded.catch(() => undefined)
    return Promise.race([forwarded, outside])
  }
}
