import { RepositoryWorkspace } from '../tooling/dshx/packages/dshx/src/repository/workspace.ts'
import { decodeJson } from './json.ts'

// Runs before dshx is built, so it loads the dshx source directly; `dshx check repo --only cycles` runs the same check.
const root = RepositoryWorkspace.root(import.meta.dirname)
const cycles = RepositoryWorkspace.cycles(RepositoryWorkspace.packages({ root, decodeJson }))
if (cycles.length === 0) console.log('Workspace dependencies have no cycles.')
else {
  for (const cycle of cycles) console.error(`workspace dependency cycle: ${cycle.join(' ⇄ ')}`)
  console.error('Break it with a contract or registry owned by the lower plugin (docs/plugin-boundaries.md).')
  process.exitCode = 1
}
