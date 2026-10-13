import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'
import { open, mkdir, readFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const EXIT_DELAY_MS = 1000
const RESTART_EXIT_CODE = 75

export interface RestartControllerOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly scheduleExit?: (exit: () => void) => void
}

/** Written by the dsh-web supervisor next to its restart requests, mode 600. */
export const readLaunchUrl = async (env: NodeJS.ProcessEnv = process.env): Promise<string | null> => {
  const dshHome = resolve(env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  const recorded = await readFile(join(dshHome, 'runtime', 'web-url'), 'utf8').catch(() => '')
  return /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/\?token=\S+$/u.test(recorded.trim()) ? recorded.trim() : null
}

export const createRestartController = (ctx: Pick<Context, 'appExit'>, options: RestartControllerOptions = {}) => {
  const env = options.env ?? process.env
  const runId = env.DSH_RESTART_RUN_ID
  const requestPath = env.DSH_RESTART_REQUEST_PATH
  const dshHome = resolve(env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  const expectedRequestPath = runId !== undefined && RUN_ID_PATTERN.test(runId) ? join(dshHome, 'runtime', `dsh-web-restart-${runId}.request`) : undefined
  const appExit = ctx.appExit
  const available =
    appExit !== undefined &&
    expectedRequestPath !== undefined &&
    requestPath !== undefined &&
    isAbsolute(requestPath) &&
    resolve(requestPath) === expectedRequestPath
  const scheduleExit =
    options.scheduleExit ??
    (exit => {
      const timer = setTimeout(exit, EXIT_DELAY_MS)
      timer.unref()
    })

  return {
    available,
    async request(): Promise<{ accepted: true }> {
      if (!available || expectedRequestPath === undefined || runId === undefined || appExit === undefined)
        throw new Error('This DSH process is not running under the managed restart launcher.')

      await mkdir(join(dshHome, 'runtime'), { recursive: true, mode: 0o700 })
      let requestFile
      try {
        requestFile = await open(expectedRequestPath, 'wx', 0o600)
      } catch {
        throw new Error('A DSH restart request could not be scheduled.')
      }

      try {
        await requestFile.writeFile(runId)
      } catch {
        await requestFile.close().catch(() => undefined)
        await unlink(expectedRequestPath).catch(() => undefined)
        throw new Error('A DSH restart request could not be scheduled.')
      }
      await requestFile.close()
      scheduleExit(() => appExit(RESTART_EXIT_CODE))
      return { accepted: true }
    },
  }
}
