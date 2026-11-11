import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImagePreview } from '@dshfiles/image-preview'
import { Git } from '@dshfiles/git-cli'
import { Jj } from '@dshfiles/jj-cli'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeServices } from '@effect/platform-node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'
import { ReviewImages, serveReviewImage } from '../src/review-image.js'
import { ReviewImageModel, WORKING_COPY, type ReviewImageQuery } from '../src/review-image-query.js'

const BEFORE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x01])
const AFTER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xfe, 0x02, 0x80])
const CURRENT = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x7f])
const IDENTITY = {
  JJ_USER: 'Test',
  JJ_EMAIL: 'test@example.invalid',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
}

const imagesLayer = ReviewImages.layer.pipe(Layer.provide(Layer.mergeAll(Jj.layer, Git.layer)), Layer.provideMerge(NodeServices.layer))

const serve = (query: Partial<Record<keyof ReviewImageQuery, string>>) =>
  Effect.runPromise(
    serveReviewImage(
      new Request(
        `http://host/api/diffs-review.image?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined))}`,
      ),
    ).pipe(Effect.provide(imagesLayer)),
  )

const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer())

describe('diffs-review image route', () => {
  let jjRepo: string
  let gitRepo: string
  let outside: string
  let commit: string
  let gitCommit: string

  beforeAll(async () => {
    const jj = (args: readonly string[], cwd: string) =>
      execFileSync('jj', ['--color=never', ...args], { cwd, env: { ...process.env, ...IDENTITY }, encoding: 'utf8' })
    jjRepo = await realpath(await mkdtemp(join(tmpdir(), 'diffs-review-image-jj-')))
    outside = await realpath(await mkdtemp(join(tmpdir(), 'diffs-review-image-outside-')))
    jj(['git', 'init', '.'], jjRepo)
    await mkdir(join(jjRepo, 'shots'))
    await writeFile(join(jjRepo, 'shots/hero.png'), BEFORE)
    await writeFile(join(jjRepo, 'notes.bin'), BEFORE)
    jj(['describe', '-m', 'before'], jjRepo)
    jj(['new', '-m', 'after'], jjRepo)
    await writeFile(join(jjRepo, 'shots/hero.png'), AFTER)
    jj(['new'], jjRepo)
    commit = jj(['log', '-r', '@-', '--no-graph', '-T', 'commit_id.short()'], jjRepo).trim()
    await writeFile(join(jjRepo, 'shots/hero.png'), CURRENT)
    await writeFile(join(outside, 'secret.png'), BEFORE)
    await symlink(join(outside, 'secret.png'), join(jjRepo, 'linked.png'))
    await writeFile(join(jjRepo, 'huge.png'), '')
    await truncate(join(jjRepo, 'huge.png'), ImagePreview.maxBytes + 1)

    const git = (args: readonly string[]) => execFileSync('git', args, { cwd: gitRepo, env: { ...process.env, ...IDENTITY }, encoding: 'utf8' })
    gitRepo = await realpath(await mkdtemp(join(tmpdir(), 'diffs-review-image-git-')))
    git(['init', '-q', '-b', 'main'])
    await writeFile(join(gitRepo, 'hero.png'), BEFORE)
    git(['add', '.'])
    git(['commit', '-q', '-m', 'before'])
    await writeFile(join(gitRepo, 'hero.png'), AFTER)
    git(['commit', '-q', '-am', 'after'])
    gitCommit = git(['rev-parse', '--short=12', 'HEAD']).trim()
  }, 120_000)

  afterAll(async () => {
    await Promise.all([jjRepo, gitRepo, outside].map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('serves a jj revision, its parent and the working copy, each as its own bytes under nosniff', async () => {
    const after = await serve({ path: jjRepo, file: 'shots/hero.png', revision: commit })
    expect(after.status).toBe(200)
    expect(after.headers.get('content-type')).toBe('image/png')
    expect(after.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await bytesOf(after)).toEqual(AFTER)
    expect(await bytesOf(await serve({ path: jjRepo, file: 'shots/hero.png', revision: commit, side: 'parent' }))).toEqual(BEFORE)
    expect(await bytesOf(await serve({ path: jjRepo, file: 'shots/hero.png', revision: WORKING_COPY }))).toEqual(CURRENT)
  }, 120_000)

  it('serves a git commit and its parent', async () => {
    expect(await bytesOf(await serve({ path: gitRepo, file: 'hero.png', revision: gitCommit }))).toEqual(AFTER)
    expect(await bytesOf(await serve({ path: gitRepo, file: 'hero.png', revision: gitCommit, side: 'parent' }))).toEqual(BEFORE)
  }, 120_000)

  it('refuses revsets, options and paths that could leave the repository before running anything', async () => {
    for (const revision of ['@-', 'main|root()', '-r', 'all()', 'HEAD~1', '']) {
      expect((await serve({ path: jjRepo, file: 'shots/hero.png', revision })).status).toBe(400)
    }
    for (const file of ['../secret.png', 'shots/../../x.png', '/etc/passwd.png', './hero.png', 'a\\b.png', 'a//b.png', 'x\n.png']) {
      expect((await serve({ path: jjRepo, file, revision: commit })).status).toBe(400)
    }
    expect((await serve({ path: jjRepo, file: 'shots/hero.png', revision: WORKING_COPY, side: 'parent' })).status).toBe(400)
    expect((await serve({ path: 'relative/repo', file: 'shots/hero.png', revision: commit })).status).toBe(400)
  }, 120_000)

  it('refuses a non-image, a symlink out of the repository, an oversized image, a missing one and a folder outside any repository', async () => {
    expect((await serve({ path: jjRepo, file: 'notes.bin', revision: commit })).status).toBe(415)
    expect((await serve({ path: jjRepo, file: 'linked.png', revision: WORKING_COPY })).status).toBe(403)
    expect((await serve({ path: jjRepo, file: 'huge.png', revision: WORKING_COPY })).status).toBe(413)
    expect((await serve({ path: jjRepo, file: 'gone.png', revision: commit })).status).toBe(404)
    expect((await serve({ path: jjRepo, file: 'gone.png', revision: WORKING_COPY })).status).toBe(404)
    expect((await serve({ path: outside, file: 'secret.png', revision: WORKING_COPY })).status).toBe(404)
  }, 120_000)

  it('records one diffs-review image read span with the answered status', async () => {
    using recorder = recordSpans()
    const request = new Request(`http://host/api/diffs-review.image?${new URLSearchParams({ path: jjRepo, file: 'notes.bin', revision: commit })}`)
    await Effect.runPromise(serveReviewImage(request).pipe(Effect.provide(imagesLayer), Effect.provide(DshxEffect.tracerLayer)))
    expect(recorder.span('diffs-review image read').attributes['diffs_review.image_status']).toBe(415)
  }, 120_000)

  it('addresses each side the review shows, labelled by version', () => {
    const [entry] = ReviewImageModel.rangeImages({
      workspacePath: '/repo',
      files: [
        { path: 'shots/hero.png', status: 'modified' },
        { path: 'src/app.ts', status: 'modified' },
      ],
      base: 'abc123',
      head: WORKING_COPY,
    })
    expect(entry?.before).toEqual({ url: 'api/diffs-review.image?path=%2Frepo&file=shots%2Fhero.png&revision=abc123', label: 'Before · abc123' })
    expect(entry?.after?.label).toBe('Current')
    const [added, removed] = ReviewImageModel.revisionImages({
      workspacePath: '/repo',
      commitId: 'def4567890ab',
      files: [
        { path: 'new.svg', status: 'added' },
        { path: 'old.gif', status: 'removed' },
      ],
    })
    expect(added?.before).toBeUndefined()
    expect(added?.after?.label).toBe('After · def45678')
    expect(removed?.after).toBeUndefined()
    expect(removed?.before?.url).toContain('side=parent')
  })
})
