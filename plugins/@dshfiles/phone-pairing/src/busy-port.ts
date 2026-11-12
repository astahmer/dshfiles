import net from 'node:net'
import { Effect } from 'effect'
import { runCommand } from './commands.ts'

/** Who holds a busy loopback port, and a free one next to it to offer instead. */
export interface BusyPort {
  /** "this DSH" or `name (pid N)`; absent when `lsof` is missing or says nothing. */
  readonly holder?: string
  /** The port belongs to this DSH process: another plugin (Phone access QR) listens there. */
  readonly holderSelf: boolean
  readonly suggestedPort?: number
}

/** `lsof -F pc` prints `p<pid>` then `c<command>` per process; the first listener is enough to name it. */
export const holderOf = (output: string, selfPid: number): Omit<BusyPort, 'suggestedPort'> => {
  const lines = output.split('\n')
  const pid = Number(lines.find(line => line.startsWith('p'))?.slice(1))
  const command = lines
    .find(line => line.startsWith('c'))
    ?.slice(1)
    .trim()
  if (!Number.isInteger(pid) || pid <= 0) return { holderSelf: false }
  if (pid === selfPid) return { holder: 'this DSH', holderSelf: true }
  return { holder: `${command === undefined || command === '' ? 'a program' : command} (pid ${String(pid)})`, holderSelf: false }
}

const free = (port: number): Effect.Effect<boolean> =>
  Effect.callback<boolean>(resume => {
    const probe = net.createServer()
    probe.once('error', () => resume(Effect.succeed(false)))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resume(Effect.succeed(true))))
  })

/** The first free loopback port after `port`, within twenty; bounded so a crowded machine answers quickly. */
export const nextFreePort = Effect.fnUntraced(function* (port: number) {
  for (let candidate = port + 1; candidate <= Math.min(65_535, port + 20); candidate += 1) if (yield* free(candidate)) return candidate
  return undefined
})

/** One span per failed listen: who holds the port (one `lsof`) and the free port to suggest. */
export const inspectBusyPort = Effect.fn('phone pairing busy port')(function* (port: number) {
  const listed = yield* runCommand({ command: 'lsof', args: ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-Fpc'], timeout: '3 seconds' }).pipe(
    Effect.orElseSucceed(() => ''),
  )
  const suggestedPort = yield* nextFreePort(port)
  const holder = holderOf(listed, process.pid)
  yield* Effect.annotateCurrentSpan({ 'phone_pairing.port_holder_self': holder.holderSelf, 'phone_pairing.port_suggested': suggestedPort !== undefined })
  const busy: BusyPort = suggestedPort === undefined ? holder : { ...holder, suggestedPort }
  return busy
})
