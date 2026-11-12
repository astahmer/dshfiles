export default {
  id: 'partial',
  setup: async ctx => {
    await ctx.session.hook('context', () => {})
    await ctx.session.prompt().catch(() => {})
  },
}
