import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import { createTestHost } from '@dshfiles/dshx/testing'
import hostDefinition from './host.js'

/** A real Host with the native filesystem, working-directory and agent services, one Agent whose workspace is a temp folder. */
export const createHtmlRenderHost = async () => {
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
  if (process.env.DSH_HTML_RENDER_BUILT === '1') {
    await host.mount(await import(new URL('../dist/index.js', import.meta.url).href), { packageId: '@dshfiles/html-render', native: true })
  } else {
    await host.mount(hostDefinition, { packageId: '@dshfiles/html-render' })
  }
  const handle = await host.ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: workspace } })
  cleanups.push(() => handle.dispose())
  const run = (name: string, args: unknown) =>
    host.tools.execute({ callId: ToolCallId(randomUUID()), name, arguments: args, signal: AbortSignal.timeout(10_000), agent: handle.agent })
  return {
    workspace,
    outside,
    run,
    dispose: async () => {
      for (const cleanup of cleanups.reverse()) await cleanup()
    },
  }
}

export const textOf = (content: readonly { readonly type: string; readonly text?: string }[]): string => content.map(block => block.text ?? '').join('\n')
