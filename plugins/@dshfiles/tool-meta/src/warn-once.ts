const warned = new Set<string>()

/** Contract drift against the native tool renderer is logged once per page, not once per card. */
export const warnOnce = (message: string): void => {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(`@dshfiles/tool-meta: ${message}`)
}
