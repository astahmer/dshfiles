export const events = []
export default {
  id: 'basic',
  setup: async ctx => {
    events.push({ options: ctx.options, frozen: Object.isFrozen(ctx.options), app: ctx.app })
    return async () => {
      events.push('cleanup')
    }
  },
}
