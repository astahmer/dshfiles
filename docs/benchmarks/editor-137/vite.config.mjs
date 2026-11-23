import { defineConfig } from 'vite'
import { monacoSingleChunk } from './monaco-vite.ts'
export default defineConfig({
  plugins: monacoSingleChunk(),
  build: {
    target: 'es2024',
    minify: true,
    sourcemap: true,
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    lib: { entry: 'monaco-engine.ts', formats: ['es'], fileName: 'current' },
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
