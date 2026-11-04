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
/**
 * The acceptance boots its own fresh scratch Host twice (cold resume) and proves every feature in one pass; each scenario
 * asserts its own feature's line, so a worker runs it once instead of seven identical times.
 */
let workerScratchRun: Promise<string> | undefined

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
  workerScratchRun ??= runScratchAcceptance()
  // A failed run is not remembered: the next scenario re-proves it and reports its own output.
  workerScratchRun.catch(() => {
    workerScratchRun = undefined
  })
  scratchRuns.set(page, { output: await workerScratchRun })
})

Then('the scratch Host proves {string}', async ({ page }: { page: Page }, feature: string) => {
  const result = scratchRuns.get(page)
  if (result === undefined) throw new Error('The Agent Questions scratch Host journey did not run.')

  // Evidence ids are static kebab-case; the catalog id keeps its dot only in the PASS line.
  await recordAssertion(page, `${feature.replaceAll('.', '-')}-scratch-acceptance`, () => {
    expect(result.output, `The scratch Host acceptance did not report ${feature}.`).toContain(`PASS[${feature}]`)
  })
  await finishJourneyAssertions(page)
})
