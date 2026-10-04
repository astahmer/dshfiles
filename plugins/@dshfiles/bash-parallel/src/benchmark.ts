import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { classifyBashCommand } from './classify.js'

const exec = promisify(execFile)

const READ_COMMANDS = [
  'ls -la src',
  'cat package.json',
  'git status',
  'git log --oneline -5',
  'wc -l *.ts',
  'git diff --stat',
  'ast-outline src/index.ts',
  'cat README.md',
  'git show HEAD --stat',
  'git ls-files | head -20',
  'cat tsconfig.json',
  'du -sh node_modules',
] as const

const WORKDIR = '/Users/astahmer/dev/dshfiles'

const approved = READ_COMMANDS.filter((command) => classifyBashCommand(command).parallel)
console.log(`classifier approves ${approved.length}/${READ_COMMANDS.length} benchmark commands`)
for (const command of READ_COMMANDS) {
  if (approved.includes(command)) continue
  console.log(`  rejected: ${command} -> ${classifyBashCommand(command).reason}`)
}

const timeOne = async (command: string): Promise<number> => {
  const started = process.hrtime.bigint()
  await exec('bash', ['-c', command], { cwd: WORKDIR, maxBuffer: 4 * 1024 * 1024 })
  return Number(process.hrtime.bigint() - started) / 1e6
}

const serial = async (commands: readonly string[]): Promise<number> => {
  const started = process.hrtime.bigint()
  for (const command of commands) await timeOne(command)
  return Number(process.hrtime.bigint() - started) / 1e6
}

const concurrent = async (commands: readonly string[]): Promise<number> => {
  const started = process.hrtime.bigint()
  await Promise.all(commands.map((command) => timeOne(command)))
  return Number(process.hrtime.bigint() - started) / 1e6
}

const batch = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => approved[index % approved.length]!)

console.log('\n=== harness behaviour: N calls of the same reads ===')
for (const size of [4, 8, 12]) {
  const commands = batch(size)
  const serialMs = await serial(commands)
  const concurrentMs = await concurrent(commands)
  console.log(
    `  ${String(size).padStart(2)} calls: default (exclusive) ${serialMs.toFixed(0)}ms |`
    + ` concurrent ${concurrentMs.toFixed(0)}ms | speedup ${(serialMs / concurrentMs).toFixed(2)}x`,
  )
}

const chainedMs = await timeOne(batch(12).join(' ; echo "---" ; '))
const serial12 = await serial(batch(12))
const concurrent12 = await concurrent(batch(12))
console.log('\n=== 12 reads, three strategies ===')
console.log(`  one chained bash call (what AGENTS.md now teaches): ${chainedMs.toFixed(0)}ms`)
console.log(`  12 exclusive bash calls (today's default):            ${serial12.toFixed(0)}ms`)
console.log(`  12 concurrent calls (bash_readonly):                  ${concurrent12.toFixed(0)}ms`)
console.log(`  bash_readonly vs default: ${(serial12 / concurrent12).toFixed(2)}x`)
console.log(`  bash_readonly vs chaining: ${(chainedMs / concurrent12).toFixed(2)}x`)