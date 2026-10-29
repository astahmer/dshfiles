import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import { defineHost } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { previewRenderApi } from '@dshfiles/preview/render-api'
import type { ApiHostInput, ApiHostOutput } from '@dshfiles/dshx/api'
import hostDefinition from './host.js'

/**
 * A real Host with the native filesystem, working-directory, attachment and agent services, one Agent whose workspace is
 * a temp folder. `renderer` serves @dshfiles/preview's `preview-render` contract in its place: the preview Host itself
 * needs the native settings service, and its Chromium path is tested in that package.
 */
type ScreenshotMethod = (typeof previewRenderApi)['methods']['screenshotHtml']
type ScreenshotHtml = (input: ApiHostInput<ScreenshotMethod>) => Promise<ApiHostOutput<ScreenshotMethod>>

export const createHtmlRenderHost = async (options: { readonly renderer?: ScreenshotHtml } = {}) => {
  const cleanups: Array<() => Promise<void>> = []
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-html-render-')))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(workspace)
  await mkdir(outside)
  const host = await createTestHost()
  cleanups.push(() => host.dispose())
  await host.ctx.plugin(SessionStore)
  await host.ctx.plugin(SessionProjectionRegistry)
  await host.ctx.plugin(LocalFileSystem, { cwd: root })
  await host.ctx.plugin(WorkingDirectoryService)
  await host.ctx.plugin(LlmRuntime)
  await host.ctx.plugin(AgentRegistry)
  await host.ctx.plugin(AgentLoop)
  await host.ctx.plugin(LocalAttachmentStore, { dshHome: root })
  const renderer = options.renderer
  if (renderer !== undefined)
    await host.mount(defineHost({ name: '@dshfiles/preview', apis: [previewRenderApi.host({ screenshotHtml: ({ input }) => renderer(input) })] }), {
      packageId: '@dshfiles/preview',
    })
  if (process.env.DSH_HTML_RENDER_BUILT === '1') {
    await host.mount(await import(new URL('../dist/index.js', import.meta.url).href), { packageId: '@dshfiles/html-render', native: true })
  } else {
    await host.mount(hostDefinition, { packageId: '@dshfiles/html-render' })
  }
  const handle = await host.ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: workspace } })
  cleanups.push(() => handle.dispose())
  const run = (name: string, args: unknown, callId: string = randomUUID()) =>
    host.tools.execute({ callId: ToolCallId(callId), name, arguments: args, signal: AbortSignal.timeout(60_000), agent: handle.agent })
  return {
    ctx: host.ctx,
    workspace,
    outside,
    run,
    dispose: async () => {
      for (const cleanup of cleanups.reverse()) await cleanup()
    },
  }
}

export const textOf = (content: readonly { readonly type: string; readonly text?: string }[]): string => content.map(block => block.text ?? '').join('\n')
