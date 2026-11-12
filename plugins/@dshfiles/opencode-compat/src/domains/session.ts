import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { DomainInput } from '../context.js'
import { unsupportedMember } from '../unsupported.js'

interface SessionContext {
  sessionID: string
  agent: string
  model: string
  system: Array<{ type: 'text'; text: string }>
  messages: unknown[]
  options: Record<string, unknown>
  tools: Record<string, { description: string; input: Record<string, unknown> }>
}

export const sessionDomain = (config: { readonly ctx: Context; readonly input: DomainInput }) => {
  const unsupported = (path: string) => unsupportedMember({ ...config.input, path })
  let hookIndex = 0
  return new Proxy(
    {
      hook: async (name: string, callback: (context: SessionContext) => void | Promise<void>) => {
        if (name !== 'context') return unsupported(`session.hook.${name}`)()
        const indexForHook = hookIndex++
        const dispose = config.ctx.on('system-prompt/assemble', async (_assembly, assemblyContext, next) => {
          const assembly = await next()
          const original = assembly.sections.map(section => section.text)
          const context: SessionContext = {
            sessionID: assemblyContext.agent?.session.id ?? '',
            agent: assemblyContext.agent?.id ?? '',
            model: assemblyContext.agent?.options.model ?? '',
            system: original.map(text => ({ type: 'text', text })),
            messages: [],
            options: {},
            tools: Object.fromEntries(assembly.tools.map(tool => [tool.name, { description: tool.description, input: structuredClone(tool.parameters) }])),
          }
          await callback(context)
          if (context.messages.length || Object.keys(context.options).length)
            await Promise.resolve(unsupported('session.hook(context).messages')()).catch(() => undefined)
          if (original.some((text, index) => context.system[index]?.text !== text))
            await Promise.resolve(unsupported('session.hook(context).system.edit')()).catch(() => undefined)
          const sections = [
            ...assembly.sections,
            ...context.system
              .slice(original.length)
              .map((part, index) => ({ name: `opencode-compat:${config.input.pluginId}:${indexForHook}:${index}`, text: part.text, interpolate: false })),
          ]
          const tools = assembly.tools.flatMap(tool => {
            const edited = context.tools[tool.name]
            return edited === undefined ? [] : [{ ...tool, description: edited.description }]
          })
          return { ...assembly, sections, tools }
        })
        config.input.contributions.hooks.push('session.context')
        return config.input.register({
          dispose: async () => {
            dispose()
          },
        })
      },
    },
    {
      get: (target, key) => (key in target ? Reflect.get(target, key) : typeof key === 'string' && key !== 'then' ? unsupported(`session.${key}`) : undefined),
    },
  )
}
