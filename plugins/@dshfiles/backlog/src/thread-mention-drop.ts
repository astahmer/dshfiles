export const threadMentionText = ({ sessionId, title }: { readonly sessionId: string; readonly title: string }): string => {
  const payload = btoa(JSON.stringify(sessionId)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  const label = title.replace(/[\]\r\n]+/gu, ' ').trim() || sessionId
  return `@[${label}](dsh-session:${payload}) `
}
