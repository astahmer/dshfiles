import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { MultiHostClient } from './queries.js'

const bootstrapFailureSchema = z.object({ message: z.string(), code: z.string().optional() }).strict()
type BootstrapFailure = z.infer<typeof bootstrapFailureSchema>

const createdSessions = new Map<string, string>()
const sessionCreations = new Map<string, Promise<string>>()

const createSessionOnce = async (target: string, create: () => Promise<string>): Promise<string> => {
  const created = createdSessions.get(target)
  if (created !== undefined) return created

  const pending = sessionCreations.get(target)
  if (pending !== undefined) return pending

  const operation = create().then(sessionId => {
    createdSessions.set(target, sessionId)
    return sessionId
  })
  sessionCreations.set(target, operation)
  try {
    return await operation
  } finally {
    if (sessionCreations.get(target) === operation) sessionCreations.delete(target)
  }
}

/** Creates an empty remote Session so the ordinary conversation and composer own the first draft too. */
export const RemoteSessionBootstrap = (props: {
  readonly api: MultiHostClient
  readonly runtimeId: string
  readonly hostName: string
  readonly cwd: string | undefined
  readonly prepareCwd?: () => Promise<string>
  readonly onStarted: (sessionId: string) => void | Promise<void>
}) => {
  const [attempt, setAttempt] = useState(0)
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState<BootstrapFailure | null>(null)
  const attempted = useRef<string | undefined>(undefined)
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

  const target = props.cwd === undefined ? undefined : `${props.runtimeId}\u0000${props.cwd}`

  useEffect(() => {
    if (target === undefined) return
    const attemptKey = `${target}\u0000${String(attempt)}`
    if (attempted.current === attemptKey) return
    attempted.current = attemptKey
    let active = true
    setFailure(null)
    setStarting(true)
    void (async () => {
      const sessionId = await createSessionOnce(target, async () => {
        const remoteCwd = prepareCwd.current === undefined ? cwd.current : await prepareCwd.current()
        if (remoteCwd === undefined) throw new Error('Choose a folder on this host first.')
        const result = await api.current.threadCreate({ runtimeId: runtimeId.current, cwd: remoteCwd })
        if (!result.ok) {
          throw { message: `${result.message} (${result.code})`, code: result.code } satisfies BootstrapFailure
        }
        return result.sessionId
      })
      if (active) {
        await onStarted.current(sessionId)
        createdSessions.delete(target)
      }
    })()
      .catch(error => {
        if (!active) return
        const parsed = bootstrapFailureSchema.safeParse(error)
        setFailure(parsed.success ? parsed.data : { message: errorMessage(error, `Could not start a thread on ${hostName.current}.`) })
      })
      .finally(() => {
        if (active) setStarting(false)
      })
    return () => {
      active = false
    }
  }, [attempt, target])

  if (target === undefined) return null
  if (failure !== null) {
    return (
      <Alert variant="destructive" className="dshx:mt-2">
        <AlertDescription className="dshx:flex dshx:items-center dshx:gap-2">
          <span className="dshx:min-w-0 dshx:flex-1">{failure.message}</span>
          {failure.code === 'unknown-mutation-outcome' ? null : (
            <Button size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>
              Retry
            </Button>
          )}
        </AlertDescription>
      </Alert>
    )
  }
  if (!starting) return null
  return (
    <p className="dshx:mt-2 dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground" role="status">
      <Spinner className="dshx:size-3.5" /> Opening a native thread on {props.hostName}…
    </p>
  )
}
