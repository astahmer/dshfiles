import type { ThreadNotificationSound } from './thread-notifications.js'

const notificationSoundFrequencies = {
  soft: 440,
  chime: 660,
  bright: 880,
  low: 330,
} satisfies Record<ThreadNotificationSound, number>

let audioContext: AudioContext | null = null

const unlockThreadNotificationAudio = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return false
  try {
    const context = audioContext ?? new window.AudioContext()
    audioContext = context
    if (context.state === 'suspended') await context.resume()
    return context.state === 'running'
  } catch {
    return false
  }
}

const playThreadNotificationSound = (sound: ThreadNotificationSound, volume: number): void => {
  if (audioContext === null || audioContext.state !== 'running' || volume <= 0) return
  try {
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const startsAt = audioContext.currentTime
    oscillator.type = sound === 'bright' ? 'triangle' : 'sine'
    oscillator.frequency.setValueAtTime(notificationSoundFrequencies[sound], startsAt)
    gain.gain.setValueAtTime(0, startsAt)
    gain.gain.linearRampToValueAtTime(volume * 0.12, startsAt + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, startsAt + 0.22)
    oscillator.connect(gain)
    gain.connect(audioContext.destination)
    oscillator.start(startsAt)
    oscillator.stop(startsAt + 0.22)
  } catch {
    return
  }
}

const previewThreadNotificationSound = async (sound: ThreadNotificationSound, volume: number): Promise<boolean> => {
  if (!(await unlockThreadNotificationAudio())) return false
  playThreadNotificationSound(sound, volume)
  return true
}

export class ThreadNotificationAudioModel {
  static readonly unlock = unlockThreadNotificationAudio
  static readonly play = playThreadNotificationSound
  static readonly preview = previewThreadNotificationSound
}
