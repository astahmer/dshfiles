import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { decodeJson } from '../json.js'
import {
  REGISTRY_SCHEMA_VERSION,
  profileRecordsSchema,
  projectRecordsSchema,
  type PluginRecord,
  type ProfileRecords,
  type ProjectRecords,
  type SourceRecord,
} from './format.js'

const PROFILE_STATE_DIRECTORY = '.dshx-registry'
const PROJECT_RECORDS_FILE = '.dshx-registry.json'

const writeJson = async (path: string, value: ProfileRecords | ProjectRecords): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

const profileRecordsPath = (profileRoot: string): string => join(profileRoot, PROFILE_STATE_DIRECTORY, 'installed.json')

/** Verified tarballs stay in the profile: `pnpm install` must still resolve the `file:` dependency when the registry is offline. */
const tarballDirectory = (profileRoot: string): string => join(profileRoot, PROFILE_STATE_DIRECTORY, 'tarballs')

const readProfileRecords = async (profileRoot: string): Promise<Readonly<Record<string, PluginRecord>>> => {
  const path = profileRecordsPath(profileRoot)
  return existsSync(path) ? decodeJson(profileRecordsSchema, await readFile(path, 'utf8')).plugins : {}
}

const writeProfileRecords = async (profileRoot: string, plugins: Readonly<Record<string, PluginRecord>>): Promise<void> => {
  if (Object.keys(plugins).length === 0) await rm(profileRecordsPath(profileRoot), { force: true })
  else await writeJson(profileRecordsPath(profileRoot), { schemaVersion: REGISTRY_SCHEMA_VERSION, plugins })
}

const setProfileRecord = async (profileRoot: string, packageName: string, record: PluginRecord): Promise<void> => {
  await writeProfileRecords(profileRoot, { ...(await readProfileRecords(profileRoot)), [packageName]: record })
}

/** Forget a plugin and the tarball only it used. */
const dropProfileRecord = async (profileRoot: string, packageName: string): Promise<void> => {
  const { [packageName]: dropped, ...rest } = await readProfileRecords(profileRoot)
  if (dropped === undefined) return
  await writeProfileRecords(profileRoot, rest)
  await dropTarball(profileRoot, dropped.tarball)
}

const dropTarball = async (profileRoot: string, tarball: string | null): Promise<void> => {
  if (tarball !== null) await rm(join(tarballDirectory(profileRoot), tarball), { force: true })
}

const projectRecordsPath = (projectRoot: string): string => join(projectRoot, PROJECT_RECORDS_FILE)

const readProjectRecords = async (projectRoot: string): Promise<ProjectRecords['items']> => {
  const path = projectRecordsPath(projectRoot)
  return existsSync(path) ? decodeJson(projectRecordsSchema, await readFile(path, 'utf8')).items : {}
}

const writeProjectRecords = async (projectRoot: string, items: Readonly<Record<string, SourceRecord>>): Promise<void> => {
  if (Object.keys(items).length === 0) await rm(projectRecordsPath(projectRoot), { force: true })
  else await writeJson(projectRecordsPath(projectRoot), { schemaVersion: REGISTRY_SCHEMA_VERSION, items })
}

export class RegistryRecords {
  static readonly projectFile = PROJECT_RECORDS_FILE
  static readonly tarballDirectory = tarballDirectory
  static readonly readProfile = readProfileRecords
  static readonly setProfile = setProfileRecord
  static readonly dropProfile = dropProfileRecord
  static readonly dropTarball = dropTarball
  static readonly readProject = readProjectRecords
  static readonly writeProject = writeProjectRecords
}
