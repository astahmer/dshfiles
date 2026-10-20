import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The dependency install a project's lockfile asks for, first match wins. */
const INSTALLERS: readonly { readonly lockfile: string; readonly install: string }[] = [
  { lockfile: 'pnpm-lock.yaml', install: 'pnpm install --frozen-lockfile --prefer-offline' },
  { lockfile: 'bun.lock', install: 'bun install --frozen-lockfile' },
  { lockfile: 'bun.lockb', install: 'bun install --frozen-lockfile' },
  { lockfile: 'yarn.lock', install: 'yarn install --immutable' },
  { lockfile: 'package-lock.json', install: 'npm ci --prefer-offline' },
]

export interface WorkspaceScripts {
  readonly project: string
  readonly setup: string
  readonly cleanup: string
}

/**
 * One setup and one cleanup script per project, written once from the project's lockfile and never rewritten, so a
 * hand edit stays. Both take a thread workspace path: setup installs its dependencies, cleanup deletes every
 * `node_modules` under it and refuses to run on the project's own checkout.
 */
export class ProjectScripts {
  static directoryFor(root: string, project: string): string {
    return join(root, project.replaceAll(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, ''))
  }

  static async ensure(input: { readonly root: string; readonly project: string }): Promise<WorkspaceScripts | null> {
    const installer = INSTALLERS.find(candidate => existsSync(join(input.project, candidate.lockfile)))
    if (installer === undefined) return null
    const directory = ProjectScripts.directoryFor(input.root, input.project)
    const scripts = { project: input.project, setup: join(directory, 'setup.sh'), cleanup: join(directory, 'cleanup.sh') }
    await mkdir(directory, { recursive: true })
    const header = `#!/bin/sh\n# Written once by DSH memory for ${input.project}; edit freely, it is never rewritten.\n# Usage: $0 <thread workspace path>\nset -eu\nworkspace="\${1:?thread workspace path}"\n`
    const files = [
      { path: scripts.setup, body: `${header}cd "$workspace"\n${installer.install}\n` },
      {
        path: scripts.cleanup,
        body: `${header}if [ "$(cd "$workspace" && pwd -P)" = "$(cd ${JSON.stringify(input.project)} && pwd -P)" ]; then\n  echo "refusing to clean the project checkout itself" >&2\n  exit 1\nfi\nfind "$workspace" -name node_modules -type d -prune -exec rm -rf {} +\n`,
      },
    ]
    for (const file of files) {
      if (existsSync(file.path)) continue
      await writeFile(file.path, file.body, { flag: 'wx' }).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      })
      await chmod(file.path, 0o755)
    }
    return scripts
  }
}
