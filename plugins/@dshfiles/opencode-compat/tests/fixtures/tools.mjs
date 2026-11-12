import { Schema } from 'effect'

export let toolDomain

export default {
  id: 'tools',
  setup: async ctx => {
    toolDomain = ctx.tool
    await ctx.tool.transform(editor => {
      editor.namespace({ name: 'oc', description: 'OpenCode tools' })
      editor.add({
        name: 'echo',
        description: 'Echo text.',
        input: Schema.Struct({ text: Schema.String }),
        execute: async input => ({ content: input.text, output: input.text }),
      })
    })
    await ctx.tool.hook('execute.before', input => {
      if (input.input?.text === 'deny-me') throw new Error('Denied by OpenCode plugin')
      if (input.tool === 'native_probe') input.input = { text: 'rewritten' }
    })
    await ctx.tool.hook('execute.after', input => {
      if (input.status === 'completed' && typeof input.result.content === 'string') input.result.content += ' [after]'
    })
  },
}
