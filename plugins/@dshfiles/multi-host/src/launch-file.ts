import { randomUUID } from 'node:crypto'
import * as Schema from 'effect/Schema'
import { MultiHostSchema } from './schema.js'
import { readFileSync, rmSync } from 'node:fs'
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Where a running DSH tells a multi-host manager how to reach it: the tokenized loopback launch URL, written 0600 by
 * the runtime's own multi-host Host. `runtime/web-url` is the same fact written by the dsh-web supervisor, read when
 * the runtime has no multi-host plugin. Replaces scraping the systemd journal, so any Unix host with SSH works.
 */
export const launchFilePaths = (dshHome: string): readonly [string, string] => [
  join(dshHome, 'plugins', 'multi-host', 'launch.json'),
  join(dshHome, 'runtime', 'web-url'),
]

const launchUrlSchema = Schema.Trim.check(Schema.isPattern(/^http:\/\/127\.0\.0\.1:\d{1,5}\/\?token=[A-Za-z0-9._~-]{8,512}$/))
const launchRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  launchUrl: launchUrlSchema,
  pid: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
}).pipe(MultiHostSchema.passthrough)

export type RuntimeLaunch = { readonly port: number; readonly token: string }

/** Decode either launch file: the JSON record or a bare URL line. Anything else reads as no launch. */
export const parseRuntimeLaunch = (content: string): RuntimeLaunch | undefined => {
  let url: string | undefined
  try {
    const record = MultiHostSchema.safeDecode(launchRecordSchema, JSON.parse(content))
    if (record.success) url = record.data.launchUrl
  } catch {
    const line = MultiHostSchema.safeDecode(launchUrlSchema, content.split('\n', 1)[0] ?? '')
    if (line.success) url = line.data
  }
  if (url === undefined) return undefined
  const parsed = new URL(url)
  const port = Number(parsed.port)
  const token = parsed.searchParams.get('token')
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || token === null) return undefined
  return { port, token }
}

const writeLaunchFile = async ({ dshHome, launchUrl }: { readonly dshHome: string; readonly launchUrl: string }): Promise<string> => {
  const [path] = launchFilePaths(dshHome)
  const record = { schemaVersion: 1, launchUrl: MultiHostSchema.decode(launchUrlSchema, launchUrl), pid: process.pid, writtenAt: new Date().toISOString() }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await chmod(dirname(path), 0o700)
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  try {
    try {
      await file.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
    } finally {
      await file.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  return path
}

/** Remove the launch file only while it still names this process, so a newer runtime's record survives. */
const removeLaunchFile = async (path: string): Promise<void> => {
  const content = await readFile(path, 'utf8').catch(() => '')
  try {
    const record = MultiHostSchema.safeDecode(launchRecordSchema, JSON.parse(content))
    if (record.success && record.data.pid === process.pid) await rm(path, { force: true })
  } catch {
    // Not ours to remove.
  }
}

const removeLaunchFileSync = (path: string): void => {
  try {
    const record = MultiHostSchema.safeDecode(launchRecordSchema, JSON.parse(readFileSync(path, 'utf8')))
    if (record.success && record.data.pid === process.pid) rmSync(path, { force: true })
  } catch {
    // Not ours to remove.
  }
}

const publishLaunchFile = async (options: { readonly dshHome: string; readonly launchUrl: string }): Promise<{ readonly release: () => Promise<void> }> => {
  const path = await writeLaunchFile(options)
  // DSH can exit on a signal without disposing plugins; a stale launch file would point managers at a dead port.
  const removeOnExit = () => removeLaunchFileSync(path)
  process.once('exit', removeOnExit)
  return {
    release: () => {
      process.off('exit', removeOnExit)
      return removeLaunchFile(path)
    },
  }
}

export class RuntimeLaunchFile {
  static readonly launchFilePaths = launchFilePaths
  static readonly parseRuntimeLaunch = parseRuntimeLaunch
  static readonly writeLaunchFile = writeLaunchFile
  static readonly removeLaunchFile = removeLaunchFile
  static readonly removeLaunchFileSync = removeLaunchFileSync
  static readonly publishLaunchFile = publishLaunchFile
}
