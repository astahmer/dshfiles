import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { MultiHostClient } from './queries.js'

const bootstrapFailureSchema = z.object({ message: z.string(), code: z.string().optional() }).strict()
type BootstrapFailure = z.infer<typeof bootstrapFailureSchema>

/** Creates an empty remote Session so the ordinary conversation and composer own the first draft too. */
export const RemoteSessionBootstrap = (props: {
  readonly api: MultiHostClient
  readonly runtimeId: string
  readonly hostName: string
  readonly cwd: string | undefined
  readonly prepareCwd?: () => Promise<string>
  readonly onStarted: (sessionId: string) => void
}) => {
  const [attempt, setAttempt] = useState(0)
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState<BootstrapFailure | null>(null)
  const attempted = useRef<string | undefined>(undefined)
  const prepareCwd = useRef(props.prepareCwd)
  const onStarted = useRef(props.onStarted)
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
      const cwd = prepareCwd.current === undefined ? props.cwd : await prepareCwd.current()
      if (cwd === undefined) throw new Error('Choose a folder on this host first.')
      const result = await props.api.threadCreate({ runtimeId: props.runtimeId, cwd })
      if (!result.ok) {
        throw { message: `${result.message} (${result.code})`, code: result.code } satisfies BootstrapFailure
      }
      if (active) onStarted.current(result.sessionId)
    })().catch(error => {
      if (!active) return
      const parsed = bootstrapFailureSchema.safeParse(error)
      setFailure(
        parsed.success
          ? parsed.data
          : { message: errorMessage(error, `Could not start a thread on ${props.hostName}.`) },
      )
    }).finally(() => {
      if (active) setStarting(false)
    })
    return () => {
      active = false
    }
  }, [attempt, props.api, props.cwd, props.hostName, props.runtimeId, target])

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
