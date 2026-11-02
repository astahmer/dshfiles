import { spawn } from 'node:child_process'
import { Effect } from 'effect'

export const run = Effect.sync(() => spawn('jj', ['status']))
export const lazy = () => import('child_process')
