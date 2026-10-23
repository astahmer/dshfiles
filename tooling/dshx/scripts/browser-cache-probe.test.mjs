import assert from 'node:assert/strict'
import test from 'node:test'
import { probeBrowserCache } from './browser-cache-probe.mjs'

test('Chromium HTTP routing disables warm asset caching even for an unrelated route', { timeout: 30_000 }, async () => {
  const report = await probeBrowserCache()
  for (const scenario of report.scenarios) {
    assert.equal(scenario.samples.length, 3)
    const [cold, ...warm] = scenario.samples
    assert.equal(cold.assetServerHits, report.assetCount)
    assert.equal(cold.assetRequests, report.assetCount)
    assert.ok(cold.assetTransferBytes > 0)
    for (const sample of warm) {
      assert.equal(sample.assetRequests, report.assetCount)
      if (scenario.mode !== 'route-free-controlled') {
        assert.equal(sample.assetServerHits, report.assetCount)
        assert.equal(sample.cachedAssets, 0)
        assert.ok(sample.assetTransferBytes > 0)
        continue
      }
      assert.equal(sample.assetServerHits, 0)
      assert.equal(sample.cachedAssets, report.assetCount)
      assert.equal(sample.assetTransferBytes, 0)
    }
  }
})
