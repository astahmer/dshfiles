// Test-only: react-dom comes from the UI kit through vitest.config.ts, without its @types package.
declare module 'react-dom/server' {
  export const renderToString: (element: import('react').ReactElement) => string
}
