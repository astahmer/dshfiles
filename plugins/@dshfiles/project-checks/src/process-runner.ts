import { execFile } from 'node:child_process'
import type { StepResult } from './remote.js'

/** Runs one real process for the peer tests; a non-zero exit is data, not a rejection. */
export const runProcess = ({
  file,
  args,
  cwd,
  timeoutMs,
}: {
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
}): Promise<StepResult> =>
  new Promise(resolve => {
    execFile(file, [...args], { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ code: 0, stdout, stderr, failure: null })
        return
      }
      if (error.killed === true) {
        resolve({ code: null, stdout: '', stderr: error.message, failure: 'timed-out' })
        return
      }
      const exitCode = Number.isFinite(Number(error.code)) ? Number(error.code) : null
      resolve({ code: exitCode, stdout, stderr, failure: exitCode === null ? 'spawn-failed' : null })
    })
  })
