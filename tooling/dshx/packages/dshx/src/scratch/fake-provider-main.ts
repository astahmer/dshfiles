import { writeFile } from 'node:fs/promises'
import { startFakeCommandCode } from './fake-command-code.js'

/** `node fake-provider-main.js <ready-file>`: serve the fake Command Code provider until SIGTERM. */
const readyFile = process.argv[2]
if (readyFile === undefined) throw new Error('Usage: fake-provider-main.js <ready-file>')
const fake = await startFakeCommandCode()
await writeFile(readyFile, `${fake.baseUrl}\n`, { mode: 0o600 })
const stop = (): void => {
  void fake.close().finally(() => process.exit(0))
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
