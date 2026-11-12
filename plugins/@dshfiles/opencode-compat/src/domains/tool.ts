import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { DomainInput } from '../context.js'
import { unsupportedMember, type Registration } from '../unsupported.js'
import { convertToolSchema } from './tool-schema.js'

type ToolResult = { content?: string | readonly { type: string; text?: string }[]; output?: unknown; metadata?: unknown }
type ToolInfo = {
  name: string
  description: string
  input: unknown
  options?: { namespace?: string; codemode?: boolean; pinned?: boolean; permission?: string }
  execute: (
    input: unknown,
    context: { sessionID: string; agent: string; messageID: string; id: string; signal: AbortSignal; progress: () => Promise<void> },
  ) => Promise<ToolResult>
}
type ListedTool = ToolInfo & { id: string }
type Editor = {
  add: (info: ToolInfo) => void
  list: () => readonly ListedTool[]
  get: (id: string) => ListedTool | undefined
  update: (id: string, fn: (info: ToolInfo) => void) => void
  remove: (id: string) => void
  namespace: (value: { name: string; description: string }) => void
}
type Transform = (editor: Editor) => void

const textContent = (content: ToolResult['content']): ContentBlock[] => {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return (content ?? []).flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [{ type: 'text', text: block.text }] : []))
}

const identity = (exec: ToolExecution) => ({
  tool: exec.name,
  sessionID: String(exec.agent?.session.id ?? ''),
  agent: String(exec.agent?.id ?? ''),
  messageID: '',
  id: String(exec.callId),
})

export const createToolDomain =
  ({ ctx }: { readonly ctx: Context }) =>
  (input: DomainInput): unknown => {
    const transforms: Transform[] = []
    let tools: ListedTool[] = []
    let installed: Registration[] = []
    const content = new Map<ToolExecutionToken, ContentBlock[]>()
    const record = (path: string) => {
      const result = unsupportedMember({ ...input, path })()
      if (result instanceof Promise) void result.catch(() => undefined)
    }
    const reload = async () => {
      for (const registration of installed) await registration.dispose()
      installed = []
      tools = []
      let namespace = ''
      const editor: Editor = {
        add: info => {
          const prefix = info.options?.namespace ?? namespace
          const id = prefix ? `${prefix}_${info.name}` : info.name
          tools.push({ ...info, id })
        },
        list: () => [...tools],
        get: id => tools.find(tool => tool.id === id),
        update: (id, fn) => {
          const tool = tools.find(item => item.id === id)
          if (!tool) {
            record('tool.transform.update(native)')
            return
          }
          fn(tool)
        },
        remove: id => {
          if (!tools.some(item => item.id === id)) {
            record('tool.transform.remove(native)')
            return
          }
          tools = tools.filter(tool => tool.id !== id)
        },
        namespace: value => {
          namespace = value.name
        },
      }
      for (const transform of transforms) transform(editor)
      const accepted: ListedTool[] = []
      for (const tool of tools) {
        try {
          const schema = convertToolSchema({ schema: tool.input })
          for (const option of ['codemode', 'pinned', 'permission'] as const) {
            if (tool.options?.[option] !== undefined && !input.records.some(record => record.api === `ctx.tool.options.${option}`))
              record(`tool.options.${option}`)
          }
          const off = ctx.tools.register({
            name: tool.id,
            description: tool.description,
            parameters: { ...schema.json },
            output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
            execute: async (args, exec) => {
              const value = await schema.validate(args)
              const result = await tool.execute(value, { ...identity(exec), signal: exec.signal, progress: async () => undefined })
              content.set(exec.token, textContent(result.content))
              return result.output ?? null
            },
            projectContent: exec => {
              const blocks = content.get(exec.token)
              content.delete(exec.token)
              return blocks
            },
          })
          installed.push(
            input.register({
              dispose: async () => {
                off()
              },
            }),
          )
          accepted.push(tool)
          if (!input.contributions.tools.includes(tool.id)) input.contributions.tools.push(tool.id)
        } catch (error) {
          record(`tool.schema(${tool.id}): ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      tools = accepted
    }
    const domain = {
      transform: async (transform: Transform) => {
        transforms.push(transform)
        const registration = input.register({
          dispose: async () => {
            const index = transforms.indexOf(transform)
            if (index >= 0) transforms.splice(index, 1)
            await reload()
          },
        })
        await reload()
        return registration
      },
      reload,
      list: async () => [...tools],
      hook: async (name: string, callback: (event: any) => unknown) => {
        if (name === 'execute.before') {
          const off = ctx.on('tools/pre-execute', async (exec, next) => {
            const event = { ...identity(exec), input: structuredClone(exec.arguments) }
            const original = structuredClone(event.input)
            try {
              await callback(event)
            } catch (error) {
              return { kind: 'deny', reason: error instanceof Error ? error.message : String(error) }
            }
            if (event.tool !== exec.name || !isDeepStrictEqual(event.input, original))
              return { kind: 'deny', reason: 'OpenCode tool or input rewrite is unsupported by DSH (Host gap 112).' }
            return next()
          })
          input.contributions.hooks.push('tool.execute.before')
          return input.register({
            dispose: async () => {
              off()
            },
          })
        }
        if (name === 'execute.after') {
          const off = ctx.on('tools/post-execute', async (exec, result, next) => {
            const event = result.isError
              ? { ...identity(exec), input: structuredClone(exec.arguments), status: 'error', error: structuredClone(result.error) }
              : {
                  ...identity(exec),
                  input: structuredClone(exec.arguments),
                  status: 'completed',
                  result: {
                    content: result.content.map(block => (block.type === 'text' ? block.text : '')).join(''),
                    output: structuredClone(result.value),
                    metadata: structuredClone(result.meta),
                  },
                }
            const before = structuredClone(event)
            await callback(event)
            if ('result' in event && 'result' in before && event.result && before.result) {
              const replacement = event.result.content
              const changedContent = !isDeepStrictEqual(replacement, before.result.content)
              event.result.content = before.result.content
              if (!isDeepStrictEqual(event, before)) record('tool.hook.execute.after(rewrite)')
              if (changedContent) {
                const downstream = await next()
                if (downstream.kind !== 'accept') return downstream
                return {
                  kind: 'accept',
                  content: textContent(replacement),
                  ...(downstream.additionalContexts ? { additionalContexts: downstream.additionalContexts } : {}),
                }
              }
            } else if (!isDeepStrictEqual(event, before)) record('tool.hook.execute.after(rewrite)')
            return next()
          })
          input.contributions.hooks.push('tool.execute.after')
          return input.register({
            dispose: async () => {
              off()
            },
          })
        }
        return unsupportedMember({ ...input, path: `tool.hook.${name}` })()
      },
    }
    return new Proxy(domain, {
      get: (target, key, receiver) =>
        typeof key === 'string' && !(key in target) ? unsupportedMember({ ...input, path: `tool.${key}` }) : Reflect.get(target, key, receiver),
    })
  }
