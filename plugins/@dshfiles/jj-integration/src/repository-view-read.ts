import { ThreadError } from './threads-promise.js'

export const readRepositoryView = async <Value>(input: {
  readonly read: () => Promise<Value>
  readonly onNotRepository: () => void
}): Promise<Value | undefined> => {
  try {
    return await input.read()
  } catch (error) {
    if (!(error instanceof ThreadError) || error.code !== 'not-a-repository') throw error
    input.onNotRepository()
    return undefined
  }
}
