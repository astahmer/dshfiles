import { cp, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const prepareFixture = async ({ project }) => {
  await mkdir(project, { recursive: true })
  if ((await readdir(project)).length !== 0) throw new Error('ingestion-coding fixture requires an empty project directory')
  const template = fileURLToPath(new URL('./project/', import.meta.url))
  for (const entry of await readdir(template)) await cp(join(template, entry), join(project, entry), { recursive: true, force: false, errorOnExist: true })
  return {}
}
