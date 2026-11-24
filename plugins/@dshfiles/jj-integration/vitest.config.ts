import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const kit = (path: string): string => fileURLToPath(new URL(`../plugin-ui/node_modules/${path}`, import.meta.url))

export default defineConfig({
  test: {
    // This suite drives real `jj` processes: a single test can add workspaces,
    // commit, submit and run a full integration twice. The 5s default is a
    // timeout, not a failure signal, and it fires under parallel load.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // The `*.client.test.tsx` render tests borrow the UI kit's react-dom and Testing Library (the same pnpm
    // react@18.3.1 instance), as thread-sidebar borrows react-dom/server, instead of adding dependencies here: a
    // non-frozen install rewrites most of the lockfile. tsconfig.json maps the Testing Library types the same way.
    alias: {
      '@testing-library/react': kit('@testing-library/react'),
      'react-dom': kit('react-dom'),
    },
  },
})
