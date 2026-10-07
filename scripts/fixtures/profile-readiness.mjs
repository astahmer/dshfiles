export const inject = ['loader']

export const apply = ctx => {
  const deadline = Date.now() + 15_000
  let settled = false
  const inspect = () => {
    const inactive = [...ctx.loader.entries()].filter(entry => !entry.disabled && entry.fiber?.state !== 2).map(entry => ({
      id: entry.options.id,
      name: entry.options.name,
      state: entry.fiber?.state ?? null,
    }))
    if (inactive.length > 0 && Date.now() < deadline) return
    settled = true
    clearInterval(timer)
    console.log('DSHFILES_PROFILE_READINESS', JSON.stringify({ inactive }))
  }
  const timer = setInterval(inspect, 50)
  ctx.effect(() => () => {
    clearInterval(timer)
    if (!settled) console.log('DSHFILES_PROFILE_READINESS', JSON.stringify({ interrupted: true }))
  })
}
