import { describe, expect, test } from 'vitest'
import { StackFrames } from '../src/lib/stack-frames.js'

describe('StackFrames.parse', () => {
  test('reads a V8 stack innermost first and marks library frames', () => {
    const frames = StackFrames.parse(
      [
        'CardDeclined: card declined 4012',
        '    at PaymentClient.charge (/srv/app/src/payments/client.ts:42:11)',
        '    at async checkout (/srv/app/src/checkout.ts:17:5)',
        '    at /srv/app/src/server.ts:9:3',
        '    at Layer.handle (/srv/app/node_modules/express/lib/router/layer.js:95:5)',
        '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
      ].join('\n'),
    )
    expect(frames).toEqual([
      {
        id: 'frame-0',
        receiver: 'PaymentClient',
        name: 'charge',
        file: 'client.ts',
        path: '/srv/app/src/payments/client.ts',
        line: 42,
        column: 11,
        status: 'changed',
      },
      { id: 'frame-1', name: 'checkout', file: 'checkout.ts', path: '/srv/app/src/checkout.ts', line: 17, column: 5, status: 'changed' },
      { id: 'frame-2', name: '<anonymous>', file: 'server.ts', path: '/srv/app/src/server.ts', line: 9, column: 3, status: 'changed' },
      {
        id: 'frame-3',
        receiver: 'Layer',
        name: 'handle',
        file: 'layer.js',
        path: '/srv/app/node_modules/express/lib/router/layer.js',
        line: 95,
        column: 5,
        status: 'existing',
      },
      {
        id: 'frame-4',
        receiver: 'process',
        name: 'processTicksAndRejections',
        file: 'task_queues',
        path: 'node:internal/process/task_queues',
        line: 95,
        column: 5,
        status: 'existing',
      },
    ])
  })

  test('reverses a Python traceback so the raising frame leads', () => {
    const frames = StackFrames.parse(
      [
        'Traceback (most recent call last):',
        '  File "/srv/app/main.py", line 10, in handle',
        '    charge(card)',
        '  File "/srv/app/payments.py", line 4, in charge',
        '    raise CardDeclined()',
        'CardDeclined',
      ].join('\n'),
    )
    expect(frames.map(frame => [frame.name, frame.file, frame.line])).toEqual([
      ['charge', 'payments.py', 4],
      ['handle', 'main.py', 10],
    ])
  })

  test('reads JVM and Gecko frames', () => {
    const jvm = StackFrames.parse(
      'java.lang.IllegalStateException: boom\n\tat com.shop.Payments.charge(Payments.java:31)\n\tat java.base/java.lang.Thread.run(Thread.java:833)',
    )
    expect(jvm.map(frame => [frame.receiver, frame.name, frame.file, frame.line, frame.status])).toEqual([
      ['com.shop.Payments', 'charge', 'Payments.java', 31, 'changed'],
      ['java.base/java.lang.Thread', 'run', 'Thread.java', 833, 'existing'],
    ])
    expect(StackFrames.parse('charge@https://shop.test/app.js:12:4').map(frame => [frame.name, frame.file, frame.line])).toEqual([['charge', 'app.js', 12]])
  })

  test('gives no frames for text it cannot read', () => {
    expect(StackFrames.parse('something went wrong')).toEqual([])
  })
})

describe('StackFrames.extract', () => {
  test('finds a Node crash in command output with its header and multi-line message', () => {
    const report = StackFrames.extract(
      [
        '$ node server.js',
        '/srv/app/src/server.js:9',
        "  throw new TypeError('price is not a number')",
        '  ^',
        '',
        '\u001B[31mTypeError: price is not a number\u001B[39m',
        '  received: undefined',
        '    at total (/srv/app/src/cart.js:12:9)',
        '    at Object.<anonymous> (/srv/app/src/server.js:9:3)',
        '    at Module._compile (node:internal/modules/cjs/loader:1554:14)',
        '',
        'Node.js v22.23.3',
        '[exit code: 1]',
      ].join('\n'),
    )
    expect(report?.errorName).toBe('TypeError')
    expect(report?.message).toBe('price is not a number\nreceived: undefined')
    expect(report?.frames.map(frame => [frame.name, frame.path, frame.line, frame.status])).toEqual([
      ['total', '/srv/app/src/cart.js', 12, 'changed'],
      ['<anonymous>', '/srv/app/src/server.js', 9, 'changed'],
      ['_compile', 'node:internal/modules/cjs/loader', 1554, 'existing'],
    ])
    expect(report?.raw.split('\n')[0]).toBe('TypeError: price is not a number')
    expect(report?.raw.split('\n').at(-1)).toContain('Module._compile')
  })

  test('reads a Python traceback with its source lines and closing message', () => {
    const report = StackFrames.extract(
      [
        'Traceback (most recent call last):',
        '  File "/srv/app/main.py", line 10, in <module>',
        '    charge(card)',
        '    ~~~~~~^^^^^^',
        '  File "/srv/app/payments.py", line 4, in charge',
        '    raise ValueError("card declined")',
        'ValueError: card declined',
      ].join('\n'),
    )
    expect(report?.errorName).toBe('ValueError')
    expect(report?.message).toBe('card declined')
    expect(report?.frames.map(frame => [frame.name, frame.line])).toEqual([
      ['charge', 4],
      ['<module>', 10],
    ])
    expect(report?.raw.startsWith('Traceback')).toBe(true)
  })

  test('reads past V8 frames with no file position', () => {
    const report = StackFrames.extract(
      [
        'TypeError: Cannot read properties of undefined',
        '    at total (/srv/app/src/cart.js:12:9)',
        '    at Array.reduce (<anonymous>)',
        '    at checkout (/srv/app/src/checkout.js:17:5)',
        '    at new Promise (<anonymous>)',
        '    at Layer.handle (/srv/app/node_modules/express/lib/router/layer.js:95:5)',
      ].join('\n'),
    )
    expect(report?.frames.map(frame => frame.name)).toEqual(['total', 'checkout', 'handle'])
  })

  test('stops a JVM trace at its cause chain', () => {
    const report = StackFrames.extract(
      [
        'Exception in thread "main" java.lang.IllegalStateException: boom',
        '\tat com.shop.Payments.charge(Payments.java:31)',
        '\tat com.shop.Main.main(Main.java:5)',
        'Caused by: java.io.IOException: closed',
        '\tat com.shop.Io.read(Io.java:2)',
      ].join('\n'),
    )
    expect(report?.errorName).toBe('java.lang.IllegalStateException')
    expect(report?.frames.map(frame => frame.name)).toEqual(['charge', 'main'])
  })

  test('ignores output with no trace or one stray frame-like line', () => {
    expect(StackFrames.extract('All good\n3 files changed')).toBeUndefined()
    expect(StackFrames.extract('listening at http://localhost:3000')).toBeUndefined()
    expect(StackFrames.extract('see:\n    at helper (docs/a.md:3)')).toBeUndefined()
  })

  test('ignores grep -c and scoped-package paths that look like Gecko frames', () => {
    expect(
      StackFrames.extract(
        ['plugins/@dshfiles/hmr-gate/src/host.ts:0', 'plugins/@dshfiles/hmr-gate/src/gate.ts:0', 'plugins/@dshfiles/hmr-gate/tests/gate.test.ts:0'].join('\n'),
      ),
    ).toBeUndefined()
    expect(
      StackFrames.extract(['node_modules/@effect/vitest/dist/index.js:2', 'node_modules/@effect/platform/dist/http.js:14', 'git@github.com:22'].join('\n')),
    ).toBeUndefined()
  })

  test('keeps a real Node crash whose paths hold a scoped package', () => {
    const report = StackFrames.extract(
      [
        'Error: Pack plugin pulls-review is not in the onboarding feature catalog',
        '    at description (/repo/plugins/@dshfiles/onboarding/scripts/pack-docs.ts:31:11)',
        '    at renderPack (/repo/plugins/@dshfiles/onboarding/scripts/pack-docs.ts:91:3)',
        '    at Array.map (<anonymous>)',
        '    at pages (/repo/plugins/@dshfiles/onboarding/scripts/pack-docs.ts:129:5)',
      ].join('\n'),
    )
    expect(report?.frames.map(frame => [frame.name, frame.file, frame.line])).toEqual([
      ['description', 'pack-docs.ts', 31],
      ['renderPack', 'pack-docs.ts', 91],
      ['pages', 'pack-docs.ts', 129],
    ])
  })
})
