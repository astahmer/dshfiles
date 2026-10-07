import { spawnSync } from 'node:child_process'
import { lstat, realpath, symlink, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageDirectory = resolve(repoRoot, 'plugins/@dshfiles/dsh-core-runtime')
const dependencyDirectory = resolve(repoRoot, 'plugins/node_modules')
const packageDependencyLink = resolve(repoRoot, 'tooling/dsh-core/api-session-controller/node_modules')
const [command, ...args] = process.argv.slice(2)

if (command === undefined) throw new Error('Provide the focused package command to run.')

let createdLink = false

try {
  try {
    const existingLink = await lstat(packageDependencyLink)
    if (!existingLink.isSymbolicLink() || await realpath(packageDependencyLink) !== await realpath(dependencyDirectory)) {
      throw new Error('The API Session Controller node_modules path exists and does not point to the plugin dependency tree.')
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await symlink(dependencyDirectory, packageDependencyLink, 'dir')
    createdLink = true
  }

  const result = spawnSync(command, args, {
    cwd: packageDirectory,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  if (createdLink) await unlink(packageDependencyLink)
}
