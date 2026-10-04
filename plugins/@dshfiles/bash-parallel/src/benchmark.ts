import { classifyBashCommand } from '/Users/astahmer/dev/dshfiles/plugins/@dshfiles/bash-parallel/src/classify.ts'

const readCommands = [
  'ls -la src',
  'cat package.json',
  'git status',
  'git log --oneline',
  'wc -l *.ts',
  'git diff',
  'ast-outline src/index.ts',
  'cat README.md',
  'git show HEAD',
  'git ls-files',
  'cat tsconfig.json',
  'du -sh node_modules',
]

const runSerial = async (commands) => {
  const start = process.hrtime.bigint()
  for (const command of commands) {
    await new Promise((resolve) => {
      const child = Bun
      void child
      resolve()
    })
  }
  return Number(process.hrtime.bigint() - start) / 1e6
}

void runSerial

// Real subprocess timing: the only measurement that reflects the harness.
const spawnOne = (command) =>
  new Promise((resolve) => {
    const started = process.hrtime.bigint()
    const child = process.getBuiltinModule('node:child_process').exec(
      command,
      { maxBuffer: 1024 * 1024 },
      () => resolve(Number(process.hrtime.bigint() - started) / 1e6),
    )
    void child
  })

const serial = async (commands) => {
  const started = process.hrtime.bigint()
  for (const command of commands) await spawnOne(command)
  return Number(process.hrtime.bigint() - started) / 1e6
}

const parallel = async (commands) => {
  const started = process.hrtime.bigint()
  await Promise.all(commands.map((command) => spawnOne(command)))
  return Number(process.hrtime.bigint() - started) / 1e6
}

const classified = readCommands.filter((command) => classifyBashCommand(command).parallel)
console.log(`commands the classifier approves: ${classified.length}/${readCommands.length}`)
const rejected = readCommands.filter((command) => !classifyBashCommand(command).parallel)
for (const command of rejected) console.log(`  rejected: ${command} -> ${classifyBashCommand(command).reason}`)

const WORKDIR = '/Users/astahmer/dev/dshfiles'
const withCwd = classified.map((command) => `cd ${WORKDIR} && ${command}`)

for (const size of [4, 8, 12]) {
  const batch = Array.from({ length: size }, (_, index) => withCwd[index % withCwd.length]!)
  const serialMs = await serial(batch)
  const parallelMs = await parallel(batch)
  console.log(
    `\n${String(size).padStart(2)} commands: serial ${serialMs.toFixed(0)}ms | concurrent ${parallelMs.toFixed(0)}ms | speedup ${(serialMs / parallelMs).toFixed(2)}x`,
  )
}

// What the default harness would do with the same work: keep it in one bash call.
const batched = withCwd.slice(0, 12).join(' ; echo "---" ; ')
const batchedMs = await spawnOne(`cd ${WORKDIR} && ${batched}`)
console.log(`\none chained bash call with all 12: ${batchedMs.toFixed(0)}ms`)

const serialMs12 = await serial(withCwd.slice(0, 12))
const concurrentMs12 = await parallel(withCwd.slice(0, 12))
console.log(`12 as separate serial calls    : ${serialMs12.toFixed(0)}ms`)
console.log(`12 as separate concurrent calls : ${concurrentMs12.toFixed(0)}ms`)