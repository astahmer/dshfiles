import { Effect, FileSystem, Path } from 'effect'

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

export const projectScriptsDirectory = (input: { readonly path: Path.Path; readonly root: string; readonly project: string }): string =>
  input.path.join(input.root, input.project.replaceAll(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, ''))

/**
 * One setup and one cleanup script per project, written once from the project's lockfile and never rewritten, so a
 * hand edit stays. Both take a thread workspace path: setup installs its dependencies, cleanup deletes every
 * `node_modules` under it and refuses to run on the project's own checkout.
 */
export const ensureProjectScripts = Effect.fn('memory ensure project scripts')(function* (input: { readonly root: string; readonly project: string }) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  let installer: (typeof INSTALLERS)[number] | undefined
  for (const candidate of INSTALLERS) {
    if (!(yield* fs.exists(path.join(input.project, candidate.lockfile)))) continue
    installer = candidate
    break
  }
  if (installer === undefined) return null
  const directory = projectScriptsDirectory({ path, root: input.root, project: input.project })
  const scripts: WorkspaceScripts = { project: input.project, setup: path.join(directory, 'setup.sh'), cleanup: path.join(directory, 'cleanup.sh') }
  yield* fs.makeDirectory(directory, { recursive: true })
  const header = `#!/bin/sh\n# Written once by DSH memory for ${input.project}; edit freely, it is never rewritten.\n# Usage: $0 <thread workspace path>\nset -eu\nworkspace="\${1:?thread workspace path}"\n`
  const files = [
    { path: scripts.setup, body: `${header}cd "$workspace"\n${installer.install}\n` },
    {
      path: scripts.cleanup,
      body: `${header}if [ "$(cd "$workspace" && pwd -P)" = "$(cd ${JSON.stringify(input.project)} && pwd -P)" ]; then\n  echo "refusing to clean the project checkout itself" >&2\n  exit 1\nfi\nfind "$workspace" -name node_modules -type d -prune -exec rm -rf {} +\n`,
    },
  ]
  for (const file of files) {
    if (yield* fs.exists(file.path)) continue
    yield* fs.writeFileString(file.path, file.body, { flag: 'wx' }).pipe(
      Effect.catchIf(
        error => error.reason._tag === 'AlreadyExists',
        () => Effect.void,
      ),
    )
    yield* fs.chmod(file.path, 0o755)
  }
  return scripts
})
