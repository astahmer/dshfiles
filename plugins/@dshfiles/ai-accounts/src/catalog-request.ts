export const createCatalogRequestGuard = () => {
  let latestRequest = 0
  return {
    start: (): number => ++latestRequest,
    isLatest: (requestId: number): boolean => requestId === latestRequest,
    invalidate: (): void => {
      latestRequest += 1
    },
  }
}
