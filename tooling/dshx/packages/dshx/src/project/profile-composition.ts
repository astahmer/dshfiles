import { spawnOwnedProcess, stopOwnedProcess } from './owned-process.js'

export interface ProfileCompositionOptions {
  readonly projectRoot: string
  readonly profile: string
  readonly profileRoot: string
  readonly dshHome: string
  readonly executable?: string
  readonly timeoutMs: number
}

const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const exactBundlePresent = (dump: string, bundle: string): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_@/\\-])${escaped(bundle)}($|[^A-Za-z0-9_@/\\-])`, 'm').test(dump)

export const compositionFailures = (dump: string, expectedBundles: readonly string[]): readonly string[] =>
  expectedBundles.filter(bundle => !exactBundlePresent(dump, bundle))

export const readProfileComposition = async (options: ProfileCompositionOptions): Promise<string> => {
  const child = spawnOwnedProcess(options.executable ?? 'dsh', ['--profile', options.profile, '--dump-config'], {
    cwd: options.projectRoot,
    env: { ...process.env, DSH_HOME: options.dshHome, DSHX_BOOT_PROFILE_ROOT: options.profileRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  try {
    return await new Promise<string>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.off('error', handleError)
        child.off('close', handleClose)
        if (error === undefined) resolve(stdout)
        else reject(error)
      }
      const handleError = (error: Error): void => finish(new Error(`dsh --dump-config could not start: ${error.message}`))
      const handleClose = (code: number | null): void => {
        if (code === 0) finish()
        else finish(new Error(`dsh --dump-config exited with code ${String(code)}.`))
      }
      const timer = setTimeout(() => finish(new Error(`dsh --dump-config did not finish within ${options.timeoutMs}ms.`)), options.timeoutMs)
      child.once('error', handleError)
      child.once('close', handleClose)
    })
  } finally {
    await stopOwnedProcess(child)
  }
}
