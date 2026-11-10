import { CodeBlock } from '@dshfiles/plugin-ui/components/code-block'
import { StackTrace } from '@dshfiles/plugin-ui/components/stack-trace'
import { StackFrames } from '@dshfiles/plugin-ui/lib/stack-frames'
import type { GalleryDemo } from './types.js'

const PRICING = `export const total = (lines: readonly CartLine[]): number => {
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  const discount = lines.some(line => line.coupon !== undefined) ? applyCoupons({ lines, subtotal, roundTo: 'cent', currency: 'EUR' }) : 0
  return Math.max(0, subtotal - discount)
}
`

const NODE_CRASH = [
  'TypeError: Cannot read properties of undefined (reading unitPrice)',
  '    at total (/srv/shop/src/cart/pricing.ts:29:53)',
  '    at Array.reduce (<anonymous>)',
  '    at checkout (/srv/shop/src/cart/checkout.ts:17:5)',
  '    at Layer.handle (/srv/shop/node_modules/express/lib/router/layer.js:95:5)',
  '    at next (/srv/shop/node_modules/express/lib/router/route.js:149:13)',
  '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
].join('\n')

const PYTHON_CRASH = [
  'Traceback (most recent call last):',
  '  File "/srv/shop/main.py", line 10, in <module>',
  '    charge(card)',
  '  File "/srv/shop/payments.py", line 4, in charge',
  '    raise ValueError("card declined")',
  '  File "/srv/shop/.venv/lib/python3.12/site-packages/stripe/api.py", line 88, in request',
  '    return self._send(payload)',
  'ValueError: card declined',
].join('\n')

const StackTraceDemo = (props: { readonly output: string }) => {
  const report = StackFrames.extract(props.output)
  if (report === undefined) return null
  return <StackTrace frames={report.frames} heading={`${report.errorName}: ${report.message}`} openFile={() => undefined} />
}

export const codeDemos: readonly GalleryDemo[] = [
  {
    id: 'code-block',
    title: 'CodeBlock',
    description: "Highlighted source with the file's own line numbers, marked lines, a wrap toggle, copy and download.",
    source: "import { CodeBlock } from '@dshfiles/plugin-ui/components/code-block'",
    static: true,
    wide: true,
    render: () => <CodeBlock code={PRICING} highlightLines={[29]} path="src/cart/pricing.ts" startLine={27} />,
  },
  {
    id: 'code-block-plain',
    title: 'CodeBlock without a file',
    description: 'A snippet named by its language, with no gutter: shell commands and fenced output.',
    source: "import { CodeBlock } from '@dshfiles/plugin-ui/components/code-block'",
    static: true,
    render: () => (
      <CodeBlock code={'pnpm --dir plugins/@dshfiles/plugin-ui test\npnpm --dir plugins/@dshfiles/ui-styles build'} lang="bash" startLine={false} />
    ),
  },
  {
    id: 'stack-trace-node',
    title: 'StackTrace',
    description: 'A Node crash read from command output: your frames first, library frames one toggle away, each frame opening its file.',
    source: "import { StackTrace } from '@dshfiles/plugin-ui/components/stack-trace'",
    wide: true,
    render: () => <StackTraceDemo output={NODE_CRASH} />,
  },
  {
    id: 'stack-trace-python',
    title: 'StackTrace from a Python traceback',
    description: 'A traceback reversed so the raising frame leads, as in a JavaScript stack.',
    source: "import { StackFrames } from '@dshfiles/plugin-ui/lib/stack-frames'",
    render: () => <StackTraceDemo output={PYTHON_CRASH} />,
  },
]
