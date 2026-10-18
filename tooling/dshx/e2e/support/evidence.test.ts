import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { after, it } from 'node:test'
import { EVIDENCE_POLICY, type EvidenceManifest, persistEvidenceRun } from './evidence.ts'

const temporaryRoots: string[] = []

after(async () => {
  await Promise.all(temporaryRoots.map(path => rm(path, { recursive: true, force: true })))
})

const newRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-evidence-'))
  temporaryRoots.push(root)
  return root
}

const manifest = (runId: string, outcome: EvidenceManifest['outcome'] = 'failed'): EvidenceManifest => ({
  schemaVersion: 1,
  runId,
  startedAt: '2026-10-05T12:00:00.000Z',
  completedAt: '2026-10-05T12:00:01.000Z',
  outcome,
  source: { revision: 'jj:example', runUrl: null },
  browser: {
    engine: 'chromium',
    viewport: { width: 1280, height: 800 },
    actionIdentity: 'ordered Playwright test steps',
    frameIdentity: 'test-scoped; trace retains internal frame order',
    frameAlignment: 'trace-only; no synthetic action-to-frame mapping',
  },
  tests: [
    {
      key: 'test-key',
      titlePath: ['boot smoke'],
      file: 'e2e/features/client-boot.feature',
      line: 4,
      expectedStatus: 'passed',
      outcome,
      durationMs: 1_000,
      retry: 0,
      steps: [],
      attachments: [],
    },
  ],
})

it('stores ordered screenshots, traces and failure diagnostics with stable checksums', async () => {
  const root = await newRoot()
  const evidence = await persistEvidenceRun(root, manifest('11111111-1111-4111-8111-111111111111'), [
    { testKey: 'test-key', name: 'failure screenshot', contentType: 'image/png', body: Buffer.from('png-data') },
    { testKey: 'test-key', name: 'playwright trace', contentType: 'application/zip', body: Buffer.from('trace-data') },
    { testKey: 'test-key', name: 'browser diagnostics', contentType: 'application/json', body: Buffer.from('{"events":[]}') },
  ])

  const references = evidence.manifest.tests[0]?.attachments ?? []
  assert.deepEqual(
    references.map(item => item.sequence),
    [1, 2, 3],
  )
  assert.deepEqual(
    references.map(item => item.kind),
    ['screenshot', 'trace', 'diagnostics'],
  )
  assert.equal(await readFile(join(evidence.directory, references[0]?.file ?? ''), 'utf8'), 'png-data')
  assert.equal(await readFile(join(evidence.directory, references[1]?.file ?? ''), 'utf8'), 'trace-data')
  assert.equal(await readFile(join(evidence.directory, references[2]?.file ?? ''), 'utf8'), '{"events":[]}')
  assert.match(references[2]?.file ?? '', /\.json$/)
  assert.match(references[0]?.sha256 ?? '', /^[0-9a-f]{64}$/)
})

it('skips oversized attachments and prunes older runs to the configured retention bound', async () => {
  const root = await newRoot()
  const policy = {
    ...EVIDENCE_POLICY,
    maxRuns: 2,
    maxTotalBytes: 64 * 1024,
    maxAttachmentBytes: 3,
    maxRunAttachmentBytes: 64,
    maxManifestBytes: 8 * 1024,
  }
  const ids = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']
  const paths: string[] = []

  for (const runId of ids) {
    const evidence = await persistEvidenceRun(
      root,
      manifest(runId, 'cancelled'),
      [{ testKey: 'test-key', name: 'oversized screenshot', contentType: 'image/png', body: Buffer.from('large') }],
      policy,
    )
    paths.push(evidence.directory)
    assert.deepEqual(evidence.manifest.tests[0]?.attachments, [])
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10))
  }

  const retained = (await readdir(root)).filter(entry => /^\d+-[0-9a-f-]{36}$/i.test(entry))
  assert.equal(retained.length, 2)
  assert.equal(retained.includes(basename(paths[0] ?? '')), false)
  assert.equal(retained.includes(basename(paths[1] ?? '')), true)
  assert.equal(retained.includes(basename(paths[2] ?? '')), true)
})
