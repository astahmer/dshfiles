import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { DshxDiagnostic } from '../diagnostics.js'

export interface ProjectTypecheckResult {
  readonly status: 'passed' | 'failed'
  readonly configFile: string
  readonly diagnostics: readonly DshxDiagnostic[]
}

const compiler = resolve(createRequire(import.meta.url).resolve('typescript/package.json'), '..', 'bin/tsc')

export const typecheckProject = async (root: string): Promise<ProjectTypecheckResult> => {
  const configFile = resolve(root, 'tsconfig.json')
  try {
    await access(configFile)
  } catch {
    return {
      status: 'failed',
      configFile,
      diagnostics: [
        {
          code: 'DSHX4401',
          severity: 'error',
          message: 'No tsconfig.json was found at the plugin project root.',
          file: configFile,
          hint: 'Create a tsconfig.json that includes the Host, Client, shared contracts, and dshx.config.ts.',
        },
      ],
    }
  }
  const result = await new Promise<{ output: string; failed: boolean }>(resolveResult => {
    execFile(
      process.execPath,
      [compiler, '--project', configFile, '--noEmit', '--incremental', 'false', '--composite', 'false', '--pretty', 'false'],
      { cwd: root, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolveResult({ output: [stdout, stderr].filter(Boolean).join('\n'), failed: error !== null })
      },
    )
  })
  const diagnostics: DshxDiagnostic[] = []
  for (const line of result.output.split(/\r?\n/)) {
    const match = /^(?:(.*?)\((\d+),(\d+)\): )?error (TS\d+): (.*)$/.exec(line)
    if (match !== null) {
      diagnostics.push({
        code: match[4] ?? 'DSHX4402',
        severity: 'error',
        file: match[1] ? resolve(root, match[1]) : configFile,
        message: `${match[2] === undefined ? '' : `${match[2]}:${match[3]}: `}${match[5] ?? ''}`,
        hint: 'Fix the TypeScript diagnostic before building the plugin.',
      })
      continue
    }
    const previous = diagnostics.at(-1)
    if (previous !== undefined && line.trim().length > 0) diagnostics[diagnostics.length - 1] = { ...previous, message: `${previous.message}\n${line}` }
  }
  if (result.failed && diagnostics.length === 0)
    diagnostics.push({
      code: 'DSHX4402',
      severity: 'error',
      file: configFile,
      message: result.output.trim() || 'TypeScript compiler failed without diagnostics.',
      hint: 'Check the compiler installation and project configuration.',
    })
  return { status: result.failed || diagnostics.length > 0 ? 'failed' : 'passed', configFile, diagnostics }
}
