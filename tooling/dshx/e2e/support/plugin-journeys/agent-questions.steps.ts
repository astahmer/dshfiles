import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'
import { Then, When } from '../bdd.js'
import { finishJourneyAssertions, recordAssertion } from '../steps.js'
import { redactHostOutput } from '../scratch-profile.js'

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const pluginRoot = resolve(workspaceRoot, 'plugins/@dshfiles/agent-questions')
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
    childProcess.once('error', error => reject(new Error(`Could not start Agent Questions scratch acceptance: ${error.message}`)))
    childProcess.once('close', code => {
      const safeOutput = redactHostOutput(output)
      if (code !== 0) {
        reject(new Error(`Agent Questions scratch acceptance exited with code ${String(code)}:\n${safeOutput}`))
        return
      }
      resolveOutput(safeOutput)
    })
  })

When('the Agent Questions scratch Host tool journey is run', async ({ page }: { page: Page }) => {
  scratchRuns.set(page, { output: await runScratchAcceptance() })
})

Then('the public question and feedback tools pass their real Host acceptance cases', async ({ page }: { page: Page }) => {
  const result = scratchRuns.get(page)
  if (result === undefined) throw new Error('The Agent Questions scratch Host journey did not run.')

  await recordAssertion(page, 'agent-questions-tool-journey-and-boundaries', () => {
    expect(result.output).toContain(
      'PASS: Question inbox (all Sessions and one Session, root-only scope), child-question authorization, native root-only authorization and continued-answer guard, expiry/defer, feedback, and batch-boundary tools passed on a fresh DSH scratch Host.',
    )
    expect(result.output).toContain(
      'PASS: Pending question and feedback cold-resumed; the parent reattached, answered, and resolved the pending feedback after restart.',
    )
  })
  await finishJourneyAssertions(page)
})
