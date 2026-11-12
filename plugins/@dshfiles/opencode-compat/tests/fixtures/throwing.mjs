export const plugin = {
  id: 'throwing',
  setup: async ctx => {
    await ctx.tool.transform(() => {})
    throw new Error('setup exploded')
  },
}
