export const createAiActivityTracker = () => {
  const active = new Set<symbol>()
  return {
    isActive: (): boolean => active.size > 0,
    track: async <Result>(work: () => Promise<Result>): Promise<Result> => {
      const id = Symbol()
      active.add(id)
      try {
        return await work()
      } finally {
        active.delete(id)
      }
    },
  }
}
