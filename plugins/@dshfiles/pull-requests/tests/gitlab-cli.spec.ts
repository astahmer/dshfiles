import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { layer as nodeChildProcessSpawnerLayer } from '@effect/platform-node/NodeChildProcessSpawner'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitLabCli } from '../src/gitlab-cli.js'

/** A stand-in for `glab`: logs its arguments; `mr create` prints progress lines around the URL, as the real CLI does. */
const fakeGlabScript = (log: string) => `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$1 $2" in
  "mr view") echo '{"iid":3,"state":"opened"}' ;;
  "mr list") echo '[]' ;;
  "mr create") printf '\\nCreating merge request for feature into main in group/project\\n\\nhttps://gitlab.example.com/group/project/-/merge_requests/12\\n' ;;
  *) exit 1 ;;
esac
`

let root = ''
let log = ''
const savedPath = process.env['PATH']

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pull-requests-glab-'))
  const bin = join(root, 'bin')
  log = join(root, 'glab.log')
  await mkdir(bin)
  await writeFile(join(bin, 'glab'), fakeGlabScript(log))
  await chmod(join(bin, 'glab'), 0o755)
  process.env['PATH'] = `${bin}:${savedPath ?? ''}`
})

afterAll(async () => {
  process.env['PATH'] = savedPath
  await rm(root, { recursive: true, force: true })
})

const layer = GitLabCli.layer.pipe(Layer.provide(nodeChildProcessSpawnerLayer.pipe(Layer.provideMerge(Layer.mergeAll(nodeFileSystemLayer, nodePathLayer)))))
const run = <A, E>(effect: (gitlab: GitLabCli['Service']) => Effect.Effect<A, E>) => Effect.runPromise(GitLabCli.use(effect).pipe(Effect.provide(layer)))

describe('GitLab CLI', () => {
  it('finds the created merge-request URL among the lines glab prints', async () => {
    const url = await run(gitlab =>
      gitlab.createMergeRequest({
        host: 'gitlab.example.com',
        project: 'group/project',
        cwd: root,
        head: 'feature',
        base: 'main',
        title: 'Add',
        body: 'Body',
        draft: false,
      }),
    )
    expect(url).toBe('https://gitlab.example.com/group/project/-/merge_requests/12')
    expect(await readFile(log, 'utf8')).toContain('mr create')
  })

  it('names the self-hosted host in every --repo argument', async () => {
    const target = { host: 'gitlab.example.com:8443', project: 'team/sub/project', cwd: root }
    await run(gitlab => gitlab.mergeRequest({ ...target, number: 3 }))
    await run(gitlab => gitlab.openMergeRequestFor({ ...target, head: 'feature' }))
    await run(gitlab => gitlab.createMergeRequest({ ...target, head: 'feature', base: 'main', title: 'Add', body: 'Body', draft: false }))
    const repos = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .slice(-3)
      .map(line => / --repo (\S+)/u.exec(line)?.[1])
    expect(repos).toEqual(Array.from({ length: 3 }, () => 'https://gitlab.example.com:8443/team/sub/project'))
  })
})
