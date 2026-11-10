/** Bounds concurrent cold log reads: a restore burst must not pin hundreds of decoded logs in one heap. */
export const createColdReads = (permits: number) => {
  let available = permits
  const waiting: Array<() => void> = []
  return {
    use: async <Value>(work: () => Promise<Value>): Promise<Value> => {
      if (available === 0) await new Promise<void>(resolve => waiting.push(resolve))
      else available -= 1
      try {
        return await work()
      } finally {
        const next = waiting.shift()
        if (next === undefined) available += 1
        else next()
      }
    },
  }
}

export const coldReads = createColdReads(4)
