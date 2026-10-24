/** `user`, `system`, or `agent:<sessionId>`: the short name one activity line shows for who did it. */
export const actorName = (id: string | undefined): string => {
  if (id === undefined || id === 'user') return 'You'
  if (id === 'system') return 'Automatic'
  return `Agent ${id.replace(/^agent:(session-)?/, '').slice(0, 6)}`
}
