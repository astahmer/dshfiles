import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { redactHostOutput } from '../scratch-profile.js'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const pluginRoot = resolve(workspaceRoot, 'plugins/@dshfiles/tool-search')
const scratchRuns = new WeakMap<Page, { readonly output: string }>()

const runScratchAcceptance = (): Promise<string> =>
  new Promise((resolveOutput, reject) => {
    const childProcess = spawn('pnpm', ['--dir', pluginRoot, 'verify:scratch'], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = (chunk: Buffer): void => {
      output = `${output}${chunk.toString('utf8')}`.slice(-32_768)
    }
    childProcess.stdout.on('data', collect)
    childProcess.stderr.on('data', collect)
    childProcess.once('error', error => reject(new Error(`Could not start Tool Search scratch acceptance: ${error.message}`)))
    childProcess.once('close', code => {
      const safeOutput = redactHostOutput(output)
      if (code !== 0) {
        reject(new Error(`Tool Search scratch acceptance exited with code ${String(code)}:\n${safeOutput}`))
        return
      }
      resolveOutput(safeOutput)
    })
  })

When('the Tool Search scratch Host journey is run', async ({ page }: { page: Page }) => {
  scratchRuns.set(page, { output: await runScratchAcceptance() })
})

Then('progressive discovery passes its real AgentLoop acceptance journey', async ({ page }: { page: Page }) => {
  const result = scratchRuns.get(page)
  if (result === undefined) throw new Error('The Tool Search scratch Host journey did not run.')

  await recordAssertion(page, 'tool-search-scratch-agent-loop', () => {
    expect(result.output).toContain('PASS: Tool Search activated in an isolated scratch DSH Host.')
    expect(result.output).toContain('PASS: progressive tool discovery passed the real AgentLoop acceptance journey.')
  })
  await finishJourneyAssertions(page)
})
