import { ScratchProfileRuntime } from '../../packages/dshx/src/project/scratch-profile.js'

export { createScratchProfile } from '../../packages/dshx/src/project/scratch-profile.js'
export const isolatedHostEnvironment = ScratchProfileRuntime.hostEnvironment
export const redactHostOutput = ScratchProfileRuntime.redactHostOutput
export type { ScratchProfile, ScratchProfileOptions } from '../../packages/dshx/src/project/scratch-profile.js'
