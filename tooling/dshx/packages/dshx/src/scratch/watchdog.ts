import { parseArgs } from 'node:util'
import { ScratchReaperRuntime } from './reaper.js'
import { ScratchStateRuntime } from './state.js'

/**
 * `node watchdog.js --state-dir <dir>`: started detached by `dshx dev up`, it runs `down` on that instance once its
 * idle lease expires or its dsh process is gone, so a forgotten scratch DSH does not keep a Host and Chromium running.
 * It exits when the state is gone (a manual `down`) or names another watchdog (a later `up`).
 */
const { values } = parseArgs({ options: { 'state-dir': { type: 'string' }, 'interval-ms': { type: 'string' } } })
const stateDir = values['state-dir']
if (stateDir === undefined) throw new Error('Usage: watchdog.js --state-dir <dir> [--interval-ms <ms>]')
const intervalMs = Number(values['interval-ms'] ?? 60_000)

const log = (message: string): void => {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`)
}

const keepWatching = async (): Promise<boolean> => {
  const state = await ScratchStateRuntime.read(stateDir, stateDir).catch(() => undefined)
  if (state === undefined) {
    log('the scratch state is gone; exiting')
    return false
  }
  if (state.watchdog !== undefined && state.watchdog.pid !== process.pid) {
    log(`watchdog pid ${state.watchdog.pid} owns this instance now; exiting`)
    return false
  }
  const reaped = await ScratchReaperRuntime.reapIfStale({ stateDir, now: Date.now() })
  if (reaped === undefined) return true
  log(`stopped "${reaped.name}": ${reaped.reason}${reaped.leftRunning.length > 0 ? `; still running: ${reaped.leftRunning.join(', ')}` : ''}`)
  return false
}

const schedule = (): void => {
  setTimeout(() => {
    keepWatching().then(
      keep => (keep ? schedule() : process.exit(0)),
      (error: unknown) => {
        log(`check failed: ${ScratchStateRuntime.redactUrls(error instanceof Error ? error.message : String(error))}`)
        schedule()
      },
    )
  }, intervalMs)
}
schedule()
