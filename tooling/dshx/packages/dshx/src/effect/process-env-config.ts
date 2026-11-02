import { ConfigProvider, Layer } from 'effect'

/**
 * `Config` reads `process.env` as it is at each lookup. Effect's default provider merges `import.meta.env` over it,
 * and under Vitest that is a startup snapshot: a test that points `DSH_HOME` at a scratch folder would still read the
 * shell's real home.
 */
export const processEnvConfig: Layer.Layer<never> = ConfigProvider.layer(
  ConfigProvider.make(path => ConfigProvider.fromEnvRecord(globalThis.process.env).load(path)),
)
