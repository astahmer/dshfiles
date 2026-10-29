import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { decodeJson, jsonValueSchema } from '../json.js'

const dshxRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const workspacePolicyPath = join(dshxRoot, 'scratch-pnpm-policy.yaml')
const sourceManifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  dsh: z.object({ profile: z.object({ bundles: z.array(z.string()).optional() }).optional() }).optional(),
})
const profileNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)
const dependencySpecifierSchema = z
  .string()
  .min(1)
  .refine(specifier => {
    if (/[\r\n]|:\/\//.test(specifier)) return false
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(specifier)?.[1]?.toLowerCase()
    return scheme === undefined || ['link', 'file', 'workspace', 'npm'].includes(scheme)
  })

export interface ScratchProfileOptions {
  readonly profileName: string
  readonly sourceProfileRoot?: string
  readonly bundleIds?: readonly string[]
  readonly excludedDependencyPrefixes?: readonly string[]
  readonly extraDependencies?: Readonly<Record<string, string>>
}

export interface ScratchProfile {
  readonly home: string
  readonly profileRoot: string
  install(): Promise<void>
  cleanup(): Promise<void>
}

const resolvePathSpec = async (name: string, specifier: string, sourceRoot: string): Promise<string> => {
  if (!dependencySpecifierSchema.safeParse(specifier).success) {
    throw new Error(`The ${name} dependency uses a URL or unsupported protocol in the isolated profile.`)
  }
  const protocol = specifier.startsWith('link:') ? 'link:' : specifier.startsWith('file:') ? 'file:' : undefined
  if (protocol === undefined) return specifier

  const target = specifier.slice(protocol.length)
  if (target.length === 0) throw new Error(`The ${name} dependency has an empty local path.`)
  const absoluteTarget = isAbsolute(target) ? target : resolve(sourceRoot, target)
  await access(absoluteTarget).catch(() => {
    throw new Error(`The local path for ${name} does not exist in the E2E source profile.`)
  })
  return `${protocol}${absoluteTarget}`
}

const installerEnvironment = (): NodeJS.ProcessEnv => {
  const allowedNames = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'PNPM_HOME']
  const environment = Object.fromEntries(
    allowedNames.flatMap(name => {
      const value = process.env[name]
      return value === undefined ? [] : [[name, value]]
    }),
  )
  return {
    ...environment,
    npm_config_userconfig: '/dev/null',
    npm_config_globalconfig: '/dev/null',
  }
}

const installProfile = async (profileRoot: string, home: string): Promise<void> =>
  new Promise<void>((resolveInstall, reject) => {
    const child = spawn('pnpm', ['install', '--prefer-offline', '--config.userconfig=/dev/null', '--config.globalconfig=/dev/null'], {
      cwd: profileRoot,
      env: installerEnvironment(),
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_000)
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`pnpm install in the scratch profile timed out: ${stderr.slice(-400).replaceAll(home, '[scratch-home]')}`))
    }, 180_000)
    child.once('error', error => {
      clearTimeout(timer)
      reject(new Error(`pnpm could not start for the scratch profile: ${error.name}`))
    })
    child.once('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolveInstall()
      else reject(new Error(`pnpm install exited with code ${String(code)}: ${stderr.slice(-400).replaceAll(home, '[scratch-home]')}`))
    })
  })

export const createScratchProfile = async (options: ScratchProfileOptions): Promise<ScratchProfile> => {
  const parsedName = profileNameSchema.safeParse(options.profileName)
  if (!parsedName.success) throw new Error('The E2E scratch profile name is invalid.')
  const sourceRoot = resolve(options.sourceProfileRoot ?? process.env.DSH_E2E_SOURCE_PROFILE_ROOT ?? join(homedir(), '.dsh/profiles/web'))
  const home = await mkdtemp(join(tmpdir(), 'dshx-e2e-home-'))
  const profileRoot = join(home, 'profiles', options.profileName)

  try {
    const sourceText = await readFile(join(sourceRoot, 'package.json'), 'utf8')
    const sourceData = decodeJson(jsonValueSchema, sourceText)
    const parsedSource = sourceManifestSchema.safeParse(sourceData)
    if (!parsedSource.success) throw new Error('The E2E source profile package.json has an invalid shape.')

    const excludedPrefixes = options.excludedDependencyPrefixes ?? []
    const requestedBundles = options.bundleIds === undefined ? undefined : new Set(options.bundleIds)
    const dependencies = Object.fromEntries(
      await Promise.all(
        Object.entries(parsedSource.data.dependencies ?? {})
          .filter(([name]) => !excludedPrefixes.some(prefix => name.startsWith(prefix)))
          // With an explicit bundle list, a source dependency fetched from a URL (e.g. a GitHub plugin) is never
          // loaded, so it is left out rather than refusing the whole profile.
          .filter(([name, specifier]) => requestedBundles === undefined || requestedBundles.has(name) || dependencySpecifierSchema.safeParse(specifier).success)
          .map(async ([name, specifier]) => [name, await resolvePathSpec(name, specifier, sourceRoot)]),
      ),
    )
    for (const [name, specifier] of Object.entries(options.extraDependencies ?? {})) {
      dependencies[name] = await resolvePathSpec(name, specifier, sourceRoot)
    }

    const bundles = options.bundleIds ?? parsedSource.data.dsh?.profile?.bundles ?? []
    await mkdir(profileRoot, { recursive: true })
    await writeFile(
      join(profileRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: `dshx-e2e-${options.profileName}`,
          version: '0.0.0',
          private: true,
          dependencies,
          dsh: { profile: { bundles } },
        },
        null,
        2,
      )}\n`,
    )
    await writeFile(join(profileRoot, 'pnpm-workspace.yaml'), await readFile(workspacePolicyPath, 'utf8'))

    let cleaned = false
    return {
      home,
      profileRoot,
      install: () => installProfile(profileRoot, home),
      async cleanup(): Promise<void> {
        if (cleaned) return
        cleaned = true
        await rm(home, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await rm(home, { recursive: true, force: true })
    throw error
  }
}

const isolatedHostEnvironment = (home: string, profileRoot: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => {
  const allowedNames = ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'LOGNAME']
  const environment = Object.fromEntries(
    allowedNames.flatMap(name => {
      const value = source[name]
      return value === undefined ? [] : [[name, value]]
    }),
  )
  // `pnpm run` prepends workspace `node_modules/.bin`, whose `dsh` resolves this repo's overridden fork packages
  // instead of the installed Host the live profile runs.
  const path = source.PATH?.split(delimiter)
    .filter(entry => !entry.endsWith('/node_modules/.bin'))
    .join(delimiter)
  return {
    ...environment,
    ...(path !== undefined && { PATH: path }),
    ...(source.DSHX_SCRATCH_TRACE_IMPORT_ERRORS === '1' && { DSHX_SCRATCH_TRACE_IMPORT_ERRORS: '1' }),
    HOME: home,
    DSH_HOME: home,
    DSHX_BOOT_PROFILE_ROOT: profileRoot,
    XDG_CACHE_HOME: join(home, 'cache'),
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
  }
}

const redactHostOutput = (output: string): string =>
  output.replace(/https?:\/\/[^\s]+/gu, match => {
    try {
      return `${new URL(match).origin}/[redacted]`
    } catch {
      return '[redacted-url]'
    }
  })

export class ScratchProfileRuntime {
  static readonly hostEnvironment = isolatedHostEnvironment
  static readonly redactHostOutput = redactHostOutput
}
