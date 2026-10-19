/** Account writes run one at a time in call order: two overlapping saves of one account let the older draft land last. */
const create = () => {
  let tail: Promise<unknown> = Promise.resolve()
  return <Result>(write: () => Promise<Result>): Promise<Result> => {
    const run = tail.then(write)
    tail = run.catch(() => undefined)
    return run
  }
}

export class AccountWriteQueue {
  static readonly create = create
}
