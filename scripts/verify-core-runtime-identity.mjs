import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'

const edges = [
  ['agent', '../tooling/dsh-core/agent/src/index.ts', [['@deepseek-ai/dsh-session', 'session']]],
  ['agent-loop', '../tooling/dsh-core/agent-loop/src/index.ts', [
    ['@deepseek-ai/dsh-agent', 'agent'],
    ['@deepseek-ai/dsh-session', 'session'],
    ['@deepseek-ai/dsh-session-persistence', 'session-persistence'],
    ['@deepseek-ai/dsh-session-persistence-jsonl', 'session-persistence-jsonl'],
  ]],
  ['session-persistence', '../tooling/dsh-core/session-persistence/src/index.ts', [
    ['@deepseek-ai/dsh-session', 'session'],
  ]],
  ['session-persistence-jsonl', '../tooling/dsh-core/session-persistence-jsonl/src/index.ts', [
    ['@deepseek-ai/dsh-session', 'session'],
    ['@deepseek-ai/dsh-session-persistence', 'session-persistence'],
    ['@deepseek-ai/dsh-session-format-catalog', 'session-format-catalog'],
  ]],
  ['session-format-catalog', '../tooling/dsh-core/session-format-catalog/src/index.ts', [
    ['@deepseek-ai/dsh-session', 'session'],
    ['@deepseek-ai/dsh-session-format-v4-to-v5', 'session-format-v4-to-v5'],
  ]],
  ['session-format-v4-to-v5', '../tooling/dsh-core/session-format-v4-to-v5/src/index.ts', [
    ['@deepseek-ai/dsh-session', 'session'],
  ]],
  ['core-runtime-bridge', '../plugins/@dshfiles/dsh-core-runtime/src/host.ts', [
    ['@deepseek-ai/dsh-agent', 'agent'],
    ['@deepseek-ai/dsh-agent-loop', 'agent-loop'],
    ['@deepseek-ai/dsh-session', 'session'],
    ['@deepseek-ai/dsh-session-persistence', 'session-persistence'],
    ['@deepseek-ai/dsh-session-persistence-jsonl', 'session-persistence-jsonl'],
  ]],
]

const mismatches = []
let edgeCount = 0

for (const [label, sourceFile, dependencies] of edges) {
  const packageRequire = createRequire(new URL(sourceFile, import.meta.url))
  for (const [dependency, expectedPackage] of dependencies) {
    edgeCount += 1
    const expectedRoot = realpathSync(new URL(`../tooling/dsh-core/${expectedPackage}/`, import.meta.url))
    const resolvedPath = realpathSync(packageRequire.resolve(dependency))
    const fromExpectedRoot = relative(expectedRoot, resolvedPath)
    if (fromExpectedRoot === '..' || fromExpectedRoot.startsWith(`..${sep}`) || isAbsolute(fromExpectedRoot)) {
      mismatches.push(`${label} -> ${dependency}: expected ${expectedRoot}, resolved ${resolvedPath}`)
    }
  }
}

if (mismatches.length > 0) {
  process.stderr.write(`Local DSH core package identity mismatch:\n${mismatches.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Verified ${edgeCount} local core-package links across ${edges.length} package roots.\n`)
}
