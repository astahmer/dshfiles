import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chmod, link, lstat, mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { pluginDataPath, runtimeHomeLeaf } from './store.js'
import { runtimeIdentitySchema, type RuntimeIdentity } from './records.js'

const persistedIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    runtimeId: z.string().uuid(),
    profile: z.string().min(1).max(64),
  })
  .strict()
const profileSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)

export class RuntimeIdentityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RuntimeIdentityError'
  }
}

const activeProfile = (): string | undefined => {
  const environmentProfile = process.env.DSH_PROFILE ?? process.env.DSH_PROFILE_NAME
  if (environmentProfile !== undefined && environmentProfile.trim() !== '') return environmentProfile.trim()
  const argumentsList = process.argv
  const valueOptions = new Set(['--port', '--host', '--cwd'])
  for (let index = 2; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === undefined) continue
    if (argument === '--profile' || argument === '-p') {
      const profile = argumentsList[index + 1]
      if (profile !== undefined && profile.trim() !== '') return profile.trim()
      index += 1
      continue
    }
    if (argument.startsWith('--profile=')) return argument.slice('--profile='.length)
    if (valueOptions.has(argument)) {
      index += 1
      continue
    }
    if (!argument.startsWith('-')) return argument
  }
  return undefined
}

const dshVersion = (): string => {
  try {
    const require = createRequire(import.meta.url)
    const packagePath = require.resolve('@deepseek-ai/dsh/package.json')
    const packageValue: unknown = JSON.parse(readFileSync(packagePath, 'utf8'))
    const parsed = z.object({ version: z.string().min(1).max(80) }).safeParse(packageValue)
    return parsed.success ? parsed.data.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

const secureIdentityPath = async (path: string): Promise<void> => {
  const parent = dirname(path)
  try {
    const parentFacts = await lstat(parent)
    if (!parentFacts.isDirectory()) throw new RuntimeIdentityError('identity-path-invalid', 'The runtime identity directory must be a private directory.')
    await chmod(parent, 0o700)
  } catch (error) {
    if (error instanceof RuntimeIdentityError) throw error
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw new RuntimeIdentityError('identity-unreadable', 'The runtime identity directory could not be secured.')
  }
  try {
    const fileFacts = await lstat(path)
    if (!fileFacts.isFile()) throw new RuntimeIdentityError('identity-path-invalid', 'The runtime identity must be stored in a regular file.')
    await chmod(path, 0o600)
  } catch (error) {
    if (error instanceof RuntimeIdentityError) throw error
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw new RuntimeIdentityError('identity-unreadable', 'The runtime identity file could not be secured.')
  }
}

const readPersistedIdentity = async (path: string): Promise<z.infer<typeof persistedIdentitySchema> | undefined> => {
  await secureIdentityPath(path)
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw new RuntimeIdentityError('identity-unreadable', 'The runtime identity file could not be read.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new RuntimeIdentityError('identity-corrupt', 'The runtime identity file contains invalid JSON and was left untouched.')
  }
  const result = persistedIdentitySchema.safeParse(parsed)
  if (!result.success) throw new RuntimeIdentityError('identity-corrupt', 'The runtime identity file has an unsupported shape and was left untouched.')
  return result.data
}

const persistIdentity = async (path: string, value: z.infer<typeof persistedIdentitySchema>): Promise<void> => {
  const parent = dirname(path)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await secureIdentityPath(path)
  const temporary = join(parent, 'runtime-identity.' + process.pid + '.' + randomUUID() + '.tmp')
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    await link(temporary, path)
    await chmod(path, 0o600)
    await rm(temporary, { force: true })
  } catch {
    await rm(temporary, { force: true })
    throw new RuntimeIdentityError('identity-write-failed', 'The runtime identity could not be committed atomically.')
  }
}

export const readOrCreateRuntimeIdentity = async (configuredProfile?: string): Promise<RuntimeIdentity> => {
  const discoveredProfile = activeProfile()
  const reportedProfile = discoveredProfile ?? configuredProfile?.trim()
  if (reportedProfile === undefined || reportedProfile.length === 0) {
    throw new RuntimeIdentityError('profile-unavailable', 'Set the multi-host profile field or launch DSH with --profile before registering this runtime.')
  }
  if (discoveredProfile !== undefined && configuredProfile !== undefined && discoveredProfile !== configuredProfile) {
    throw new RuntimeIdentityError('profile-mismatch', 'The multi-host profile setting does not match the running DSH profile.')
  }
  const profile = profileSchema.parse(reportedProfile)
  const path = pluginDataPath(join('runtime-identities', profile + '.json'))
  let persisted = await readPersistedIdentity(path)
  if (persisted === undefined) {
    const proposed = { schemaVersion: 1 as const, runtimeId: randomUUID(), profile }
    try {
      await persistIdentity(path, proposed)
      persisted = proposed
    } catch (error) {
      const winner = await readPersistedIdentity(path)
      if (winner === undefined) throw error
      persisted = winner
    }
  }
  if (persisted.profile !== profile) {
    throw new RuntimeIdentityError('profile-mismatch', 'The recorded runtime identity belongs to a different DSH profile.')
  }
  return runtimeIdentitySchema.parse({
    protocolVersion: 1,
    runtimeId: persisted.runtimeId,
    profile: persisted.profile,
    homeLeaf: runtimeHomeLeaf(),
    dshVersion: dshVersion(),
    capabilities: ['workspace', 'session', 'agent'],
  })
}
