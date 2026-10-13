export const ingest = async ({ store, organization, provider, fetchPage, sleep, maxPages = 3 }) => {
  let pagesCommitted = 0
  let current = store.scope({ organization, provider })
  while (pagesCommitted < maxPages && !current.complete) {
    const response = await fetchPage({ organization, provider, page: current.nextPage, attempt: 1 })
    if (response.status !== 200) {
      await sleep(1000)
      return { status: 'complete', reason: null, pagesCommitted, recordCount: current.records.length, nextPage: current.nextPage }
    }
    await store.commitPage({ organization, provider, page: current.nextPage, nextPage: response.nextPage, records: response.records, done: response.done })
    pagesCommitted += 1
    current = store.scope({ organization, provider })
  }
  return { status: 'complete', reason: null, pagesCommitted, recordCount: current.records.length, nextPage: current.nextPage }
}
