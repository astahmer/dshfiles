import type { SessionId } from '@dshfiles/dshx/ids'
import { Context, Effect, Layer } from 'effect'
import type { ReviewResult, SummarizeResult, SummaryFailureReason } from './api.js'
import { ReviewWorkspace } from './review.js'
import { SummaryRoutes } from './summary-routes-promise.js'

type OkReview = Extract<ReviewResult, { readonly status: 'ok' }>

/** How much of the patch one summary call may carry; the scopes' file lists are always complete. */
const MAX_SUMMARY_PATCH_CHARS = 20_000
const MAX_SUMMARY_CHARS = 600

const SUMMARY_SYSTEM_PROMPT = [
  'You help a reviewer understand a change before reading it.',
  'You receive a git patch and the review scopes its files were grouped into.',
  'Answer with one line per scope and nothing else: the scope key, a colon, then one or two plain sentences.',
  'Do not use JSON, code fences, bullets or headings. Do not restate file names or line counts.',
  'Use exactly the scope keys you were given, once each; do not invent scopes.',
].join(' ')

const buildSummaryInput = (review: OkReview): string => {
  const patch = review.patch.length > MAX_SUMMARY_PATCH_CHARS ? `${review.patch.slice(0, MAX_SUMMARY_PATCH_CHARS)}\n… (patch truncated)` : review.patch
  const scopes = review.scopes
    .map(scope => `${scope.key} (${scope.label}) — ${scope.summary}\n${scope.filePaths.map(path => `  ${path}`).join('\n')}`)
    .join('\n\n')
  return `Scopes:\n${scopes}\n\nPatch:\n${patch}`
}

/** `key: text`, tolerating a capitalised key, a list marker or a dash instead of the colon. */
const KEYED_LINE = /^\s*(?:[-*•]|\d+[.)])?\s*([A-Za-z][A-Za-z0-9_-]*)\s*[:–—-]\s*(.+)$/u

/** Drop the quoting a model wraps around a fragment, and a trailing separator. */
const cleanFragment = (value: string): string => value.replace(/^["'`\s]+/u, '').replace(/["'`\s]*[,;]?\s*$/u, '')

/**
 * Read the per-scope answer as `key: text` lines. A line that names no known
 * scope continues the previous one, so a wrapped sentence survives; unknown
 * keys and a missing scope are dropped rather than invented.
 */
const parseSummaryResponse = (text: string, keys: readonly string[]): Record<string, string> | undefined => {
  const known = new Set(keys)
  const summaries: Record<string, string> = {}
  let current: string | undefined
  for (const line of text.split('\n')) {
    const match = KEYED_LINE.exec(line)
    const key = match?.[1]?.toLowerCase()
    if (match !== null && key !== undefined) {
      // A foreign or repeated key is noise, not a continuation of the previous scope.
      if (!known.has(key) || summaries[key] !== undefined) continue
      current = key
      summaries[key] = cleanFragment(match[2] ?? '')
      continue
    }
    const continuation = line.trim()
    if (current !== undefined && continuation.length > 0 && !continuation.startsWith('```') && !continuation.startsWith('{')) {
      const folded = cleanFragment(continuation)
      if (folded.length > 0) summaries[current] = `${summaries[current] ?? ''} ${folded}`.trim()
    }
  }
  const cleaned: Record<string, string> = {}
  for (const [key, value] of Object.entries(summaries)) {
    const summary = value.trim().slice(0, MAX_SUMMARY_CHARS)
    if (summary.length > 0) cleaned[key] = summary
  }
  return Object.keys(cleaned).length === 0 ? undefined : cleaned
}

export interface SummarizeInput {
  readonly path: string
  readonly base?: string | undefined
  readonly sessionId?: SessionId | undefined
  readonly provider?: string | undefined
  readonly model?: string | undefined
}

const messages = {
  'no-route': 'No model route is available for this thread; set a model on the thread and retry.',
  'llm-unavailable': 'The Host has no language-model service to summarize with.',
  'llm-failed': 'The model call failed; the thread model may be unavailable.',
  unparsed: 'The model answered without usable per-scope summaries.',
  'review-failed': 'The workspace diff could not be read, so there is nothing to summarize.',
  'no-changes': 'This thread has no changes to summarize yet.',
} satisfies Record<SummaryFailureReason, string>

const failure = (reason: SummaryFailureReason, message = messages[reason]): SummarizeResult => ({ status: 'failed', reason, message })

/** Read the workspace again and let the thread's own model summarize each scope. */
export class PullsReviewSummary extends Context.Service<
  PullsReviewSummary,
  { readonly summarize: (input: SummarizeInput) => Effect.Effect<SummarizeResult> }
>()('@dshfiles/pulls-review/PullsReviewSummary') {
  static readonly layer = Layer.effect(
    PullsReviewSummary,
    Effect.gen(function* () {
      const workspace = yield* ReviewWorkspace
      const routes = yield* SummaryRoutes

      const resolveRoute = Effect.fn('review summary route')(function* (input: SummarizeInput) {
        const provider = input.provider ?? (input.sessionId === undefined ? undefined : yield* routes.providerOf(input.sessionId))
        if (provider === undefined || provider.length === 0) return undefined
        if (input.model !== undefined && input.model.length > 0) return { provider, model: input.model }
        const model = (yield* routes.modelsOf(provider))[0]
        return model === undefined ? undefined : { provider, model }
      })

      const summarize = Effect.fn('pulls-review summarize')(
        function* (input: SummarizeInput) {
          if (!routes.available) return failure('llm-unavailable')
          const review = yield* workspace.review({ path: input.path, base: input.base })
          if (review.status === 'failed') return failure('review-failed', review.message)
          if (review.fileCount === 0) return failure('no-changes')
          const route = yield* resolveRoute(input)
          if (route === undefined) return failure('no-route')
          const answer = yield* routes.complete({ ...route, sessionId: input.sessionId, system: SUMMARY_SYSTEM_PROMPT, input: buildSummaryInput(review) })
          const summaries = parseSummaryResponse(
            answer,
            review.scopes.map(scope => scope.key),
          )
          return summaries === undefined ? failure('unparsed') : ({ status: 'ok', route, summaries } satisfies SummarizeResult)
        },
        effect =>
          effect.pipe(
            Effect.catchTags({
              PullsReviewOperationError: error => Effect.succeed(failure('review-failed', error.message)),
              LlmCallFailed: () => Effect.succeed(failure('llm-failed')),
            }),
          ),
      )

      return PullsReviewSummary.of({ summarize })
    }),
  )
}

export class PullsReviewSummaryModel {
  static readonly buildInput = buildSummaryInput
  static readonly parseResponse = parseSummaryResponse
}
