import { readFile, writeFile } from 'node:fs/promises'

export const openStore = async ({ file }) => {
  let state = { version: 1, revision: 0, scopes: [] }
  try {
    state = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const scope = ({ organization, provider }) =>
    state.scopes.find(item => item.provider === provider) ?? { organization, provider, nextPage: 0, complete: false, records: [], commits: [] }
  const commitPage = async ({ organization, provider, page, nextPage, records, done = false }) => {
    const current = scope({ organization, provider })
    if (!state.scopes.includes(current)) state.scopes.push(current)
    for (const record of records) {
      const previous = current.records.findIndex(item => item.externalId === record.externalId)
      if (previous === -1) current.records.push(record)
      if (previous !== -1) current.records[previous] = record
    }
    current.nextPage = nextPage
    current.complete = done
    current.commits.push({ page, nextPage })
    state.revision += 1
    await writeFile(file, JSON.stringify(state))
    return { status: 'committed', nextPage, recordCount: current.records.length }
  }
  return { snapshot: () => state, scope, commitPage }
}
