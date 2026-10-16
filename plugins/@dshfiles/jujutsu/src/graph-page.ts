const quoteRevsetString = (value: string): string =>
  `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}"`

const searchRevset = (query: string): string => {
  const pattern = `substring-i:${quoteRevsetString(query)}`
  const matches = [`description(${pattern})`, `bookmarks(${pattern})`, `remote_bookmarks(${pattern})`, `tags(${pattern})`, 'working_copies()']
  if (/^[a-f0-9]{6,}$/i.test(query)) {
    const prefix = query.toLowerCase()
    matches.push(`commit_id(${prefix})`, `change_id(${prefix})`)
  }
  return `all() & (${matches.join(' | ')})`
}

export const graphPageRevset = (input: { readonly query: string; readonly excludeCommitIds: readonly string[] }): string => {
  const base = input.query.trim().length === 0 ? 'all()' : searchRevset(input.query.trim())
  if (input.excludeCommitIds.length === 0) return base
  return `${base} ~ (${input.excludeCommitIds.map(commitId => `commit_id(${commitId})`).join(' | ')})`
}
