import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { pullsReviewApi } from '../src/api.js'
import plugin from '../src/host.js'

const run = promisify(execFile)
const CONFIG = ['--config', 'user.name=Test', '--config', 'user.email=test@example.com']

const jjAvailable = await run('jj', ['--version']).then(
  () => true,
  () => false,
)

const loadPlugin = async () => (process.env.DSH_PULLS_REVIEW_BUILT === '1' ? import(new URL('../dist/index.js', import.meta.url).href) : plugin)

/** A real test Host with the native local subprocess runtime, the plugin mounted, and one jj repository. */
const fixture = Effect.acquireRelease(
  Effect.promise(async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'pulls-review-host-'))
    await run('jj', [...CONFIG, 'git', 'init'], { cwd: workspace })
    await writeFile(join(workspace, 'README.md'), '# Title\n')
    await run('jj', [...CONFIG, 'commit', '-m', 'base'], { cwd: workspace })
    await run('jj', [...CONFIG, 'bookmark', 'create', 'main', '-r', '@-'], { cwd: workspace })
    await writeFile(join(workspace, 'app.ts'), 'export const answer = 2\n')
    const host = await createTestHost()
    await host.ctx.plugin(LocalSubprocessRuntime)
    await host.mount(await loadPlugin(), { packageId: '@dshfiles/pulls-review', native: process.env.DSH_PULLS_REVIEW_BUILT === '1' })
    return { host, workspace }
  }),
  f =>
    Effect.promise(async () => {
      await f.host.dispose()
      await rm(f.workspace, { recursive: true, force: true })
    }),
)

describe.skipIf(!jjAvailable)('pulls-review Host', () => {
  it.effect('serves review over the API and as the pulls_review agent tool', () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const review = yield* Effect.promise(() => createHostApiClient(f.host.ctx, pullsReviewApi, '@test/caller').review({ path: f.workspace }))
      expect(review).toMatchObject({ status: 'ok', base: 'main', range: 'main..@', fileCount: 1 })

      expect(f.host.tools.schemas().find(schema => schema.name === 'pulls_review')?.parameters).toMatchObject({
        properties: { path: { type: 'string', description: 'Absolute path of the workspace to review.' } },
        required: ['path'],
      })
      const tool = yield* Effect.promise(() =>
        f.host.tools.execute({ callId: ToolCallId('call-1'), name: 'pulls_review', arguments: { path: f.workspace }, signal: new AbortController().signal }),
      )
      expect(tool).toMatchObject({ isError: false })
      expect(tool.content.map(block => (block.type === 'text' ? block.text : '')).join('\n')).toMatch(/^pulls\.review · main\.\.@ · 1 file · \+1 −0/u)
    }),
  )

  it.effect('reports a missing workspace as a failed review the agent can read', () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const tool = yield* Effect.promise(() =>
        f.host.tools.execute({
          callId: ToolCallId('call-2'),
          name: 'pulls_review',
          arguments: { path: join(f.workspace, 'gone') },
          signal: new AbortController().signal,
        }),
      )
      expect(tool.content).toEqual([{ type: 'text', text: 'That thread workspace is no longer on disk.' }])
    }),
  )
})
