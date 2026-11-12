import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The page dshx setup serves: plain React (Vite's own JSX transform), the plugin-ui kit and the generated theme.
// dshx's build copies dist/ into its own dist/setup-ui; nothing here reads data at build time.
export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { dedupe: ['react', 'react-dom'] },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, reportCompressedSize: true, target: 'es2022' },
})
