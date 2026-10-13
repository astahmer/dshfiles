import { createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { failure, validateScope } from './errors.js'

const emptyScope = ({ organization, provider }) => ({ organization, provider, nextPage: 0, complete: false, records: [], commits: [] })
const matches = ({ current, organization, provider }) => current.organization === organization && current.provider === provider
const canonicalRecords = records => {
  if (!Array.isArray(records)) throw failure({ code: 'IC_INVALID_RECORD', message: 'Records must be an array' })
  const identifiers = new Set()
  return records.map(record => {
    if (
      record === null ||
      typeof record !== 'object' ||
      typeof record.externalId !== 'string' ||
      record.externalId.trim().length === 0 ||
      record.externalId.length > 128 ||
      typeof record.title !== 'string' ||
      typeof record.observedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T/.test(record.observedAt) ||
      !Number.isFinite(Date.parse(record.observedAt))
    )
      throw failure({ code: 'IC_INVALID_RECORD', message: 'Invalid canonical record' })
    if (identifiers.has(record.externalId)) throw failure({ code: 'IC_DUPLICATE_ID', message: 'Duplicate identity within one provider page' })
    identifiers.add(record.externalId)
    return { externalId: record.externalId, title: record.title, observedAt: record.observedAt }
  })
}

export const openStore = async ({ file }) => {
  let state = { version: 1, revision: 0, scopes: [] }
  let persisted
  try {
    persisted = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (persisted !== undefined) {
    try {
      state = JSON.parse(persisted)
      if (state?.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.scopes))
        throw new Error('Invalid state structure')
      for (const current of state.scopes) {
        validateScope(current)
        if (!Number.isSafeInteger(current.nextPage) || current.nextPage < 0 || ![false, true].includes(current.complete) || !Array.isArray(current.commits))
          throw new Error('Invalid scope structure')
        canonicalRecords(current.records)
      }
    } catch {
      throw failure({ code: 'IC_CORRUPT_STATE', message: 'Persisted state is not a valid ingestion snapshot' })
    }
  }
  let queue = Promise.resolve()
  const scope = ({ organization, provider }) => {
    validateScope({ organization, provider })
    return structuredClone(state.scopes.find(current => matches({ current, organization, provider })) ?? emptyScope({ organization, provider }))
  }
  const commit = async ({ organization, provider, page, nextPage, records, done = false }) => {
    validateScope({ organization, provider })
    if (!Number.isSafeInteger(page) || page < 0 || nextPage !== page + 1 || ![false, true].includes(done))
      throw failure({ code: 'IC_CHECKPOINT_CONFLICT', message: 'Page and next checkpoint must advance by exactly one' })
    const normalized = canonicalRecords(records)
    const current = scope({ organization, provider })
    const digest = createHash('sha256')
      .update(JSON.stringify({ page, nextPage, done, records: normalized.toSorted((left, right) => left.externalId.localeCompare(right.externalId)) }))
      .digest('hex')
    const replay = current.commits.find(item => item.page === page)
    if (replay !== undefined) {
      if (replay.digest !== digest) throw failure({ code: 'IC_REPLAY_MISMATCH', message: 'Replayed page payload differs from the committed page' })
      return { status: 'replayed', nextPage: current.nextPage, recordCount: current.records.length }
    }
    if (current.nextPage !== page || current.complete)
      throw failure({ code: 'IC_CHECKPOINT_CONFLICT', message: 'Page does not match the scoped durable checkpoint' })
    for (const record of normalized) {
      const index = current.records.findIndex(previous => previous.externalId === record.externalId)
      if (index === -1) current.records.push(record)
      if (index !== -1 && Date.parse(record.observedAt) > Date.parse(current.records[index].observedAt)) current.records[index] = record
    }
    current.nextPage = nextPage
    current.complete = done
    current.commits.push({ page, nextPage, digest })
    const candidate = structuredClone(state)
    const scopeIndex = candidate.scopes.findIndex(item => matches({ current: item, organization, provider }))
    if (scopeIndex === -1) candidate.scopes.push(current)
    if (scopeIndex !== -1) candidate.scopes[scopeIndex] = current
    candidate.revision += 1
    const temporary = `${file}.pending-${candidate.revision}`
    await writeFile(temporary, JSON.stringify(candidate), { flag: 'w' })
    await rename(temporary, file)
    state = candidate
    return { status: 'committed', nextPage, recordCount: current.records.length }
  }
  const commitPage = options => {
    const operation = queue.then(() => commit(options))
    queue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }
  return { snapshot: () => structuredClone(state), scope, commitPage }
}
