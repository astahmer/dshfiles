import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pullRequestsHost from '../src/host.js'
import { pullRequestApi } from '../src/api.js'

/** A stand-in for the GitHub CLI: answers the calls the create flow and the watcher make, and logs every argv. */
const fakeGhScript = (log: string) => `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$1 $2" in
  "auth status") exit 0 ;;
  "repo view") echo '{"nameWithOwner":"acme/widget","defaultBranchRef":{"name":"main"}}' ;;
  "pr list") echo '[]' ;;
  "pr create") echo 'https://github.com/acme/widget/pull/7' ;;
  "pr view") echo '{"state":"OPEN","mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","reviewDecision":null,"statusCheckRollup":[{"name":"unit","status":"COMPLETED","conclusion":"SUCCESS"}],"comments":[],"reviews":[]}' ;;
  *) echo "fake gh: unexpected $*" >&2; exit 2 ;;
esac
`

const sessionId = 'pull-request-create-session'
let root = ''
let repository = ''
let remote = ''
let ghLog = ''
const savedEnv = { PATH: process.env['PATH'], JJ_CONFIG: process.env['JJ_CONFIG'], JJ_USER: process.env['JJ_USER'], JJ_EMAIL: process.env['JJ_EMAIL'] }

const jj = (args: readonly string[], cwd: string) => execFileSync('jj', ['--color=never', ...args], { cwd, stdio: 'pipe' }).toString()

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pull-requests-create-'))
  const bin = join(root, 'bin')
  ghLog = join(root, 'gh.log')
  execFileSync('mkdir', ['-p', bin])
  await writeFile(join(bin, 'gh'), fakeGhScript(ghLog))
  await chmod(join(bin, 'gh'), 0o755)
  await writeFile(join(root, 'jj-config.toml'), '')
  process.env['PATH'] = `${bin}:${savedEnv.PATH ?? ''}`
  process.env['JJ_CONFIG'] = join(root, 'jj-config.toml')
  process.env['JJ_USER'] = 'DSH Test'
  process.env['JJ_EMAIL'] = 'dsh-test@example.invalid'

  remote = join(root, 'remote.git')
  execFileSync('git', ['init', '--quiet', '--bare', remote])
  jj(['git', 'init', 'repo'], root)
  repository = join(root, 'repo')
  jj(['git', 'remote', 'add', 'origin', remote], repository)
  await writeFile(join(repository, 'README.md'), 'widget\n')
  jj(['describe', '-m', 'chore: init'], repository)
  jj(['bookmark', 'set', 'main', '-r', '@'], repository)
  // Pushing the working-copy commit makes jj start a new, empty one on top of it.
  jj(['git', 'push', '--bookmark', 'main'], repository)
  await writeFile(join(repository, 'sprockets.txt'), 'sprockets\n')
  jj(['describe', '-m', 'feat(widget): add sprockets'], repository)
  jj(['new'], repository)
})

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(root, { recursive: true, force: true })
})

describe('pull request creation through the served API', () => {
  it('pushes the thread bookmark with jj, opens the PR with gh, and links and watches it on the thread', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'pull-requests-create-storage-'))
    const host = await createTestHost()
    try {
      await host.ctx.plugin(LocalSubprocessRuntime)
      await host.ctx.plugin(Storage)
      await host.ctx.plugin(StorageJson, { root: storageRoot })
      await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
      await host.mount(pullRequestsHost, { packageId: '@dshfiles/pull-requests' })
      const client = createHostApiClient(host.ctx, pullRequestApi, '@test/pull-request-create')

      const preview = await client.createPreview({ sessionId, cwd: repository })
      expect(preview).toMatchObject({ status: 'ready', repo: 'acme/widget', remote: 'origin', base: 'main', problems: [], existingUrl: null })
      expect(preview.commits.map(commit => commit.summary)).toEqual(['feat(widget): add sprockets'])
      // No thread log and no model in the test Host: the draft falls back to the commits and says so.
      expect(preview.generation.source).toBe('fallback')
      expect(preview.title).toBe('feat(widget): add sprockets')
      expect(preview.bookmark).toMatch(/^dsh\//u)
      expect(execFileSync('git', ['--git-dir', remote, 'branch', '--list']).toString()).not.toContain('dsh/')

      const bookmark = preview.bookmark ?? ''
      const headCommitId = preview.headCommitId ?? ''
      const created = await client.create({
        sessionId,
        cwd: repository,
        confirm: true,
        title: 'Add sprockets',
        body: 'Adds sprockets.',
        bookmark,
        base: 'main',
        headCommitId,
      })
      expect(created).toMatchObject({ status: 'created', opened: true, url: 'https://github.com/acme/widget/pull/7' })

      expect(
        execFileSync('git', ['--git-dir', remote, 'rev-parse', `refs/heads/${bookmark}`])
          .toString()
          .trim(),
      ).toBe(headCommitId)
      const ghCalls = (await readFile(ghLog, 'utf8')).split('\n')
      expect(ghCalls.find(line => line.startsWith('pr create'))).toBe(
        `pr create --repo acme/widget --head ${bookmark} --base main --title Add sprockets --body Adds sprockets.`,
      )

      const listed = await client.list({ sessionId })
      expect(listed.links).toEqual([
        expect.objectContaining({
          sessionId,
          repo: 'acme/widget',
          number: 7,
          url: 'https://github.com/acme/widget/pull/7',
          watching: true,
          lastKnownState: expect.objectContaining({ state: 'OPEN', mergeStateStatus: 'CLEAN' }),
        }),
      ])

      const again = await client.create({
        sessionId,
        cwd: repository,
        confirm: true,
        title: 'x',
        body: '',
        bookmark,
        base: 'main',
        headCommitId: 'f'.repeat(40),
      })
      expect(again).toMatchObject({ status: 'failed', stage: 'preflight' })
    } finally {
      await host.dispose()
      await rm(storageRoot, { recursive: true, force: true })
    }
  }, 60_000)
})
