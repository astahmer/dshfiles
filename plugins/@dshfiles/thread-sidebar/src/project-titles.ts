/**
 * A project title no other registered Workspace holds. A scratch folder keeps the thread's own title when it becomes a
 * project, and the native rename refuses a duplicate, so a collision takes the next free `Name 2`, `Name 3`, …
 */
export const uniqueProjectTitle = (input: { readonly desired: string; readonly taken: readonly string[] }): string => {
  const base = input.desired.trim()
  const used = new Set(input.taken)
  if (!used.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base} ${suffix}`
    if (!used.has(candidate)) return candidate
  }
}
