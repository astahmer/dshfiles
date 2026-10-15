import type { PendingUserQuestion } from '@deepseek-ai/dsh-user-questions'
import type { ParentQuestionInboxEntry } from './service.js'
import type { QuestionWaitRecord } from './question-wait-projection.js'

const nativeRecommendedLabelPattern = /\(Recommended\)\s*$/i

type NativeQuestion = NativeQuestionInboxItem['questions'][number]
type NativeQuestionOption = NativeQuestion['options'][number]
type ChildQuestionOption = ChildQuestionInboxItem['options'][number]

export interface NativeQuestionInboxItem {
  readonly kind: 'native'
  readonly sessionId: string
  readonly callId: string
  readonly state: 'open' | 'continued'
  readonly waitMode: 'blocking' | 'timed' | 'unknown'
  readonly blocking: boolean | null
  readonly startedAt: number | null
  readonly deadlineAt: number | null
  readonly remainingMs: number | null
  readonly countdownBasis: 'event-derived-estimate' | 'unavailable'
  readonly observedAt: number
  readonly sessionLive: boolean
  readonly sessionPersisted: boolean
  readonly canAnswer: boolean
  readonly answerability: 'open-form-uses-native-waterfall' | 'session-not-live' | 'target-not-live-root' | 'continued-form-can-be-answered'
  readonly questions: {
    readonly id: string
    readonly question: string
    readonly detail?: string
    readonly header?: string
    readonly options: { readonly label: string; readonly description?: string; readonly recommended: boolean }[]
    readonly multiSelect: boolean
    readonly intent?: { readonly kind: 'plan-review'; readonly approve: string }
  }[]
}

export interface ChildQuestionInboxItem {
  readonly kind: 'child'
  readonly sessionId: string
  readonly questionId: string
  readonly question: string
  readonly context?: string
  readonly options: { readonly id: string; readonly label: string; readonly description?: string; readonly recommended: boolean }[]
  readonly recommendedOptionId?: string
  readonly expiryBehavior?: ParentQuestionInboxEntry['expiryBehavior']
  readonly status: 'pending'
  readonly createdAt: number
  readonly expiresAt: number
  readonly remainingMs: number
  readonly expired: boolean
  readonly blocksParent: false
  readonly blocksChild: true
  readonly canAnswer: boolean
}

export const projectNativeQuestion = (input: {
  readonly sessionId: string
  readonly sessionLive: boolean
  readonly sessionPersisted: boolean
  readonly targetIsLiveRoot: boolean
  readonly pending: PendingUserQuestion
  readonly wait?: QuestionWaitRecord
  readonly observedAt: number
}): NativeQuestionInboxItem => {
  const waits = input.wait?.waitMode === 'blocking' || input.wait?.waitMode === 'timed'
  const blocking = input.pending.state === 'continued' ? false : waits || null
  const canAnswer = input.pending.state === 'continued' && input.sessionLive && input.targetIsLiveRoot
  const answerability = ((): NativeQuestionInboxItem['answerability'] => {
    if (!input.sessionLive) return 'session-not-live'
    if (input.pending.state === 'open') return 'open-form-uses-native-waterfall'
    if (!input.targetIsLiveRoot) return 'target-not-live-root'
    return 'continued-form-can-be-answered'
  })()
  const questions = input.pending.questions.map(question => {
    const options = (question.options ?? []).map(option => {
      const projectedOption = {
        label: option.label,
        recommended: nativeRecommendedLabelPattern.test(option.label),
      } satisfies NativeQuestionOption
      return option.description === undefined ? projectedOption : { ...projectedOption, description: option.description }
    })
    const projectedQuestion = {
      id: question.id,
      question: question.question,
      options,
      multiSelect: question.multiSelect ?? false,
    } satisfies NativeQuestion
    const questionWithDetail = question.detail === undefined ? projectedQuestion : { ...projectedQuestion, detail: question.detail }
    const questionWithHeader = question.header === undefined ? questionWithDetail : { ...questionWithDetail, header: question.header }
    return question.intent?.kind === 'plan-review'
      ? { ...questionWithHeader, intent: { kind: question.intent.kind, approve: question.intent.approve } }
      : questionWithHeader
  })

  return {
    kind: 'native',
    sessionId: input.sessionId,
    callId: input.pending.callId,
    state: input.pending.state,
    waitMode: input.wait?.waitMode ?? 'unknown',
    blocking,
    startedAt: input.wait?.startedAt ?? null,
    deadlineAt: input.wait?.deadlineAt ?? null,
    remainingMs:
      input.pending.state === 'open' && input.wait?.waitMode === 'timed' && input.wait.deadlineAt !== null
        ? Math.max(0, input.wait.deadlineAt - input.observedAt)
        : null,
    countdownBasis: input.wait?.waitMode === 'timed' && input.wait.deadlineAt !== null ? 'event-derived-estimate' : 'unavailable',
    observedAt: input.observedAt,
    sessionLive: input.sessionLive,
    sessionPersisted: input.sessionPersisted,
    canAnswer,
    answerability,
    questions,
  }
}

export const projectParentQuestion = (entry: ParentQuestionInboxEntry): ChildQuestionInboxItem => {
  const options = entry.options.map(option => {
    const projectedOption = {
      id: option.id,
      label: option.label,
      recommended: option.id === entry.recommendedOptionId,
    } satisfies ChildQuestionOption
    return option.description === undefined ? projectedOption : { ...projectedOption, description: option.description }
  })
  const projectedQuestion = {
    kind: 'child',
    sessionId: entry.childSessionId,
    questionId: entry.questionId,
    question: entry.question,
    options,
    status: 'pending',
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    remainingMs: entry.remainingMs,
    expired: entry.expired,
    blocksParent: false,
    blocksChild: true,
    canAnswer: !entry.expired,
  } satisfies ChildQuestionInboxItem
  const questionWithContext = entry.context === undefined ? projectedQuestion : { ...projectedQuestion, context: entry.context }
  const questionWithRecommendation =
    entry.recommendedOptionId === undefined ? questionWithContext : { ...questionWithContext, recommendedOptionId: entry.recommendedOptionId }
  return entry.expiryBehavior === undefined ? questionWithRecommendation : { ...questionWithRecommendation, expiryBehavior: entry.expiryBehavior }
}
