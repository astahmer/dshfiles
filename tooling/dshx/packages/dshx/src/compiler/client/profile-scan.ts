import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const PACKAGE_NAME = /^name:\s*'([^']+)'$/m

/**
 * Package names a DSH profile composes, used to scope sibling-plugin conflicts to
 * the profiles that actually install both packages. Reads `dsh --dump-config`
 * rather than the profile directory, so bundles and patches are resolved exactly
 * the way the runtime resolves them.
 */
export async function profilePackages(profile: string): Promise<readonly string[] | undefined> {
  let stdout: string
  try {
    ;({ stdout } = await run('dsh', ['--profile', profile, '--dump-config'], { maxBuffer: 32 * 1024 * 1024 }))
  } catch {
    return undefined
  }
  const names = new Set<string>()
  for (const line of stdout.split('\n')) {
    const match = PACKAGE_NAME.exec(line)
    if (match?.[1] !== undefined) names.add(match[1])
  }
  return [...names]
}
