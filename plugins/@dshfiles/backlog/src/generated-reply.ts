const attributionPrefix = (handle: string): readonly string[] => [`**@${handle}**`, `@${handle}`]

export const generatedReplyBody = (input: { readonly answer: string; readonly handle: string }): string => {
  const answer = input.answer.trim()
  for (const prefix of attributionPrefix(input.handle)) {
    if (!answer.startsWith(prefix)) continue
    const remainder = answer.slice(prefix.length)
    if (remainder !== '' && !/^[\s:—–-]/u.test(remainder)) continue
    return remainder.replace(/^[\s:—–-]+/u, '').trim()
  }
  return answer
}
