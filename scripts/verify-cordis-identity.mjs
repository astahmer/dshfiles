import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'

const sourceFiles = [
  ['plugin', '../plugins/@dshfiles/cursor-agent/src/host.ts'],
  ['agent', '../tooling/dsh-core/agent/src/index.ts'],
  ['agent-loop', '../tooling/dsh-core/agent-loop/src/index.ts'],
  ['session', '../tooling/dsh-core/session/src/index.ts'],
  ['session-persistence', '../tooling/dsh-core/session-persistence/src/index.ts'],
  ['session-persistence-jsonl', '../tooling/dsh-core/session-persistence-jsonl/src/index.ts'],
  ['core-runtime-bridge', '../plugins/@dshfiles/dsh-core-runtime/src/host.ts'],
]
const dependencies = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-loader',
]
const resolutions = new Map(dependencies.map(dependency => [dependency, new Map()]))

for (const [label, sourceFile] of sourceFiles) {
  const require = createRequire(new URL(sourceFile, import.meta.url))
  for (const dependency of dependencies) {
    resolutions.get(dependency).set(label, realpathSync(require.resolve(dependency)))
  }
}

const mismatches = []
for (const [dependency, packages] of resolutions) {
  const uniquePaths = new Set(packages.values())
  if (uniquePaths.size > 1) {
    mismatches.push(`${dependency}: ${JSON.stringify(Object.fromEntries(packages))}`)
  }
}

if (mismatches.length > 0) {
  process.stderr.write(`Cordis package identity mismatch:\n${mismatches.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Cordis peer identity shared across ${sourceFiles.length} plugin/core package roots.\n`)
}
