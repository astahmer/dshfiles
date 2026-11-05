import { useState } from 'react'
import { DueDates } from './due-date.js'

/** Today on the reader's calendar, read once per mount so a render stays pure. */
const useToday = (): string => useState(() => DueDates.dateOf(Date.now()))[0]

export { DueDates, useToday }
