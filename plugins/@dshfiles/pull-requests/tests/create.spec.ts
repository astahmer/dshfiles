import type { ApiCaller } from '@dshfiles/dshx/api'
import { Jj, JjSpawnFailed, type JjCommand, type JjOutput } from '@dshfiles/jj-cli'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { PullRequestCreator } from '../src/create.js'
import { CreateModel } from '../src/create-model.js'
import { GhCommandFailed, GitHubCli, type GitHubPullRequestCreate } from '../src/github-cli.js'
import { PullRequestMonitor } from '../src/monitor.js'
import { ProjectBase } from '../src/project-base.js'
import type { PullRequestRecord } from '../src/pull-request-model.js'
import { ThreadContext, type ThreadCompletion } from '../src/thread-context.js'

const SESSION = 'session-create-test'
const CWD = '/work/widget'
const HEAD = 'a'.repeat(40)
const PARENT = 'b'.repeat(40)
const caller: ApiCaller = { kind: 'agent', sessionId: SESSION, cwd: CWD }

const ok = (stdout = ''): JjOutput => ({ exitCode: 0, stdout, stdoutTruncated: false, stderr: '', stderrTruncated: false })
const fail = (stderr: string): JjOutput => ({ exitCode: 1, stdout: '', stdoutTruncated: false, stderr, stderrTruncated: false })

interface JjScript {
  remotes?: string
  baseFound?: boolean
  working?: 'empty' | 'content'
  commits?: string
  bookmarks?: string
  bookmarkSet?: JjOutput
  push?: JjOutput
  missing?: boolean
}

const commitLine = (input: { change: string; commit: string; conflict?: boolean; described?: boolean; summary: string }) =>
  `${input.change}\t${input.commit}\t${input.conflict === true ? 'c' : '-'}\t${input.described === false ? '-' : 'd'}\t${input.summary}\n`

const defaultCommits =
  commitLine({ change: 'kkkkkkkkkkkk', commit: HEAD, summary: 'feat(widget): add sprockets' }) +
  commitLine({ change: 'llllllllllll', commit: PARENT, summary: 'refactor(widget): split gears' })

const fakeJj = (script: JjScript, calls: string[][]) =>
  Layer.succeed(
    Jj,
    Jj.of({
      run: (command: JjCommand) =>
        Effect.suspend(() => {
          calls.push([...command.args])
          if (script.missing === true) return Effect.fail(new JjSpawnFailed({ verb: '', reason: 'executable-not-found' }))
          const [first, second] = command.args
          const revset = command.args[command.args.indexOf('-r') + 1] ?? ''
          if (first === 'git' && second === 'remote') return Effect.succeed(ok(script.remotes ?? 'origin git@github.com:acme/widget.git\n'))
          if (first === 'git' && second === 'push') return Effect.succeed(script.push ?? ok())
          if (first === 'bookmark') return Effect.succeed(script.bookmarkSet ?? ok())
          if (revset.startsWith('present(')) return Effect.succeed(ok(script.baseFound === false ? '' : PARENT))
          if (revset === '@' && command.args.includes('-T') && command.args.some(arg => arg.includes('"empty"')))
            return Effect.succeed(ok(script.working ?? 'empty'))
          if (revset.includes('..')) return Effect.succeed(ok(script.commits ?? defaultCommits))
          if (command.args.some(arg => arg.includes('local_bookmarks'))) return Effect.succeed(ok(script.bookmarks ?? ''))
          return Effect.succeed(fail(`unexpected jj ${command.args.join(' ')}`))
        }),
      exec: () => Effect.die('exec is not used by the create flow'),
    }),
  )

interface GhScript {
  auth?: 'ok' | 'missing' | 'unauthenticated'
  repo?: 'ok' | 'unknown'
  existing?: string | null
  create?: 'ok' | 'fail'
}

const fakeGh = (script: GhScript, created: GitHubPullRequestCreate[]) =>
  Layer.succeed(
    GitHubCli,
    GitHubCli.of({
      repositoryName: () => Effect.succeed('acme/widget'),
      pullRequest: () => Effect.die('pullRequest is not used here'),
      authStatus:
        script.auth === 'missing'
          ? Effect.fail(new GhCommandFailed({ operation: 'auth-status', rateLimited: false, missing: true }))
          : script.auth === 'unauthenticated'
            ? Effect.fail(new GhCommandFailed({ operation: 'auth-status', rateLimited: false, exitCode: 1 }))
            : Effect.void,
      repositoryInfo: () =>
        script.repo === 'unknown'
          ? Effect.fail(new GhCommandFailed({ operation: 'repo-info', rateLimited: false, exitCode: 1 }))
          : Effect.succeed({ repo: 'acme/widget', defaultBranch: 'main' }),
      openPullRequestFor: () => Effect.succeed(script.existing ?? null),
      createPullRequest: input =>
        Effect.suspend(() => {
          created.push(input)
          return script.create === 'fail'
            ? Effect.fail(new GhCommandFailed({ operation: 'pr-create', rateLimited: false, exitCode: 1, detail: 'a pull request already exists' }))
            : Effect.succeed('https://github.com/acme/widget/pull/7')
        }),
    }),
  )

const fakeThread = (completions: ThreadCompletion[], answer = 'Add sprockets to the widget\n\nThe widget now spins sprockets.\n\n## Changes\n\n- sprockets') =>
  Layer.succeed(
    ThreadContext,
    ThreadContext.of({
      read: () =>
        Effect.succeed({
          cwd: CWD,
          title: 'Widget sprockets',
          route: { provider: 'test-provider', model: 'test-model' },
          messages: [
            { role: 'user', text: 'Please add sprockets to the widget.' },
            { role: 'assistant', text: 'Added sprockets; tests pass.' },
          ],
        }),
      canGenerate: true,
      complete: request =>
        Effect.suspend(() => {
          completions.push(request)
          return Effect.succeed(answer)
        }),
    }),
  )

const record = (input: { sessionId: string; url: string; watching: boolean }): PullRequestRecord => ({
  id: `${input.sessionId}::acme/widget#7`,
  sessionId: input.sessionId,
  repo: 'acme/widget',
  number: 7,
  url: input.url,
  cwd: CWD,
  watching: input.watching,
  lastKnownState: null,
  lastCheckedAt: null,
  retryAfterAt: null,
  consecutiveRateLimits: 0,
  lastError: null,
})

const fakeMonitor = (links: { kind: 'watch' | 'link'; url: string; sessionId: string }[]) =>
  Layer.succeed(
    PullRequestMonitor,
    PullRequestMonitor.of({
      link: input =>
        Effect.sync(() => {
          const url = 'url' in input ? input.url : ''
          links.push({ kind: 'link', url, sessionId: input.sessionId ?? '' })
          return record({ sessionId: input.sessionId ?? '', url, watching: false })
        }),
      watch: input =>
        Effect.sync(() => {
          const url = 'url' in input ? input.url : ''
          links.push({ kind: 'watch', url, sessionId: input.sessionId ?? '' })
          return record({ sessionId: input.sessionId ?? '', url, watching: true })
        }),
      unlink: () => Effect.die('unused'),
      list: () => Effect.die('unused'),
      unwatch: () => Effect.die('unused'),
      pollAll: Effect.void,
    }),
  )

const harness = (options: { jj?: JjScript; gh?: GhScript; answer?: string; projectBase?: string } = {}) => {
  const jjCalls: string[][] = []
  const created: GitHubPullRequestCreate[] = []
  const completions: ThreadCompletion[] = []
  const links: { kind: 'watch' | 'link'; url: string; sessionId: string }[] = []
  const layer = PullRequestCreator.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        fakeJj(options.jj ?? {}, jjCalls),
        fakeGh(options.gh ?? {}, created),
        fakeThread(completions, options.answer),
        fakeMonitor(links),
        options.projectBase === undefined
          ? ProjectBase.none
          : Layer.succeed(ProjectBase, ProjectBase.of({ chosenFor: () => Effect.succeed(options.projectBase) })),
      ),
    ),
  )
  return { layer, jjCalls, created, completions, links }
}

const confirmed = { confirm: true as const, title: 'Add sprockets', body: 'Body', bookmark: 'dsh/widget-sprockets', base: 'main', headCommitId: HEAD }

describe('pull request creation', () => {
  it.effect('targets the project main branch when the project chose one, instead of the GitHub default branch', () => {
    const run = harness({ projectBase: 'develop' })
    return Effect.gen(function* () {
      const preview = yield* PullRequestCreator.use(creator => creator.preview({}, caller))
      expect(preview.base).toBe('develop')
      expect(run.jjCalls.some(args => args.includes('present("develop"@"origin")'))).toBe(true)
    }).pipe(Effect.provide(run.layer))
  })

  it.effect('previews the commits, bookmark and a model-drafted title and body without writing', () => {
    const run = harness()
    return Effect.gen(function* () {
      const preview = yield* PullRequestCreator.use(creator => creator.preview({}, caller))
      expect(preview).toMatchObject({
        status: 'ready',
        sessionId: SESSION,
        cwd: CWD,
        repo: 'acme/widget',
        remote: 'origin',
        base: 'main',
        bookmark: 'dsh/widget-sprockets',
        bookmarkExists: false,
        headCommitId: HEAD,
        title: 'Add sprockets to the widget',
        generation: { source: 'model', note: 'test-provider/test-model' },
        existingUrl: null,
        problems: [],
      })
      expect(preview.body).toContain('## Changes')
      expect(preview.commits.map(commit => commit.summary)).toEqual(['feat(widget): add sprockets', 'refactor(widget): split gears'])
      expect(run.completions[0]?.input).toContain('Please add sprockets to the widget.')
      expect(run.jjCalls.some(args => args[0] === 'bookmark' || args[1] === 'push')).toBe(false)
      expect(run.created).toEqual([])
      // An empty working-copy commit is skipped: the range ends at its parent.
      expect(run.jjCalls.find(args => args.some(arg => arg.includes('..')))).toContain('"main"@"origin"..@-')
    }).pipe(Effect.provide(run.layer))
  })

  it.effect('creates on confirm: sets the bookmark, pushes it with jj, runs gh pr create and watches the link', () => {
    const run = harness()
    return Effect.gen(function* () {
      const output = yield* PullRequestCreator.use(creator => creator.create({ ...confirmed, draft: true }, caller))
      expect(output).toMatchObject({ status: 'created', opened: true, url: 'https://github.com/acme/widget/pull/7', link: { watching: true, number: 7 } })
      const writes = run.jjCalls.filter(args => args[0] === 'bookmark' || args[1] === 'push')
      expect(writes).toEqual([
        ['bookmark', 'set', 'dsh/widget-sprockets', '-r', HEAD],
        ['git', 'push', '--remote', 'origin', '--bookmark', 'dsh/widget-sprockets'],
      ])
      expect(run.created).toEqual([
        { repo: 'acme/widget', cwd: CWD, head: 'dsh/widget-sprockets', base: 'main', title: 'Add sprockets', body: 'Body', draft: true },
      ])
      expect(run.links).toEqual([{ kind: 'watch', url: 'https://github.com/acme/widget/pull/7', sessionId: SESSION }])
    }).pipe(Effect.provide(run.layer))
  })

  it.effect('links an open pull request for the bookmark instead of opening another', () => {
    const run = harness({ gh: { existing: 'https://github.com/acme/widget/pull/7' } })
    return Effect.gen(function* () {
      const preview = yield* PullRequestCreator.use(creator => creator.preview({}, caller))
      expect(preview.existingUrl).toBe('https://github.com/acme/widget/pull/7')
      const output = yield* PullRequestCreator.use(creator => creator.create({ ...confirmed, watch: false }, caller))
      expect(output).toMatchObject({ status: 'created', opened: false })
      expect(run.created).toEqual([])
      expect(run.links.map(link => link.kind)).toEqual(['link'])
    }).pipe(Effect.provide(run.layer))
  })

  it.effect('blocks with a recovery when gh is missing, unauthenticated, or the repository is unknown', () =>
    Effect.gen(function* () {
      const missing = harness({ gh: { auth: 'missing' } })
      const unauthenticated = harness({ gh: { auth: 'unauthenticated' } })
      const unknown = harness({ gh: { repo: 'unknown' } })
      const codes = yield* Effect.all(
        [missing, unauthenticated, unknown].map(run =>
          PullRequestCreator.use(creator => creator.preview({}, caller)).pipe(
            Effect.map(preview => ({ status: preview.status, problems: preview.problems })),
            Effect.provide(run.layer),
          ),
        ),
      )
      expect(codes.map(result => result.status)).toEqual(['blocked', 'blocked', 'blocked'])
      expect(codes.map(result => result.problems[0]?.code)).toEqual(['gh-missing', 'gh-unauthenticated', 'repository-unknown'])
      expect(codes[0]?.problems[0]?.recovery).toContain('cli.github.com')
      expect(codes[1]?.problems[0]?.recovery).toContain('gh auth login')
    }),
  )

  it.effect('blocks with a recovery when jj is missing, there is no remote, the base is unknown, or commits are conflicted or undescribed', () =>
    Effect.gen(function* () {
      const cases: JjScript[] = [
        { missing: true },
        { remotes: '' },
        { baseFound: false },
        { commits: commitLine({ change: 'kkkkkkkkkkkk', commit: HEAD, conflict: true, summary: 'feat: x' }) },
        { commits: commitLine({ change: 'kkkkkkkkkkkk', commit: HEAD, described: false, summary: '' }) },
        { commits: '' },
      ]
      const problems = yield* Effect.all(
        cases.map(jj => PullRequestCreator.use(creator => creator.preview({}, caller)).pipe(Effect.provide(harness({ jj }).layer))),
      )
      expect(problems.map(preview => preview.problems.map(problem => problem.code))).toEqual([
        ['jj-missing'],
        ['no-remote'],
        ['base-missing'],
        ['conflicted-commits'],
        ['undescribed-commits'],
        ['no-commits'],
      ])
      expect(problems.every(preview => preview.problems.every(problem => problem.recovery.length > 0))).toBe(true)
      expect(problems[1]?.problems[0]?.recovery).toContain('jj git remote add')
    }),
  )

  it.effect('refuses to create when the workspace moved since the preview, and when preflight is blocked', () => {
    const moved = harness()
    const conflicted = harness({ jj: { commits: commitLine({ change: 'kkkkkkkkkkkk', commit: HEAD, conflict: true, summary: 'feat: x' }) } })
    return Effect.gen(function* () {
      const stale = yield* PullRequestCreator.use(creator => creator.create({ ...confirmed, headCommitId: 'c'.repeat(40) }, caller)).pipe(
        Effect.provide(moved.layer),
      )
      expect(stale).toMatchObject({ status: 'failed', stage: 'preflight', pushed: false })
      expect(stale.status === 'failed' ? stale.recovery : '').toContain('preview again')
      const blocked = yield* PullRequestCreator.use(creator => creator.create(confirmed, caller)).pipe(Effect.provide(conflicted.layer))
      expect(blocked).toMatchObject({ status: 'failed', stage: 'preflight', problems: [{ code: 'conflicted-commits' }] })
      expect([...moved.jjCalls, ...conflicted.jjCalls].some(args => args[0] === 'bookmark' || args[1] === 'push')).toBe(false)
    })
  })

  it.effect('explains how to recover when the push is rejected or gh pr create fails after pushing', () => {
    const rejected = harness({ jj: { push: fail('Error: Failed to push some bookmarks\nHint: The remote rejected: stale info') } })
    const ghFailed = harness({ gh: { create: 'fail' } })
    return Effect.gen(function* () {
      const push = yield* PullRequestCreator.use(creator => creator.create(confirmed, caller)).pipe(Effect.provide(rejected.layer))
      expect(push).toMatchObject({ status: 'failed', stage: 'push', pushed: false })
      expect(push.status === 'failed' ? push.recovery : '').toContain('jj git fetch')
      const create = yield* PullRequestCreator.use(creator => creator.create(confirmed, caller)).pipe(Effect.provide(ghFailed.layer))
      expect(create).toMatchObject({ status: 'failed', stage: 'gh-create', pushed: true })
      expect(create.status === 'failed' ? create.recovery : '').toContain('pull_request_link')
      expect(ghFailed.links).toEqual([])
    })
  })

  it('records one span around the preview and one around the confirmed create, with jj runs beneath them', async () => {
    using recorder = recordSpans()
    const run = harness()
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* PullRequestCreator.use(creator => creator.preview({}, caller))
        yield* PullRequestCreator.use(creator => creator.create(confirmed, caller))
      }).pipe(Effect.provide(run.layer), Effect.provide(DshxEffect.tracerLayer)),
    )
    expect(recorder.span('pull-requests create preview').status.code).toBe('unset')
    expect(recorder.span('pull-requests create').status.code).toBe('unset')
  })

  it('names a bookmark from the thread title and reads a generated draft', () => {
    expect(CreateModel.bookmarkFromTitle('Créer une PR — depuis le fil !', 'kkkk')).toBe('dsh/creer-une-pr-depuis-le-fil')
    expect(CreateModel.bookmarkFromTitle('!!!', 'kkkk')).toBe('dsh/kkkk')
    expect(CreateModel.parseGeneratedPullRequest('```\nTitle: "Add sprockets"\n\nBody text\n```')).toEqual({ title: 'Add sprockets', body: 'Body text' })
    expect(CreateModel.parseGeneratedPullRequest('   ')).toBeUndefined()
  })
})
