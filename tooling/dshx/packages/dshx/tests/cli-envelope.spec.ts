import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CliOutput } from '../src/cli/common.js'

const emitted = (envelope: Parameters<typeof CliOutput.emitEnvelope>[1]): string => {
  const stream = new PassThrough()
  CliOutput.emitEnvelope(stream, envelope)
  return String(stream.read())
}

describe('CLI --json envelope', () => {
  it('prints schemaVersion, command, ok and data in that order', () => {
    expect(emitted({ command: 'checkout sync', ok: true, data: { status: 'up-to-date' } })).toBe(
      `${JSON.stringify({ schemaVersion: 1, command: 'checkout sync', ok: true, data: { status: 'up-to-date' } }, null, 2)}\n`,
    )
  })

  it('prints the error in place of data when the command could not run', () => {
    expect(JSON.parse(emitted({ command: 'dev up', ok: false, error: { code: 'usage', message: 'bad flag', hint: 'Run dshx dev --help.' } }))).toEqual({
      schemaVersion: 1,
      command: 'dev up',
      ok: false,
      error: { code: 'usage', message: 'bad flag', hint: 'Run dshx dev --help.' },
    })
  })
})
