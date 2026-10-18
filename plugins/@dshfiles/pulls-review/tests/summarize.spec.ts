import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { JjRun, JjRunInput } from '../src/jj.js'
import { PullsReviewSummaryModel } from '../src/summarize.js'

const PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1 +1 @@',
  '-const answer = 1',
  '+const answer = 2',
  '',
].join('\n')

const run: JjRun = async (input: JjRunInput) => {
  if (input.args[0] === 'log') return { stdout: input.args[2] === '@' ? 'abc1234\n' : 'def5678\n', truncated: false }
  return { stdout: PATCH, truncated: false }
}

const answer = (text: string) => async () => text

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
  const routes = { providerOf: async () => 'acme', modelsOf: async () => ['acme-first', 'acme-big'] }
  const common = () => ({ run, path: workspace, sessionId: 'session-1', routes })

  let workspace = ''

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pulls-review-summary-'))
  })

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('uses the thread provider with the first model it offers, and lends it the session id', async () => {
    const seen: { route: string; sessionId?: string | undefined }[] = []
    const result = await PullsReviewSummaryModel.summarize({
      ...common(),
      complete: async request => {
        seen.push({ route: `${request.provider}/${request.model}`, sessionId: request.sessionId })
        return 'code: Adds a second answer.'
      },
    })
    expect(result).toEqual({ status: 'ok', route: { provider: 'acme', model: 'acme-first' }, summaries: { code: 'Adds a second answer.' } })
    expect(seen).toEqual([{ route: 'acme/acme-first', sessionId: 'session-1' }])
  })

  it('honours an explicit provider and model over the thread route', async () => {
    const result = await PullsReviewSummaryModel.summarize({
      ...common(),
      provider: 'other',
      model: 'other-large',
      complete: answer('code: Explicit.'),
    })
    expect(result).toEqual({ status: 'ok', route: { provider: 'other', model: 'other-large' }, summaries: { code: 'Explicit.' } })
  })

  it('reports no route when neither the caller nor the thread names a provider', async () => {
    const result = await PullsReviewSummaryModel.summarize({
      run,
      path: workspace,
      sessionId: 'session-1',
      routes: { providerOf: async () => undefined, modelsOf: async () => [] },
      complete: answer('code: never called'),
    })
    expect(result).toMatchObject({ status: 'failed', reason: 'no-route' })
  })

  it('reports no route when the provider offers no model', async () => {
    const result = await PullsReviewSummaryModel.summarize({ ...common(), routes: { ...routes, modelsOf: async () => [] }, complete: answer('code: no') })
    expect(result).toMatchObject({ status: 'failed', reason: 'no-route' })
  })

  it('reports an unusable answer instead of inventing summaries', async () => {
    const result = await PullsReviewSummaryModel.summarize({ ...common(), complete: answer('Sorry, I cannot.') })
    expect(result).toMatchObject({ status: 'failed', reason: 'unparsed' })
  })

  it('names the real reason instead of blaming the model', async () => {
    const empty = await PullsReviewSummaryModel.summarize({
      ...common(),
      run: async input => (input.args[0] === 'log' ? { stdout: 'abc1234\n', truncated: false } : { stdout: '', truncated: false }),
      complete: answer('code: never called'),
    })
    expect(empty).toMatchObject({ status: 'failed', reason: 'no-changes' })

    const broken = await PullsReviewSummaryModel.summarize({
      ...common(),
      run: async () => ({ stdout: '', truncated: false }),
      complete: answer('code: never called'),
    })
    expect(broken).toMatchObject({ status: 'failed', reason: 'review-failed' })
  })
})
