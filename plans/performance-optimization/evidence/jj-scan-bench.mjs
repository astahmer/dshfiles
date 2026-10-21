import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { basename } from 'node:path'

const registry = JSON.parse(readFileSync('/Users/astahmer/.dsh/storages/workspace.json', 'utf8'))
const paths = Object.values(registry.tables?.workspaces ?? {})
  .map(row => row?.path)
  .filter(value => typeof value === 'string')

const REVISION_TEMPLATE = 'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ conflict ++ "\\t" ++ description.first_line() ++ "\\n"'
const MAX_BEHIND = 1000
const bookmark = 'main'

let jjCalls = 0
let jjMs = 0
const run = args =>
  new Promise(done => {
    const started = performance.now()
    execFile('jj', args, { maxBuffer: 64 * 1024 * 1024 }, () => {
      jjCalls += 1
      jjMs += performance.now() - started
      done()
    })
  })

const mapBounded = async (items, limit, task) => {
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++
      await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

const storeRootOf = workspaceRoot => {
  const marker = join(workspaceRoot, '.jj', 'repo')
  if (!existsSync(marker)) return undefined
  if (statSync(marker).isDirectory()) return workspaceRoot
  const store = resolve(dirname(marker), readFileSync(marker, 'utf8').trim())
  return dirname(dirname(store))
}

const present = paths.filter(path => existsSync(path))
console.log(`registered=${paths.length} present=${present.length}`)

const locateStart = performance.now()
const locations = []
await mapBounded(present, 8, async path => {
  const stdout = await new Promise(done =>
    execFile('jj', ['--ignore-working-copy', 'root'], { cwd: path }, (error, out) => {
      jjCalls += 1
      done(error ? undefined : out.trim())
    }),
  )
  if (stdout === undefined) return
  const repoRoot = storeRootOf(stdout) ?? stdout
  locations.push({ repoRoot })
})
const locateMs = performance.now() - locateStart

const repos = [...new Set(locations.map(location => location.repoRoot))]
console.log(`locate: ${Math.round(locateMs)}ms repos=${repos.length} calls=${jjCalls}`)

const scanStart = performance.now()
let threadCount = 0
for (const repoRoot of repos) {
  const names = await new Promise(done =>
    execFile('jj', ['--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\n"'], { cwd: repoRoot }, (error, out) => {
      jjCalls += 1
      done(error ? [] : out.split('\n').filter(Boolean))
    }),
  )
  threadCount += names.length
  await mapBounded(names, 8, async name => {
    const present = existsSync(join(dirname(repoRoot), `${basename(repoRoot)}-threads`, name, '.jj'))
    if (!present && !name.startsWith('thread-')) return
    await Promise.all([
      run(['--ignore-working-copy', 'log', '--no-graph', '-r', `(::${name}@ ~ ::bookmarks(main)) ~ empty()`, '-T', REVISION_TEMPLATE]),
      run([
        '--ignore-working-copy',
        'log',
        '--no-graph',
        '-n',
        String(MAX_BEHIND + 1),
        '-r',
        `(::bookmarks(main) ~ ::${name}@) ~ empty()`,
        '-T',
        REVISION_TEMPLATE,
      ]),
    ])
  })
}
const scanMs = performance.now() - scanStart
console.log(`thread scan: ${Math.round(scanMs)}ms workspaces=${threadCount} totalJjCalls=${jjCalls} totalJjMs=${Math.round(jjMs)}`)
console.log(`TOTAL jj work: ${Math.round(locateMs + scanMs)}ms`)
