import { build } from 'vite'
await build({
  configFile: false,
  logLevel: 'warn',
  build: { target: 'es2024', outDir: 'ts-dist', minify: true, lib: { entry: 'ts-entry.mjs', formats: ['es'], fileName: 'typescript' } },
})
