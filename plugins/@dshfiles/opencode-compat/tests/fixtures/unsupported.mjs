export const server = {
  id: 'unsupported',
  setup: async ctx => {
    await ctx.mcp.transform(() => {})
    await ctx.mcp.transform(() => {})
  },
}
