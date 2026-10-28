import { chmod, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'

/** Cancellation-only CLI: no token files, networking, provider approval or successful connection proof. */
export const seedCancellationOnlyCodexCli = async (homeRoot: string): Promise<{ readonly hostPathPrefix: string }> => {
  const home = await realpath(homeRoot)
  const underTemp = relative(await realpath(tmpdir()), home)
  if (underTemp === '' || underTemp.startsWith('..') || isAbsolute(underTemp)) throw new Error('Fake Codex CLI requires an isolated temporary home.')
  const directory = join(home, 'account-fixture-bin')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const executable = join(directory, 'codex')
  const marker = join(home, 'fake-codex-cancellation')
  await writeFile(
    executable,
    `#!${process.execPath}
import { writeFileSync } from 'node:fs'
// External CLI fixture pins the command rather than importing plugin internals.
if (JSON.stringify(process.argv.slice(2)) !== ${JSON.stringify(JSON.stringify(['-c', 'cli_auth_credentials_store="file"', 'login', '--device-auth']))}) process.exit(2)
writeFileSync(${JSON.stringify(`${marker}.pid`)}, String(process.pid), { mode: 0o600 })
process.on('SIGTERM', () => {
  writeFileSync(${JSON.stringify(`${marker}.stopped`)}, String(process.pid), { mode: 0o600 })
  process.exit(0)
})
console.log('1. Open this URL in your browser:\\n   https://auth.openai.com/codex/device\\n2. Enter this one-time code\\n   ABCD-1234\\n')
setInterval(() => {}, 1000)
`,
    { flag: 'wx', mode: 0o700 },
  )
  await chmod(executable, 0o700)
  return { hostPathPrefix: directory }
}
