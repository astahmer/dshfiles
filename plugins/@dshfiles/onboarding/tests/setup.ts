import { configure } from '@testing-library/react'

// findBy* waits 1 s by default; the first React Query render overshoots that under the parallel plugin test run.
configure({ asyncUtilTimeout: 5_000 })
