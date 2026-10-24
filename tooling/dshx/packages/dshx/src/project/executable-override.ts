import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

/** Explicit verification binaries must not silently fall back to a different runtime. */
export const resolveExecutableOverride = async (
  variable: 'DSHX_DSH_EXECUTABLE' | 'DSHX_CHROMIUM_EXECUTABLE',
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> => {
  const override = environment[variable]
  if (override === undefined) return undefined
  if (!isAbsolute(override) || override.includes('\0')) throw new Error(`${variable} must name an absolute executable file.`)
  const file = await stat(override).catch(() => undefined)
  if (file?.isFile() !== true) throw new Error(`${variable} must refer to an existing executable file.`)
  await access(override, constants.X_OK).catch(() => {
    throw new Error(`${variable} must refer to an executable file (execute permission is required).`)
  })
  return override
}
