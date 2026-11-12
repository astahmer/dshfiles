export const state = {}

export default {
  id: 'fixture.skills-context-storage',
  setup: async ctx => {
    await ctx.skill.transform(editor => {
      editor.add({ id: 'compat-skill', name: 'compat-skill', description: 'A compatibility skill', content: 'Hello', autoinvoke: false })
    })
    await ctx.session.hook('context', context => {
      const original = context.system.find(part => part.text === 'original')
      if (original) original.text = 'original edited'
      context.system = context.system.filter(part => part.text !== 'drop me')
      context.system.push({ type: 'text', text: 'opencode-compat: hello' })
      context.messages.push({ role: 'user', content: 'unsupported' })
      delete context.tools.remove_me
      if (context.tools.keep_me) context.tools.keep_me.description = 'changed description'
    })
    await ctx.storage.set('prefix/a', { value: 1 })
    state.value = await ctx.storage.get('prefix/a')
    state.storage = ctx.storage
  },
}
