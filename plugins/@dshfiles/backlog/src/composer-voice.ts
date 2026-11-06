import { useEffect, useRef, useState } from 'react'
import type { VoiceCapture } from './composer-audio.js'

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'transcribing'

export interface VoiceCaptureControl {
  readonly phase: VoicePhase
  readonly toggle: () => void
}

/**
 * Dictation in the capture composer: one phase from the microphone request to the transcript. A click while the
 * microphone is still being granted is ignored, and leaving the composer releases a microphone granted after it left.
 */
export const useVoiceCapture = (options: {
  readonly start: () => Promise<VoiceCapture>
  /** Reads the finished recording and turns it into text; it owns its own failures. */
  readonly transcribe: (recording: () => Promise<Uint8Array>) => Promise<void>
  readonly onStarted: () => void
  readonly onStartFailed: (error: unknown) => void
  readonly maxDurationMs: number
}): VoiceCaptureControl => {
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const captureRef = useRef<VoiceCapture | null>(null)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposedRef = useRef(false)

  const clearStopTimer = (): void => {
    if (stopTimerRef.current !== null) clearTimeout(stopTimerRef.current)
    stopTimerRef.current = null
  }

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      clearStopTimer()
      void captureRef.current?.cancel()
      captureRef.current = null
    }
  }, [])

  const stop = async (): Promise<void> => {
    const capture = captureRef.current
    if (capture === null) return
    captureRef.current = null
    clearStopTimer()
    setPhase('transcribing')
    try {
      await options.transcribe(() => capture.stop())
    } finally {
      if (!disposedRef.current) setPhase('idle')
    }
  }

  const start = async (): Promise<void> => {
    setPhase('starting')
    let capture: VoiceCapture
    try {
      capture = await options.start()
    } catch (error) {
      if (disposedRef.current) return
      setPhase('idle')
      options.onStartFailed(error)
      return
    }
    if (disposedRef.current) {
      void capture.cancel()
      return
    }
    captureRef.current = capture
    setPhase('recording')
    options.onStarted()
    stopTimerRef.current = setTimeout(() => void stop(), options.maxDurationMs)
  }

  const toggle = (): void => {
    if (phase === 'recording') void stop()
    else if (phase === 'idle') void start()
  }

  return { phase, toggle }
}
