import { describe, expect, it } from 'vitest'
import { JjArgs } from './jj-args.ts'
import { redactJjStderr } from './stderr-redaction.ts'

describe('jj argument redaction', () => {
  it('drops every value-flag value and keeps flag names, verbs and positionals', () => {
    expect(JjArgs.redact(['describe', '-m', 'private message', '-r', '@-', '--template=secret', '--repository', '/tmp/repo', 'positional'])).toEqual([
      'describe',
      '-m',
      '<redacted>',
      '-r',
      '<redacted>',
      '--template=<redacted>',
      '--repository',
      '<redacted>',
      'positional',
    ])
  })

  it('matches the dshx command attributes for value flags', () => {
    expect(JjArgs.attributes(['--at-op', 'abc123', 'op', 'log', '-T', 'id', '/tmp/x'])).toEqual({
      'process.executable.name': 'jj',
      'process.command.verb': 'op log',
      'process.command.flags': ['--at-op', '-T'],
      'process.command.arg_count': 7,
    })
  })
})

describe('jj stderr redaction', () => {
  it('removes URL credentials, authorization values and secret assignments but keeps the diagnosis', () => {
    const stderr = [
      "fatal: unable to access 'https://alice:s3cr3t@github.com/o/r.git/': 403",
      'Authorization: Bearer ghp_abcdefghijklmnop',
      'token=abc123456789 password: hunter22',
    ].join('\n')
    const redacted = redactJjStderr(stderr)
    expect(redacted).toBe(
      ["fatal: unable to access 'https://<redacted>@github.com/o/r.git/': 403", 'Authorization: <redacted>', 'token=<redacted> password: <redacted>'].join(
        '\n',
      ),
    )
  })
})
