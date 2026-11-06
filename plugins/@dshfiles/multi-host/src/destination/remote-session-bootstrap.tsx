import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { Schema } from 'effect'
import { useRef } from 'react'
import type { MultiHostClient } from './queries.js'
import { remoteSessionBootstrapMachine, type BootstrapFailure } from './remote-session-bootstrap-machine.js'

const bootstrapFailureSchema = Schema.Struct({ message: Schema.String, code: Schema.optional(Schema.String) })

interface RemoteSessionBootstrapProps {
  readonly api: MultiHostClient
  readonly runtimeId: string
  readonly hostName: string
  readonly cwd: string | undefined
  readonly prepareCwd?: () => Promise<string>
  readonly onStarted: (sessionId: string) => void | Promise<void>
}

/** Creates an empty remote Session so the ordinary conversation and composer own the first draft too. */
export const RemoteSessionBootstrap = (props: RemoteSessionBootstrapProps) => {
  const target = props.cwd === undefined ? undefined : `${props.runtimeId}\u0000${props.cwd}`
  if (target === undefined) return null
  // A different remote folder is a different Session, so its bootstrap starts from scratch.
  return <RemoteSessionBootstrapAttempt key={target} {...props} target={target} />
}

const RemoteSessionBootstrapAttempt = (props: RemoteSessionBootstrapProps & { readonly target: string }) => {
  // The machine snapshots its input once per target; the refs keep a prop change from freezing a stale Host call.
  const api = useRef(props.api)
  const runtimeId = useRef(props.runtimeId)
  const hostName = useRef(props.hostName)
  const cwd = useRef(props.cwd)
  const prepareCwd = useRef(props.prepareCwd)
  const onStarted = useRef(props.onStarted)
  api.current = props.api
  runtimeId.current = props.runtimeId
  hostName.current = props.hostName
  cwd.current = props.cwd
  prepareCwd.current = props.prepareCwd
  onStarted.current = props.onStarted

  const [snapshot, send] = useMachine(remoteSessionBootstrapMachine, {
    input: {
      target: props.target,
      create: async () => {
        const remoteCwd = prepareCwd.current === undefined ? cwd.current : await prepareCwd.current()
        if (remoteCwd === undefined) throw new Error('Choose a folder on this host first.')
        const result = await api.current.threadCreate({ runtimeId: runtimeId.current, cwd: remoteCwd })
        if (!result.ok) {
          throw { message: `${result.message} (${result.code})`, code: result.code } satisfies BootstrapFailure
        }
        return result.sessionId
      },
      onStarted: sessionId => onStarted.current(sessionId),
      describeFailure: error => {
        const parsed = Schema.decodeUnknownResult(bootstrapFailureSchema)(error)
        return parsed._tag === 'Success' ? parsed.success : { message: errorMessage(error, `Could not start a thread on ${hostName.current}.`) }
      },
    },
  })

  const failure = snapshot.context.failure
  if (snapshot.matches('failed') || snapshot.matches('unrecoverable')) {
    return (
      <Alert variant="destructive" className="dshx:mt-2">
        <AlertDescription className="dshx:flex dshx:items-center dshx:gap-2">
          <span className="dshx:min-w-0 dshx:flex-1">{failure?.message ?? `Could not start a thread on ${props.hostName}.`}</span>
          {snapshot.matches('unrecoverable') ? null : (
            <Button size="sm" variant="outline" onClick={() => send({ type: 'retry' })}>
              Retry
            </Button>
          )}
        </AlertDescription>
      </Alert>
    )
  }
  if (snapshot.matches('started')) return null
  return (
    <p className="dshx:mt-2 dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground" role="status">
      <Spinner className="dshx:size-3.5" /> Opening a native thread on {props.hostName}…
    </p>
  )
}
