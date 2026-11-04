import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem } from '@effect/platform-node'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { ReviewJj, type JjReadFailed, type JjReadInput, type JjReadOutput } from '../src/jj.js'
import { ReviewWorkspace } from '../src/review.js'
import { PullsReviewSummary, PullsReviewSummaryModel, type SummarizeInput } from '../src/summarize.js'
import { SummaryRoutes, type SummaryCompletion } from '../src/summary-routes-promise.js'

const PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1 +1 @@',
  '-const answer = 1',
  '+const answer = 2',
  '',
].join('\n')

type JjRead = (input: JjReadInput) => Effect.Effect<JjReadOutput, JjReadFailed>

const run: JjRead = input =>
  Effect.succeed(
    input.args[0] === 'log' ? { stdout: input.args[2] === '@' ? 'abc1234\n' : 'def5678\n', truncated: false } : { stdout: PATCH, truncated: false },
  )

type Routes = Pick<SummaryRoutes['Service'], 'providerOf' | 'modelsOf'>

const answer = (text: string) => (_request: SummaryCompletion) => Effect.succeed(text)

/** jj and the model are the external systems; the review and summary services above them are real. */
const summarizeOver = (input: SummarizeInput & { readonly read?: JjRead; readonly routes: Routes; readonly complete: SummaryRoutes['Service']['complete'] }) =>
  PullsReviewSummary.use(summary => summary.summarize(input)).pipe(
    Effect.provide(
      PullsReviewSummary.layer.pipe(
        Layer.provide(
          Layer.merge(
            ReviewWorkspace.layer.pipe(Layer.provide(Layer.merge(Layer.succeed(ReviewJj, ReviewJj.of({ read: input.read ?? run })), NodeFileSystem.layer))),
            Layer.succeed(SummaryRoutes, SummaryRoutes.of({ available: true, ...input.routes, complete: input.complete })),
          ),
        ),
      ),
    ),
  )

describe('parseSummaryResponse', () => {
  it('reads one keyed line per scope', () => {
    const text = 'code: Adds a second answer.\ndocs: Tidies the docs.\n'
    expect(PullsReviewSummaryModel.parseResponse(text, ['code', 'docs'])).toEqual({ code: 'Adds a second answer.', docs: 'Tidies the docs.' })
  })

  it('tolerates bullets, case, wrapped sentences and quotes, and drops unknown scopes', () => {
    const text = ['- Code: "Adds a second answer",', '  and keeps the old one working.', 'Docs: 7', 'never-heard-of: ignored'].join('\n')
    expect(PullsReviewSummaryModel.parseResponse(text, ['code', 'docs'])).toEqual({
      code: 'Adds a second answer and keeps the old one working.',
      docs: '7',
    })
  })

  it('returns undefined for prose, an empty answer and a JSON-only answer', () => {
    expect(PullsReviewSummaryModel.parseResponse('I could not summarize this.', ['code'])).toBeUndefined()
    expect(PullsReviewSummaryModel.parseResponse('code:    ', ['code'])).toBeUndefined()
    expect(PullsReviewSummaryModel.parseResponse('{"code":"Adds a second answer."}', ['code'])).toBeUndefined()
  })
})

describe('buildSummaryInput', () => {
  it('names every scope with its files and carries the patch', () => {
    const input = PullsReviewSummaryModel.buildInput({
      status: 'ok',
      path: '/work',
      base: 'main',
      head: 'abc1234',
      range: 'main..@',
      patch: PATCH,
      truncated: false,
      fileCount: 1,
      additions: 1,
      deletions: 1,
      files: [{ path: 'src/app.ts', status: 'modified', additions: 1, deletions: 1 }],
      scopes: [{ key: 'code', category: 'core', label: 'Code', summary: 'Source changes.', filePaths: ['src/app.ts'], additions: 1, deletions: 1 }],
    })
    expect(input).toContain('code (Code) — Source changes.')
    expect(input).toContain('  src/app.ts')
    expect(input).toContain('+const answer = 2')
  })
})

describe('summarizeWorkspace', () => {
  const routes: Routes = { providerOf: () => Effect.succeed('acme'), modelsOf: () => Effect.succeed(['acme-first', 'acme-big']) }
  const common = () => ({ path: workspace, sessionId: 'session-1', routes })

  let workspace = ''

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pulls-review-summary-'))
  })

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it.effect('uses the thread provider with the first model it offers, and lends it the session id', () =>
    Effect.gen(function* () {
      const seen: { route: string; sessionId?: string | undefined }[] = []
      const result = yield* summarizeOver({
        ...common(),
        complete: request =>
          Effect.sync(() => {
            seen.push({ route: `${request.provider}/${request.model}`, sessionId: request.sessionId })
            return 'code: Adds a second answer.'
          }),
      })
      expect(result).toEqual({ status: 'ok', route: { provider: 'acme', model: 'acme-first' }, summaries: { code: 'Adds a second answer.' } })
      expect(seen).toEqual([{ route: 'acme/acme-first', sessionId: 'session-1' }])
    }),
  )

  it.effect('honours an explicit provider and model over the thread route', () =>
    Effect.gen(function* () {
      const result = yield* summarizeOver({
        ...common(),
        provider: 'other',
        model: 'other-large',
        complete: answer('code: Explicit.'),
      })
      expect(result).toEqual({ status: 'ok', route: { provider: 'other', model: 'other-large' }, summaries: { code: 'Explicit.' } })
    }),
  )

  it.effect('reports no route when neither the caller nor the thread names a provider', () =>
    Effect.gen(function* () {
      const result = yield* summarizeOver({
        path: workspace,
        sessionId: 'session-1',
        routes: { providerOf: () => Effect.succeed(undefined), modelsOf: () => Effect.succeed([]) },
        complete: answer('code: never called'),
      })
      expect(result).toMatchObject({ status: 'failed', reason: 'no-route' })
    }),
  )

  it.effect('reports no route when the provider offers no model', () =>
    Effect.gen(function* () {
      const result = yield* summarizeOver({ ...common(), routes: { ...routes, modelsOf: () => Effect.succeed([]) }, complete: answer('code: no') })
      expect(result).toMatchObject({ status: 'failed', reason: 'no-route' })
    }),
  )

  it.effect('reports an unusable answer instead of inventing summaries', () =>
    Effect.gen(function* () {
      const result = yield* summarizeOver({ ...common(), complete: answer('Sorry, I cannot.') })
      expect(result).toMatchObject({ status: 'failed', reason: 'unparsed' })
    }),
  )

  it.effect('names the real reason instead of blaming the model', () =>
    Effect.gen(function* () {
      const empty = yield* summarizeOver({
        ...common(),
        read: input => Effect.succeed(input.args[0] === 'log' ? { stdout: 'abc1234\n', truncated: false } : { stdout: '', truncated: false }),
        complete: answer('code: never called'),
      })
      expect(empty).toMatchObject({ status: 'failed', reason: 'no-changes' })

      const broken = yield* summarizeOver({
        ...common(),
        read: () => Effect.succeed({ stdout: '', truncated: false }),
        complete: answer('code: never called'),
      })
      expect(broken).toMatchObject({ status: 'failed', reason: 'review-failed' })
    }),
  )
})
