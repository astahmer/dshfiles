import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { WindowsCommandLine } from './windows-command-line.js'

/** Arguments that plain double quoting would let cmd.exe expand, split or run. */
const TRICKY = ['plain', 'two words', '%PATH%', '!PATH!', 'a&echo injected', 'pipe|more', '"quoted"', 'trailing\\', 'back\\"slash', '^caret', '']

describe('WindowsCommandLine', () => {
  it('runs only batch files through cmd.exe, and only on Windows', () => {
    expect(WindowsCommandLine.needsShell('C:\\tools\\pnpm.cmd', 'win32')).toBe(true)
    expect(WindowsCommandLine.needsShell('C:\\tools\\build.BAT', 'win32')).toBe(true)
    expect(WindowsCommandLine.needsShell('C:\\tools\\node.exe', 'win32')).toBe(false)
    expect(WindowsCommandLine.needsShell('/usr/bin/pnpm.cmd', 'linux')).toBe(false)
  })

  it('caret-escapes every metacharacter twice, quotes included, so neither cmd.exe pass expands anything', () => {
    expect(WindowsCommandLine.forBatchFile('C:\\Program Files\\nodejs\\npm.cmd', ['%PATH%', 'a&b'])).toBe(
      'C:\\Program^ Files\\nodejs\\npm.cmd ^^^"^^^%PATH^^^%^^^" ^^^"a^^^&b^^^"',
    )
  })

  const root = process.platform === 'win32' ? mkdtempSync(join(tmpdir(), 'windows-command-line-')) : ''
  afterAll(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true })
  })

  // A batch file forwarding `%*` to node, as npm's and pnpm's shims do, must hand node every argument unchanged.
  it.runIf(process.platform === 'win32').each([
    ['a plain batch file', ['tools', 'echo-args.cmd']],
    ['an npm-style shim', ['node_modules', '.bin', 'echo-args.cmd']],
  ])('passes each argument through %s literally', (_label, segments) => {
    const script = join(root, 'print-args.cjs')
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n')
    const shim = join(root, ...segments)
    mkdirSync(join(shim, '..'), { recursive: true })
    writeFileSync(shim, `@node "${script}" %*\r\n`)
    const result = spawnSync(WindowsCommandLine.forBatchFile(shim, TRICKY), [], { shell: true, encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(TRICKY)
  })
})
