import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The page dshx setup serves: plain React (Vite's own JSX transform), the plugin-ui kit and the generated theme.
// dshx's build copies dist/ into its own dist/setup-ui; nothing here reads data at build time.
export default defineConfig({
  base: './',
  plugins: [tailwindcss()],
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    dedupe: ['react', 'react-dom'],
    // turbo builds this page before dshx (dshx copies it into its dist), so dshx's dist/client does not exist yet. The kit's
    // Kbd reads the shortcut grammar from @dshfiles/dshx/client; bundle that entry from source instead. Its own imports
    // reach built create-dshx entries, so turbo.json orders create-dshx#build first.
    alias: [{ find: /^@dshfiles\/dshx\/client$/u, replacement: fileURLToPath(new URL('../dshx/src/client/index.ts', import.meta.url)) }],
  },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, reportCompressedSize: true, target: 'es2022' },
})
