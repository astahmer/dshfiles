import { describe, expect, test } from 'vitest'
import { StackFrames } from './stack-frames.js'

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
      { id: 'frame-0', receiver: 'PaymentClient', name: 'charge', file: 'client.ts', line: 42, status: 'changed' },
      { id: 'frame-1', name: 'checkout', file: 'checkout.ts', line: 17, status: 'changed' },
      { id: 'frame-2', name: '<anonymous>', file: 'server.ts', line: 9, status: 'changed' },
      { id: 'frame-3', receiver: 'Layer', name: 'handle', file: 'layer.js', line: 95, status: 'existing' },
      { id: 'frame-4', receiver: 'process', name: 'processTicksAndRejections', file: 'task_queues', line: 95, status: 'existing' },
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
