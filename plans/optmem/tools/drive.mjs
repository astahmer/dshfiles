import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = '/Users/astahmer/dev/dshfiles'
// Usage: node drive.mjs <out.json> <full|compat> <scenario.json>
// Env: REAL_HOME=1 (recommended: codex route returns empty replies from an isolated DSH_HOME), STOCK=1 (no fork),
//      ACCOUNTS_FILE (default ~/.dsh/plugins/ai-accounts/accounts.json), PROVIDER/MODEL/EFFORT overrides.
const out = process.argv[2]
const compatMode = process.argv[3] === 'compat'
const scenario = JSON.parse(await (await import('node:fs/promises')).readFile(process.argv[4], 'utf8'))
const provider = process.env.PROVIDER ?? 'codex-emialex'
const model = process.env.MODEL ?? 'gpt-6-luna'
const effort = process.env.EFFORT ?? 'low'
const { createScratchProfile, isolatedHostEnvironment, redactHostOutput } = await import(pathToFileURL(resolve(repoRoot, 'tooling/dshx/packages/dshx/dist/project/scratch-profile.js')).href)
const { connectDshPlatformClient } = await import(pathToFileURL(resolve(repoRoot, 'tooling/dshx/packages/dshx/dist/platform/index.js')).href)
const coreRoot = resolve(repoRoot, 'tooling/dsh-core')
const corePackages = ['api-session-controller', 'agent', 'agent-loop', 'session', 'session-persistence', 'session-persistence-jsonl', 'session-format-catalog', 'session-format-v4-to-v5']
const plugin = name => `link:${resolve(repoRoot, 'plugins/@dshfiles', name)}`
const scratch = await createScratchProfile({
  profileName: 'optmem-full',
  sourceProfileRoot: resolve(homedir(), '.dsh/profiles/probe'),
  bundleIds: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...(process.env.STOCK === '1' ? [] : ['@dshfiles/dsh-core-runtime']), '@dshfiles/ai-accounts', '@dshfiles/optmem'],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket'],
  extraDependencies: {
    '@dshfiles/dsh-core-runtime': plugin('dsh-core-runtime'),
    '@dshfiles/ai-accounts': plugin('ai-accounts'),
    '@dshfiles/optmem': plugin('optmem'),
    ...Object.fromEntries((process.env.STOCK === '1' ? [] : corePackages).map(name => [`@deepseek-ai/dsh-${name}`, `link:${resolve(coreRoot, name)}`])),
  },
})
const log = (...parts) => process.stdout.write(`${parts.join(' ')}\n`)
log('scratch home', scratch.home)
await scratch.install()
log('installed')
const overlay = resolve(scratch.home, 'optmem-full.patch.yml')
await writeFile(overlay, `- id: connection
  inject:
    - webRuntime
    - webServer
${process.env.STOCK === '1' ? '' : `- id: dshfiles-core-runtime
  config:
    sessionPersistenceRoot: ${scratch.home}/sessions
`}- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: ${provider}
    model: ${model}
    reasoningEffort: ${effort}
- id: dshfiles-optmem
  config:
    mode: ${compatMode ? 'compat' : 'full'}
    summarizerProvider: ${provider}
    summarizerModel: ${model}
    summarizerEffort: ${effort}
`)
await mkdir(resolve(scratch.home, 'plugins/ai-accounts'), { recursive: true, mode: 0o700 })
await writeFile(resolve(scratch.home, 'plugins/ai-accounts/accounts.json'), await (await import('node:fs/promises')).readFile(process.env.ACCOUNTS_FILE ?? resolve(homedir(), '.dsh/plugins/ai-accounts/accounts.json')), { mode: 0o600 })
const project = resolve(scratch.home, 'project')
await mkdir(project, { recursive: true })
const isolated = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
const realProfileLink = resolve(homedir(), '.dsh/profiles/optmem-full')
const { symlink, rm: remove } = await import('node:fs/promises')
await remove(realProfileLink, { force: true })
await symlink(scratch.profileRoot, realProfileLink)
const { DSH_HOME: _ignored, ...inherited } = process.env
const environment = process.env.REAL_HOME === '1'
  ? { ...inherited, DSHX_BOOT_PROFILE_ROOT: scratch.profileRoot }
  : process.env.FULL_ENV === '1'
  ? { ...process.env, DSH_HOME: isolated.DSH_HOME, DSHX_BOOT_PROFILE_ROOT: isolated.DSHX_BOOT_PROFILE_ROOT }
  : { ...isolated, HOME: homedir() }
let output = ''
const child = spawn('dsh', ['optmem-full', '--patch', overlay, '--port', '0', '--no-open'], { cwd: project, env: environment, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
const collect = chunk => (output = `${output}${chunk.toString('utf8')}`.slice(-400_000))
child.stdout.on('data', collect)
child.stderr.on('data', collect)
const urlPattern = /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/
const evidence = { home: scratch.home, mode: compatMode ? 'compat' : 'full', turns: [] }
const finish = async code => {
  evidence.hostLog = redactHostOutput(output).split('\n').filter(line => /optmem|did not activate|failed to import|dshfiles-core-runtime|error/i.test(line)).slice(-200)
  await writeFile(out, JSON.stringify(evidence, null, 2))
  await writeFile(`${out}.host.log`, redactHostOutput(output))
  try { process.kill(-child.pid, 'SIGTERM') } catch {}
  process.exit(code)
}
try {
  const started = Date.now()
  while (!urlPattern.test(output)) {
    if (Date.now() - started > 90_000 || child.exitCode !== null) throw new Error(`host not ready\n${redactHostOutput(output.slice(-4000))}`)
    await new Promise(done => setTimeout(done, 200))
  }
  await new Promise(done => setTimeout(done, 1500))
  const platform = await connectDshPlatformClient({ url: output.match(urlPattern)[0] })
  const events = async id => (await platform.sessions.history(id)).records.map(record => record.event ?? record)
  const turn = async (id, text) => {
    const before = (await events(id)).filter(event => event.type === 'turn/end').length
    await platform.sessions.prompt(id, text, 'queue')
    const expires = Date.now() + 240_000
    while (Date.now() < expires) {
      const all = await events(id)
      const ends = all.filter(event => event.type === 'turn/end')
      if (ends.length > before) {
        const turnNumber = ends.at(-1).data.turn
        const mine = all.filter(event => event.data?.turn === turnNumber || (event.type === 'tool/result' && event.data?.turn === turnNumber))
        const record = {
          session: id,
          promptBytes: Buffer.byteLength(text),
          prompt: text,
          turn: turnNumber,
          end: ends.at(-1).data.reason,
          overrides: all.filter(event => event.type === 'request/messages-override' && event.data.turn === turnNumber).map(event => event.data),
          assistant: mine.filter(event => event.type === 'assistant/message').map(event => ({ step: event.data.step, usage: event.data.usage, text: event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('').slice(0, 600), tools: event.data.message.content.filter(block => block.type === 'tool-call').map(block => block.name ?? block.toolName) })),
          toolResults: mine.filter(event => event.type === 'tool/result').map(event => JSON.stringify(event.data.message.content).slice(0, 1500)),
          surfaceTypes: all.map(event => event.type).join(','),
        }
        evidence.turns.push(record)
        log(JSON.stringify({ turn: record.turn, end: record.end?.kind, overrides: record.overrides, usage: record.assistant.map(a => a.usage), text: record.assistant.at(-1)?.text.slice(0, 200) }))
        return record
      }
      await new Promise(done => setTimeout(done, 500))
    }
    throw new Error(`turn timed out: ${text}`)
  }
  // scenario: { "conversations": [ { "name": "A", "prompts": ["…", …] }, … ] } — run in order, one session each.
  for (const conversation of scenario.conversations) {
    const created = await platform.sessions.create({ cwd: project })
    for (const prompt of conversation.prompts) await turn(created.sessionId, prompt)
  }
  evidence.sessions = (await platform.sessions.list()).map(session => ({ id: session.sessionId, cwd: session.cwd }))
  await finish(0)
} catch (error) {
  evidence.error = String(error?.stack ?? error)
  log(evidence.error)
  await finish(1)
}
