import type { ThreadLocation } from './thread-workspace-model.js'
import { ThreadError } from './threads-promise.js'

export const locateOrMissing = async (locate: () => Promise<ThreadLocation>): Promise<ThreadLocation | undefined> => {
  try {
    return await locate()
  } catch (error) {
    if (error instanceof ThreadError && error.code === 'not-a-repository') return undefined
    throw error
  }
}

export const locateBestEffort = async <Location>(locate: () => Promise<Location | undefined>): Promise<Location | undefined> => {
  try {
    return await locate()
  } catch {
    return undefined
  }
}
