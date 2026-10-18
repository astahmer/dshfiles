/**
 * Bounded rolling fan-out: a worker claims the next item as soon as it finishes its own, so one slow item never
 * holds back the rest of a fixed batch the way `Promise.all` over barrier waves does.
 */
const SKIPPED = Symbol('rolling-fan-out-skipped')

const runRolling = async <Item, Value>(input: {
  readonly items: readonly Item[]
  readonly concurrency: number
  readonly signal?: AbortSignal | undefined
  readonly map: (item: Item) => Promise<Value>
}): Promise<(Value | typeof SKIPPED)[]> => {
  const results = new Array<Value | typeof SKIPPED>(input.items.length).fill(SKIPPED)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < input.items.length && input.signal?.aborted !== true) {
      // oxlint-disable-next-line antislop/no-passthrough-variable -- Reserve the slot before awaiting; other workers advance nextIndex.
      const index = nextIndex
      nextIndex += 1
      const item = input.items[index]
      if (item === undefined) continue
      results[index] = await input.map(item)
    }
  }
  const workers = Math.min(Math.max(1, input.concurrency), input.items.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return results
}

/** Rolling fan-out without cancellation: every item is mapped exactly once, and results keep input order. */
export const mapRolling = async <Item, Value>(input: {
  readonly items: readonly Item[]
  readonly concurrency: number
  readonly map: (item: Item) => Promise<Value>
}): Promise<Value[]> => {
  const results = await runRolling(input)
  return results.map(value => {
    if (value === SKIPPED) throw new Error('Rolling fan-out left an item unmapped without a cancellation signal.')
    return value
  })
}

/** The same fan-out for cancellable sweeps: an item never claimed before the abort answers `undefined`. */
export const mapRollingUntilAborted = async <Item, Value>(input: {
  readonly items: readonly Item[]
  readonly concurrency: number
  readonly signal?: AbortSignal | undefined
  readonly map: (item: Item) => Promise<Value>
}): Promise<(Value | undefined)[]> => {
  const results = await runRolling(input)
  return results.map(value => (value === SKIPPED ? undefined : value))
}
