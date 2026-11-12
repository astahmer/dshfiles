import { Schema } from 'effect'

export const state = {}

export default {
  id: 'example.sample',
  setup: async ctx => {
    await ctx.tool.transform(editor => {
      editor.add({
        name: 'sample_echo',
        description: 'Echo text.',
        input: Schema.Struct({ text: Schema.String }),
        execute: async input => {
          const count = (await ctx.storage.get('calls')) ?? 0
          await ctx.storage.set('calls', count + 1)
          state.calls = await ctx.storage.get('calls')
          return { content: input.text, output: input.text }
        },
      })
    })
    await ctx.tool.hook('execute.before', input => {
      if (input.tool === 'sample_echo' && input.input?.text === 'blocked') throw new Error('Denied by opencode-sample')
    })
    await ctx.tool.hook('execute.after', input => {
      if (input.tool === 'sample_echo' && input.status === 'completed' && typeof input.result.content === 'string')
        input.result.content += ' (via opencode-sample)'
    })
    await ctx.skill.transform(editor =>
      editor.add({ id: 'sample-skill', name: 'sample-skill', description: 'A sample skill', content: 'Sample skill', autoinvoke: false }),
    )
    await ctx.session.hook('context', context => context.system.push({ type: 'text', text: 'opencode-sample: system line' }))
    await ctx.mcp.transform(() => {})
    return () => {
      state.cleaned = true
    }
  },
}
