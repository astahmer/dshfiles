import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost, mountPlugin } from '@dshfiles/dshx/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { jujutsuApi } from './api.js'

/**
 * Characterization of the jujutsu Host half through its Effect edge (formerly recorded in the migration plan, jujutsu a–d,
 * f), mounted in a dshx test Host with real `jj` processes: each failure reaches the caller under its own wire code
 * with these exact messages. Repository identity is guarded, jj's stderr never reaches a caller, a cancellation reads
 * as aborted, a preview is one-use and bound to its repository state, and every read endpoint answers a failure as a
 * value. The command timeout and the preview age are driven by a TestClock in jujutsu-services.integration.test.ts.
 *
 * Only the DSH subprocess seam is substituted (by plain `node:child_process`); `slowCommand` swaps one jj command for
 * a `sleep` so a request can be cancelled while it runs.
 */

const jjAvailable = spawnSync('jj', ['--version']).status === 0
const env = { ...process.env, JJ_CONFIG: '' }
const jjExecutable = jjAvailable ? execFileSync('which', ['jj'], { encoding: 'utf8' }).trim() : 'jj'

const wireResponseSchema = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: Schema.Json }) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

type WireInput = Readonly<Record<string, string | number | boolean | readonly string[] | Readonly<Record<string, string>>>>

const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })

const initRepository = (repo: string): void => {
  execFileSync('jj', ['git', 'init', repo], { stdio: 'ignore', env })
  jj(repo, 'config', 'set', '--repo', 'user.name', 'Test')
  jj(repo, 'config', 'set', '--repo', 'user.email', 'test@example.com')
  writeFileSync(join(repo, 'shared.txt'), 'one\n')
  jj(repo, 'commit', '-m', 'base')
  jj(repo, 'bookmark', 'create', 'main', '-r', '@-')
}

const startHost = async () => {
  const host = await createTestHost()
  const spawned: (readonly string[])[] = []
  let slowCommand: string | undefined

  host.ctx.provide('subprocess', {
    resolveExecutable: async () => jjExecutable,
    spawn: (spec: { readonly argv: readonly string[]; readonly cwd: string }) => {
      spawned.push(spec.argv)
      const [executable = '', ...args] = slowCommand !== undefined && spec.argv.includes(slowCommand) ? ['sleep', '60'] : spec.argv
      const child = spawn(executable, args, { cwd: spec.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
      const exited = new Promise<{ readonly exitCode: number | null; readonly signal: string | null }>(resolvePromise => {
        child.on('close', (code, signal) => resolvePromise({ exitCode: code, signal }))
        child.on('error', () => resolvePromise({ exitCode: null, signal: null }))
      })
      return {
        done: exited,
        waitForExit: async () => {
          await exited
          return true
        },
        terminate: () => {
          child.kill('SIGKILL')
        },
        stdout: child.stdout,
        stderr: child.stderr,
      }
    },
  })
  host.ctx.provide('webServer', {})
  host.ctx.provide('storageDomain', {
    open: async () => ({ table: () => ({ get: () => undefined, entries: () => [].values(), keys: () => [].values(), size: 0 }), close: async () => undefined }),
  })
  host.ctx.provide('settings', {
    configure: () => () => undefined,
    describe: () => [],
    update: async () => undefined,
    replace: async () => undefined,
  })
  const plugin: unknown = await import('./host.js')
  const mounted = await mountPlugin(host, plugin, { packageId: '@dshfiles/jujutsu', native: true })
  const api = createHostApiClient(host.ctx, jujutsuApi, '@dshfiles/jujutsu')

  const wire = async (method: keyof typeof jujutsuApi.methods, input: WireInput) => {
    const response = await host.connection.requestApi({ packageId: '@dshfiles/jujutsu', apiId: jujutsuApi.id, method, version: jujutsuApi.version, input })
    const body = Schema.decodeUnknownSync(wireResponseSchema)(await response.json())
    return body.result.ok ? { output: body.result.value.output } : { code: body.result.error.code, message: body.result.error.message }
  }

  return {
    api,
    wire,
    spawned,
    slowCommand: (command: string | undefined) => {
      slowCommand = command
    },
    dispose: async () => {
      await mounted.dispose()
      await host.dispose()
    },
  }
}

type JujutsuTestHost = Awaited<ReturnType<typeof startHost>>

describe.skipIf(!jjAvailable)('jujutsu Host boundary', { timeout: 60_000 }, () => {
  let root: string
  let repo: string
  let host: JujutsuTestHost

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jujutsu-boundary-')))
    repo = join(root, 'repo')
    initRepository(repo)
    host = await startHost()
  }, 60_000)

  afterEach(async () => {
    await host.dispose()
    rmSync(root, { recursive: true, force: true })
  }, 60_000)

  const without = (text: string): string => text.replaceAll(root, '<root>')

  describe('repository identity guard', () => {
    it('refuses a registered repository whose directory was swapped for another one', async () => {
      const { repoId } = await host.api.registerRepository({ path: repo })
      renameSync(repo, join(root, 'moved-away'))
      initRepository(repo)

      expect(await host.wire('workspaces', { repoId })).toEqual({
        code: 'repository-moved',
        message: 'Registered repository directory changed. Select it again.',
      })
      const loaded = await host.wire('load', { repoId })
      expect(loaded).toMatchInlineSnapshot(`
        {
          "output": {
            "failure": {
              "message": "Registered repository directory changed. Select it again.",
            },
          },
        }
      `)
    })

    it('refuses a registered repository whose path became a symlink', async () => {
      const { repoId } = await host.api.registerRepository({ path: repo })
      const other = join(root, 'other')
      initRepository(other)
      renameSync(repo, join(root, 'moved-away'))
      symlinkSync(other, repo)

      expect(await host.wire('workspaces', { repoId })).toMatchInlineSnapshot(`
        {
          "code": "repository-moved",
          "message": "Registered repository path is unavailable. Select it again.",
        }
      `)
    })

    it('registers the canonical root when selected through a symlink or a subdirectory', async () => {
      const link = join(root, 'link')
      symlinkSync(repo, link)
      mkdirSync(join(repo, 'nested'))

      expect((await host.api.registerRepository({ path: link })).root).toBe(repo)
      expect((await host.api.registerRepository({ path: join(repo, 'nested') })).root).toBe(repo)
    })
  })

  describe('remote failures never surface stderr', () => {
    const secret = 'secret-token-1234'

    beforeEach(() => {
      jj(repo, 'git', 'remote', 'add', 'origin', `https://user:${secret}@127.0.0.1:9/private.git`)
    }, 60_000)

    it('reports a failed push dry-run and push without the credential-bearing remote URL', async () => {
      const { repoId } = await host.api.registerRepository({ path: repo })
      const preview = await host.api.prepare({ repoId, action: { kind: 'push', remote: 'origin', bookmark: 'main' } })
      expect(JSON.stringify(preview)).not.toContain(secret)
      expect({ title: preview.title, summary: preview.summary, detail: preview.detail }).toMatchInlineSnapshot(`
        {
          "detail": "JJ dry-run preview follows. The real push starts only after confirmation.

        JJ reported no dry-run output.",
          "summary": "Push main to origin",
          "title": "Push bookmark",
        }
      `)

      const confirmed = await host.wire('confirm', { repoId, previewId: preview.id })
      expect(JSON.stringify(confirmed)).not.toContain(secret)
      expect(confirmed).toMatchInlineSnapshot(`
        {
          "code": "jujutsu-command-failed",
          "message": "Jujutsu command failed with exit code 1.",
        }
      `)
    })

    it('reports a failed fetch without the credential-bearing remote URL', async () => {
      const { repoId } = await host.api.registerRepository({ path: repo })
      const preview = await host.api.prepare({ repoId, action: { kind: 'fetch', remote: 'origin' } })
      const confirmed = await host.wire('confirm', { repoId, previewId: preview.id })
      expect(JSON.stringify(confirmed)).not.toContain(secret)
      expect(confirmed).toMatchInlineSnapshot(`
        {
          "code": "jujutsu-command-failed",
          "message": "Jujutsu command failed with exit code 1.",
        }
      `)
    })
  })

  describe('cancellation', () => {
    const waitForSpawn = async (command: string): Promise<void> => {
      while (!host.spawned.some(argv => argv.includes(command))) {
        await new Promise(resolvePromise => setImmediate(resolvePromise))
      }
    }

    it('reports a cancelled request as aborted to the caller', async () => {
      const { repoId } = await host.api.registerRepository({ path: repo })
      host.slowCommand('diff')
      const controller = new AbortController()
      const pending = host.api.safe.workingDiff({ repoId }, { signal: controller.signal })
      await waitForSpawn('diff')
      controller.abort()
      const result = await pending
      expect(result.ok ? 'ok' : { kind: result.error.kind, remoteCode: result.error.remoteCode, message: result.error.message }).toMatchInlineSnapshot(`
        {
          "kind": "aborted",
          "message": "API request was aborted.",
          "remoteCode": "aborted",
        }
      `)
    })
  })

  describe('prepared previews', () => {
    const describeAction = async (repoId: string) => {
      const loaded = await host.api.load({ repoId })
      if (!('revisions' in loaded)) throw new Error('repository did not load')
      const workingCopy = loaded.revisions.find(revision => revision.workingCopy)
      if (workingCopy === undefined) throw new Error('no working-copy revision')
      return { kind: 'describe' as const, commitId: workingCopy.commitId, message: 'feat: described through a preview' }
    }

    it('applies a fresh preview once and refuses it a second time', async () => {
      const { repoId } = await host.api.registerRepository({ path: repo })
      const preview = await host.api.prepare({ repoId, action: await describeAction(repoId) })
      const first = await host.wire('confirm', { repoId, previewId: preview.id })
      expect(first).toMatchObject({ output: { message: `${preview.title} completed.` } })
      expect(await host.wire('confirm', { repoId, previewId: preview.id })).toEqual({
        code: 'preview-expired',
        message: 'Preview expired or was already used. Prepare the action again.',
      })
    })

    it('refuses a preview once the repository changed after it was prepared', async () => {
      const { repoId } = await host.api.registerRepository({ path: repo })
      const preview = await host.api.prepare({ repoId, action: await describeAction(repoId) })
      jj(repo, 'describe', '-m', 'changed by someone else')
      expect(await host.wire('confirm', { repoId, previewId: preview.id })).toEqual({
        code: 'preview-expired',
        message: 'A revision or bookmark this action names changed after the preview. Refresh and prepare the action again.',
      })
      expect(jj(repo, 'log', '--no-graph', '-r', '@', '-T', 'description')).toBe('changed by someone else\n')
    })

    it('keeps a preview when only revisions it does not name changed', async () => {
      const { repoId } = await host.api.registerRepository({ path: repo })
      const preview = await host.api.prepare({ repoId, action: await describeAction(repoId) })
      jj(repo, '--ignore-working-copy', 'new', 'root()', '--no-edit', '-m', 'unrelated work elsewhere')
      expect(await host.wire('confirm', { repoId, previewId: preview.id })).toMatchObject({ output: { message: `${preview.title} completed.` } })
    })
  })

  it('passes user-written failures through and replaces every other failure with a generic message, per handler', async () => {
    const plain = join(root, 'plain')
    mkdirSync(plain)
    const file = join(root, 'file.txt')
    writeFileSync(file, 'not a folder\n')
    const { repoId } = await host.api.registerRepository({ path: repo })
    const unknownCommit = 'f'.repeat(40)
    const unregistered = '00000000-0000-4000-8000-000000000000'
    const table: Record<string, { readonly code: string; readonly message: string } | { readonly output: JsonValue }> = {}
    const record = async (name: string, method: keyof typeof jujutsuApi.methods, input: WireInput) => {
      const outcome = await host.wire(method, input)
      table[name] =
        'output' in outcome
          ? { output: JSON.parse(without(JSON.stringify(outcome.output)).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')) }
          : { ...outcome, message: without(outcome.message) }
    }

    await record('registerRepository: missing path', 'registerRepository', { path: join(root, 'missing') })
    await record('registerRepository: relative path', 'registerRepository', { path: 'repo' })
    await record('registerRepository: folder outside jj', 'registerRepository', { path: plain })
    await record('registerRepository: a file', 'registerRepository', { path: file })
    await record('registerRepositories: mixed', 'registerRepositories', { paths: [repo, plain] })
    await record('openRepository: a file', 'openRepository', { path: file })
    await record('openRepository: missing path', 'openRepository', { path: join(root, 'missing') })
    await record('workspaces: expired registration', 'workspaces', { repoId: unregistered })
    await record('load: expired registration', 'load', { repoId: unregistered })
    await record('graphPage: expired registration', 'graphPage', { repoId: unregistered, query: '', excludeCommitIds: [] })
    await record('graphNavigation: expired registration', 'graphNavigation', { repoId: unregistered })
    await record('details: unknown revision', 'details', { repoId, commitId: unknownCommit })
    await record('revisionFiles: unknown revision', 'revisionFiles', { repoId, commitIds: [unknownCommit] })
    await record('editTimes: unknown revision', 'editTimes', { repoId, commitIds: [unknownCommit] })
    await record('referenceGraph: unknown reference', 'referenceGraph', { repoId, reference: 'no-such-bookmark' })
    await record('revisionRelationship: unknown revisions', 'revisionRelationship', { repoId, commitId: unknownCommit, targetCommitId: unknownCommit })
    await record('graphSlice: unknown revision', 'graphSlice', { repoId, commitId: unknownCommit, mode: 'history' })
    await record('prepare: describe an unknown revision', 'prepare', { repoId, action: { kind: 'describe', commitId: unknownCommit, message: 'x' } })
    await record('prepare: push to an unknown remote', 'prepare', { repoId, action: { kind: 'push', remote: 'nowhere', bookmark: 'main' } })
    await record('prepare: forget an unknown workspace', 'prepare', { repoId, action: { kind: 'workspace-forget', name: 'ghost' } })
    await record('prepare: forget the only workspace', 'prepare', { repoId, action: { kind: 'workspace-forget', name: 'default' } })
    await record('confirm: unknown preview', 'confirm', { repoId, previewId: unregistered })
    await record('confirm: expired registration', 'confirm', { repoId: unregistered, previewId: unregistered })
    await record('workingDiff: expired registration', 'workingDiff', { repoId: unregistered })

    expect(table).toMatchInlineSnapshot(`
      {
        "confirm: expired registration": {
          "code": "repository-not-found",
          "message": "Repository registration expired. Select it again.",
        },
        "confirm: unknown preview": {
          "code": "preview-expired",
          "message": "Preview expired or was already used. Prepare the action again.",
        },
        "details: unknown revision": {
          "output": {
            "failure": {
              "message": "Revision ffffffffffff is no longer available. Refresh and try again.",
            },
          },
        },
        "editTimes: unknown revision": {
          "code": "jujutsu-command-failed",
          "message": "Jujutsu command failed with exit code 1.",
        },
        "graphNavigation: expired registration": {
          "output": {
            "failure": {
              "message": "Repository registration expired. Select it again.",
            },
          },
        },
        "graphPage: expired registration": {
          "output": {
            "failure": {
              "message": "Repository registration expired. Select it again.",
            },
          },
        },
        "graphSlice: unknown revision": {
          "output": {
            "failure": {
              "message": "Jujutsu command failed with exit code 1.",
            },
          },
        },
        "load: expired registration": {
          "output": {
            "failure": {
              "message": "Repository registration expired. Select it again.",
            },
          },
        },
        "openRepository: a file": {
          "code": "repository-init-failed",
          "message": "Selected repository path must be an existing directory.",
        },
        "openRepository: missing path": {
          "code": "repository-init-failed",
          "message": "Repository metadata is invalid. Existing metadata was left untouched.",
        },
        "prepare: describe an unknown revision": {
          "code": "mutation-refused",
          "message": "Revision is no longer visible. Refresh and try again.",
        },
        "prepare: forget an unknown workspace": {
          "code": "mutation-refused",
          "message": "Workspace is no longer present. Refresh and try again.",
        },
        "prepare: forget the only workspace": {
          "code": "mutation-refused",
          "message": "Workspace removal refused: this is the repository’s only workspace.",
        },
        "prepare: push to an unknown remote": {
          "code": "mutation-refused",
          "message": "Remote is no longer configured. Refresh and select a listed remote.",
        },
        "referenceGraph: unknown reference": {
          "output": {
            "failure": {
              "message": "Jujutsu command failed with exit code 1.",
            },
          },
        },
        "registerRepositories: mixed": {
          "output": {
            "repositories": [
              {
                "path": "<root>/repo",
                "repoId": "<uuid>",
                "root": "<root>/repo",
              },
              {
                "path": "<root>/plain",
                "repoId": null,
                "root": null,
              },
            ],
          },
        },
        "registerRepository: a file": {
          "code": "invalid-repository-path",
          "message": "Selected repository path is not a directory.",
        },
        "registerRepository: folder outside jj": {
          "code": "jujutsu-command-failed",
          "message": "Jujutsu command failed with exit code 1.",
        },
        "registerRepository: missing path": {
          "code": "invalid-repository-path",
          "message": "Selected repository path does not exist.",
        },
        "registerRepository: relative path": {
          "code": "invalid-repository-path",
          "message": "Choose an absolute repository path.",
        },
        "revisionFiles: unknown revision": {
          "code": "jujutsu-command-failed",
          "message": "Jujutsu command failed with exit code 1.",
        },
        "revisionRelationship: unknown revisions": {
          "output": {
            "failure": {
              "message": "Jujutsu command failed with exit code 1.",
            },
          },
        },
        "workingDiff: expired registration": {
          "code": "repository-not-found",
          "message": "Repository registration expired. Select it again.",
        },
        "workspaces: expired registration": {
          "code": "repository-not-found",
          "message": "Repository registration expired. Select it again.",
        },
      }
    `)
  })
})
