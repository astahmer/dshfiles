import type { Socket } from 'node:net'

/**
 * Resolves on `close` alone. A server-side teardown resets the connection on macOS (a FIN on Linux), and
 * `events.once(socket, 'close')` rejects on that `error` before `close` arrives.
 */
export const socketClosed = (socket: Socket, timeoutMs = 2_000): Promise<void> =>
  new Promise((resolveClose, rejectClose) => {
    socket.on('error', () => undefined)
    const timer = setTimeout(() => rejectClose(new Error(`socket did not close within ${String(timeoutMs)} ms`)), timeoutMs)
    socket.once('close', () => {
      clearTimeout(timer)
      resolveClose()
    })
  })
