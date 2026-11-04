import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Clock, Effect } from 'effect'
import { onTestFinished, test } from 'vitest'
import { JujutsuCommandFailed, RevisionNotFound } from './errors.ts'
import type { JjRun } from './jujutsu-commands.ts'
import { makeEditTimeCache, makeRevisionDetailCache, RevisionReads } from './revision-reads.ts'

const jjAt =
  (cwd: string, home: string) =>
  (argv: readonly string[]): string => {
    const result = spawnSync(process.env.JJ_TEST_EXECUTABLE ?? 'jj', ['--color=never', '--no-pager', ...argv], {
      cwd,
      env: { PATH: process.env.PATH ?? '', HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      timeout: 20_000,
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw Object.assign(new Error('Jujutsu command failed with exit code ' + String(result.status) + '.'), { stderr: result.stderr })
    return result.stdout
  }

const scratchRepo = async (): Promise<{ readonly repo: string; readonly jj: (argv: readonly string[]) => string; readonly run: JjRun }> => {
  const home = await mkdtemp(join(tmpdir(), 'dshfiles-jj-reads-'))
  const repo = join(home, 'repo')
  await mkdir(repo)
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const jj = jjAt(repo, home)
  jj(['git', 'init', '--no-colocate'])
  jj(['config', 'set', '--repo', 'user.name', 'Reads Test'])
  jj(['config', 'set', '--repo', 'user.email', 'reads@example.invalid'])
  const run: JjRun = args =>
    Effect.try({ try: () => ({ stdout: jj(args), truncated: false }), catch: cause => new JujutsuCommandFailed({ exitCode: 1, cause }) })
  return { repo, jj, run }
}

const clockAt = (millis: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => millis,
  currentTimeMillis: Effect.succeed(millis),
  currentTimeNanosUnsafe: () => BigInt(millis) * 1_000_000n,
  currentTimeNanos: Effect.succeed(BigInt(millis) * 1_000_000n),
  monotonicTimeNanosUnsafe: () => BigInt(millis) * 1_000_000n,
  monotonicTimeNanos: Effect.succeed(BigInt(millis) * 1_000_000n),
  sleep: () => Effect.void,
})

const notFound = (error: { readonly _tag: string }): RevisionNotFound => {
  assert.ok(error instanceof RevisionNotFound, `expected RevisionNotFound, got ${error._tag}`)
  return error
}

const workingCopyCommitId = (jj: (argv: readonly string[]) => string): string =>
  jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', '@', '--template', 'commit_id']).trim()

test('details of an @ that another jj process already rewrote still load instead of failing', async () => {
  const { repo, jj, run } = await scratchRepo()
  await writeFile(join(repo, 'first.txt'), 'one\n')
  jj(['status'])
  const shownCommitId = workingCopyCommitId(jj)

  await writeFile(join(repo, 'second.txt'), 'two\n')
  jj(['status'])
  assert.notEqual(workingCopyCommitId(jj), shownCommitId)
  assert.ok(!jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', 'all()', '--template', 'commit_id ++ "\\n"']).includes(shownCommitId))

  const details = await Effect.runPromise(RevisionReads.details(run, shownCommitId))
  assert.deepEqual(
    details.files.map(file => [file.path, file.status, file.additions]),
    [['first.txt', 'A', 1]],
  )
})

test('details accept a hex prefix or a change id, which is what jj log and chat references print', async () => {
  const { repo, jj, run } = await scratchRepo()
  await writeFile(join(repo, 'prefixed.txt'), 'one\n')
  jj(['status'])
  const commitId = workingCopyCommitId(jj)
  const changeId = jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', '@', '--template', 'change_id.shortest(8)']).trim()

  const byPrefix = await Effect.runPromise(RevisionReads.details(run, commitId.slice(0, 12)))
  assert.deepEqual(
    byPrefix.files.map(file => [file.path, file.status]),
    [['prefixed.txt', 'A']],
  )
  const byChange = await Effect.runPromise(RevisionReads.details(run, changeId))
  assert.deepEqual(
    byChange.files.map(file => file.path),
    ['prefixed.txt'],
  )
})

test('an unknown prefix reports that no revision matches instead of a stale-revision message', async () => {
  const { run } = await scratchRepo()

  const error = await Effect.runPromise(Effect.flip(RevisionReads.details(run, 'deadbeef1234')))
  assert.equal(error.message, 'No revision matches "deadbeef1234". Check the id against jj log and try again.')
})

test('a short prefix of several commits is refused as ambiguous, and one of divergent copies lists them', { timeout: 60_000 }, async () => {
  const { repo, jj, run } = await scratchRepo()
  const commitIds: string[] = []
  for (let index = 0; index < 20; index++) {
    await writeFile(join(repo, `file-${String(index)}.txt`), `${String(index)}\n`)
    jj(['commit', '--message', `commit ${String(index)}`])
    commitIds.push(jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', '@-', '--template', 'commit_id']).trim())
  }
  const byFirst = new Map<string, string[]>()
  for (const id of commitIds) byFirst.set(id.slice(0, 1), [...(byFirst.get(id.slice(0, 1)) ?? []), id])
  const shared = [...byFirst.entries()].find(([, ids]) => ids.length > 1)?.[0]
  assert.ok(shared !== undefined, 'twenty commits share a first hex digit')
  const ambiguous = notFound(await Effect.runPromise(Effect.flip(RevisionReads.resolveCommitId(run, shared))))
  assert.deepEqual(
    [ambiguous.reason, ambiguous.message],
    ['ambiguous', `"${shared}" is a prefix of more than one revision. Use a longer prefix, or the full commit id from jj log.`],
  )
  const only = [...byFirst.entries()].find(([, ids]) => ids.length === 1)
  if (only !== undefined) assert.equal(await Effect.runPromise(RevisionReads.resolveCommitId(run, only[0])), only[1][0])

  const change = jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', '@-', '--template', 'change_id']).trim()
  const before = jj(['op', 'log', '--no-graph', '--limit', '1', '--template', 'self.id()']).trim()
  jj(['describe', change, '--message', 'one copy'])
  jj(['--at-op', before, 'describe', change, '--message', 'another copy'])
  const divergent = notFound(await Effect.runPromise(Effect.flip(RevisionReads.resolveCommitId(run, change.slice(0, 8)))))
  assert.equal(divergent.reason, 'multiple')
  assert.equal(divergent.candidates.length, 2)
  assert.match(divergent.message, /names 2 divergent revisions .* Pass the full commit id/u)
})

test('several references resolve once each and a full id costs no jj process', async () => {
  const { repo, jj, run } = await scratchRepo()
  await writeFile(join(repo, 'one.txt'), 'one\n')
  jj(['status'])
  const commitId = workingCopyCommitId(jj)
  const changeId = jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', '@', '--template', 'change_id.shortest(1)']).trim()
  let reads = 0
  const counted: JjRun = (args, options) => {
    reads += 1
    return run(args, options)
  }
  const resolved = await Effect.runPromise(RevisionReads.resolveCommitIds(counted, [commitId, changeId, commitId.slice(0, 7), changeId]))
  assert.deepEqual(resolved, [commitId, commitId, commitId, commitId])
  assert.equal(reads, 2)
  const malformed = notFound(await Effect.runPromise(Effect.flip(RevisionReads.resolveCommitId(run, 'main'))))
  assert.equal(malformed.reason, 'reference')
})

test('details never snapshot the working copy, so a read cannot rewrite @ under other agents', async () => {
  const { repo, jj, run } = await scratchRepo()
  await writeFile(join(repo, 'tracked.txt'), 'base\n')
  jj(['status'])
  const commitId = workingCopyCommitId(jj)
  const operationsBefore = jj(['--ignore-working-copy', 'operation', 'log', '--no-graph', '--template', 'id ++ "\\n"'])

  await writeFile(join(repo, 'dirty.txt'), 'not yet snapshotted\n')
  await Effect.runPromise(RevisionReads.details(run, commitId))

  assert.equal(workingCopyCommitId(jj), commitId)
  assert.equal(jj(['--ignore-working-copy', 'operation', 'log', '--no-graph', '--template', 'id ++ "\\n"']), operationsBefore)
})

test('an unknown revision reports that it is no longer available', async () => {
  const { run } = await scratchRepo()
  const missing = 'a'.repeat(40)

  const error = await Effect.runPromise(Effect.flip(RevisionReads.details(run, missing)))

  assert.equal(error.message, 'Revision aaaaaaaaaaaa is no longer available. Refresh and try again.')
})

test('changed-file stats and revision details mark the files a rebase left conflicted', async () => {
  const { repo, jj, run } = await scratchRepo()
  const changeId = (): string => jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', '@', '--template', 'change_id']).trim()
  await writeFile(join(repo, 'shared.txt'), 'base\n')
  jj(['describe', '--message', 'base'])
  const base = changeId()
  jj(['new', '--message', 'left'])
  await writeFile(join(repo, 'shared.txt'), 'left\n')
  jj(['status'])
  const left = changeId()
  jj(['new', base, '--message', 'right'])
  await writeFile(join(repo, 'shared.txt'), 'right\n')
  await writeFile(join(repo, 'clean.txt'), 'clean\n')
  jj(['status'])
  jj(['rebase', '--revisions', '@', '--destination', left])

  const stats = await Effect.runPromise(RevisionReads.fileStats(run, [workingCopyCommitId(jj)]))
  assert.deepEqual(
    stats.revisions[0]?.files.map(file => [file.path, file.conflict]),
    [
      ['clean.txt', false],
      ['shared.txt', true],
    ],
  )
  const details = await Effect.runPromise(RevisionReads.details(run, workingCopyCommitId(jj)))
  assert.deepEqual(
    details.files.map(file => [file.path, file.conflict]),
    [
      ['clean.txt', false],
      ['shared.txt', true],
    ],
  )
})

test('edit times keep the last content change through rebases and describes, and count a squash into the revision', { timeout: 60_000 }, async () => {
  const { repo, jj, run } = await scratchRepo()
  const cache = makeEditTimeCache()
  const lastOperationTime = (): string => jj(['op', 'log', '--no-graph', '--limit', '1', '--template', 'self.time().end().utc().format("%+")']).trim()
  const commitIdOf = (revision: string): string => jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', revision, '--template', 'commit_id']).trim()
  const editedAt = async (revision: string): Promise<string | null> =>
    (await Effect.runPromise(RevisionReads.editTimes(run, { repositoryRoot: repo, commitIds: [commitIdOf(revision)], cache })))[0]?.editedAt ?? null

  const changeIdOf = (revision: string): string => jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', revision, '--template', 'change_id']).trim()

  await writeFile(join(repo, 'base.txt'), 'base\n')
  jj(['describe', '--message', 'base'])
  const base = changeIdOf('@')
  jj(['new', '--message', 'side', 'root()'])
  await writeFile(join(repo, 'side.txt'), 'side\n')
  jj(['status'])
  const side = changeIdOf('@')
  jj(['new', '--message', 'feature', base])
  await writeFile(join(repo, 'feature.txt'), 'one\n')
  jj(['status'])
  const featureEditedAt = lastOperationTime()
  const feature = changeIdOf('@')

  assert.equal(await editedAt(feature), featureEditedAt)
  jj(['rebase', '--revisions', feature, '--onto', side])
  jj(['describe', feature, '--message', 'feature, renamed'])
  assert.equal(await editedAt(feature), featureEditedAt)

  jj(['new', '--message', 'fixup', feature])
  await writeFile(join(repo, 'fixup.txt'), 'fix\n')
  jj(['squash', '--into', feature, '--use-destination-message'])
  const squashedAt = lastOperationTime()
  assert.equal(await editedAt(feature), squashedAt)

  jj(['new', '--message', 'empty', 'root()'])
  assert.equal(await editedAt('@'), null)

  const commitIds = [feature, side, base, '@'].map(commitIdOf)
  const evologs: string[][] = []
  const counted: JjRun = (args, options) => {
    if (args.includes('evolog')) evologs.push([...args])
    return run(args, options)
  }
  const batched = await Effect.runPromise(RevisionReads.editTimes(counted, { repositoryRoot: repo, commitIds, cache: makeEditTimeCache() }))
  assert.equal(evologs.length, 1)
  const separate = await Promise.all(
    commitIds.map(
      async commitId => (await Effect.runPromise(RevisionReads.editTimes(run, { repositoryRoot: repo, commitIds: [commitId], cache: makeEditTimeCache() })))[0],
    ),
  )
  assert.deepEqual(batched, separate)
  assert.equal(batched[0]?.editedAt, squashedAt)
})

test('edit times read in one batch keep divergent copies of one change apart', { timeout: 60_000 }, async () => {
  const { repo, jj, run } = await scratchRepo()
  const commitIdsOf = (revision: string): string[] =>
    jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', revision, '--template', 'commit_id ++ "\\n"']).trim().split('\n')
  await writeFile(join(repo, 'shared.txt'), 'one\n')
  jj(['describe', '--message', 'shared'])
  const change = jj(['--ignore-working-copy', 'log', '--no-graph', '--revisions', '@', '--template', 'change_id']).trim()
  const before = jj(['op', 'log', '--no-graph', '--limit', '1', '--template', 'self.id()']).trim()
  await writeFile(join(repo, 'shared.txt'), 'two\n')
  jj(['status'])
  jj(['--at-op', before, 'describe', change, '--message', 'shared, renamed concurrently'])
  const copies = commitIdsOf(`change_id(${change})`)
  assert.equal(copies.length, 2)
  const batched = await Effect.runPromise(RevisionReads.editTimes(run, { repositoryRoot: repo, commitIds: copies, cache: makeEditTimeCache() }))
  const separate = await Promise.all(
    copies.map(
      async commitId => (await Effect.runPromise(RevisionReads.editTimes(run, { repositoryRoot: repo, commitIds: [commitId], cache: makeEditTimeCache() })))[0],
    ),
  )
  assert.deepEqual(batched, separate)
  assert.notEqual(batched[0]?.editedAt, batched[1]?.editedAt)
})

test('details reuse a commit’s immutable content from the cache but reread evolution once it is stale', async () => {
  const { repo, jj, run } = await scratchRepo()
  await writeFile(join(repo, 'cached.txt'), 'one\n')
  jj(['status'])
  const commitId = workingCopyCommitId(jj)
  const verbs: string[] = []
  const counted: JjRun = (args, options) => {
    verbs.push(args.find(arg => !arg.startsWith('-')) ?? '')
    return run(args, options)
  }
  const cache = makeRevisionDetailCache()

  const first = await Effect.runPromise(RevisionReads.details(counted, commitId, { cache, cacheKey: 'repo' }))
  assert.deepEqual([...verbs].sort(), ['diff', 'diff', 'evolog', 'log', 'log'])
  verbs.length = 0
  const second = await Effect.runPromise(RevisionReads.details(counted, commitId, { cache, cacheKey: 'repo' }))
  assert.deepEqual(verbs, ['log'], 'only the visibility check runs while content and evolution are cached')
  assert.deepEqual(second, first)
  assert.equal(cache.stats().entries, 1)

  verbs.length = 0
  const later = await Effect.runPromise(
    RevisionReads.details(counted, commitId, { cache, cacheKey: 'repo' }).pipe(Effect.provideService(Clock.Clock, clockAt(Date.now() + 6_000))),
  )
  assert.deepEqual(verbs.sort(), ['evolog', 'log'], 'evolution can gain successors, so it is reread after its freshness window')
  assert.deepEqual(later.files, first.files)

  verbs.length = 0
  await Effect.runPromise(RevisionReads.details(counted, commitId, { cache, cacheKey: 'other repository' }))
  assert.ok(verbs.includes('diff'), 'another repository identity never answers from this one')
})

test('a failed detail read leaves nothing cached', async () => {
  const { repo, jj, run } = await scratchRepo()
  await writeFile(join(repo, 'flaky.txt'), 'one\n')
  jj(['status'])
  const commitId = workingCopyCommitId(jj)
  const failing: JjRun = (args, options) =>
    args.includes('diff') && args.includes('--git') ? Effect.fail(new JujutsuCommandFailed({ exitCode: 1 })) : run(args, options)
  const cache = makeRevisionDetailCache()

  await Effect.runPromise(Effect.flip(RevisionReads.details(failing, commitId, { cache, cacheKey: 'repo' })))
  assert.equal(cache.stats().entries, 0)
  const recovered = await Effect.runPromise(RevisionReads.details(run, commitId, { cache, cacheKey: 'repo' }))
  assert.deepEqual(
    recovered.files.map(file => file.path),
    ['flaky.txt'],
  )
})

test('the detail cache evicts the least recently used content past its byte budget', () => {
  const content = (size: number) => ({ files: [], additions: 0, deletions: 0, patch: 'x'.repeat(size), truncated: false })
  const cache = makeRevisionDetailCache({ bytes: 8_000, entries: 10 })
  for (const key of ['a', 'b', 'c']) cache.rememberContent(key, content(900))
  assert.ok(cache.content('a') !== undefined)
  cache.rememberContent('d', content(900))
  cache.rememberContent('e', content(900))
  assert.equal(cache.content('b'), undefined, 'b was the least recently used once a was read again')
  assert.ok(['a', 'c', 'd', 'e'].every(key => cache.content(key) !== undefined))
  assert.ok(cache.stats().bytes <= 8_000)
  cache.rememberContent('huge', content(1_200))
  assert.equal(cache.content('huge'), undefined, 'one patch never takes over a quarter of the budget')
})

test('details read content and evolution concurrently after validation', async () => {
  const { repo, jj, run } = await scratchRepo()
  await writeFile(join(repo, 'parallel.txt'), 'one\n')
  jj(['status'])
  const commitId = workingCopyCommitId(jj)
  let running = 0
  let peak = 0
  const slow: JjRun = (args, options) =>
    Effect.gen(function* () {
      running += 1
      peak = Math.max(peak, running)
      yield* Effect.sleep('20 millis')
      return yield* run(args, options)
    }).pipe(Effect.ensuring(Effect.sync(() => (running -= 1))))

  await Effect.runPromise(RevisionReads.details(slow, commitId))
  assert.equal(peak, 4, 'paths, patch, file stats and evolution run together, never more')
})
