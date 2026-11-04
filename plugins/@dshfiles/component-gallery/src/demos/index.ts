import type { GalleryCategory } from './types.js'
import { agents2Demos } from './agents-2.js'
import { agentsDemos } from './agents.js'
import { interactionDemos } from './interaction.js'
import { kitDemos } from './kit.js'
import { motionDemos } from './motion.js'
import { revisionsDemos } from './revisions.js'
import { tracesDemos } from './traces.js'
import { usageDemos } from './usage.js'

/**
 * Gallery tabs, in order. Each category lives in its own file under `src/demos/`, so adding a component means adding
 * one entry there; the component itself lives in `@dshfiles/plugin-ui` so every plugin can import it.
 */
export const galleryCategories: readonly GalleryCategory[] = [
  {
    id: 'agents',
    label: 'Agents',
    description: 'Queues, runs, routines, delegation and plans: how agents and subagents show their work.',
    demos: [...agentsDemos, ...agents2Demos],
  },
  {
    id: 'traces',
    label: 'Traces',
    description: 'Timelines, waterfalls, replays and fallback chains over spans, tokens and cost.',
    demos: tracesDemos,
  },
  {
    id: 'usage',
    label: 'Usage',
    description: 'Spend, credits, activity, recaps, access and pipelines.',
    demos: usageDemos,
  },
  {
    id: 'revisions',
    label: 'Revisions',
    description: 'Revision timelines, merge conflicts, checks, landing pipelines and call stacks.',
    demos: revisionsDemos,
  },
  {
    id: 'interaction',
    label: 'Interaction',
    description: 'Selection, approvals, clarifying prompts and walkthroughs.',
    demos: interactionDemos,
  },
  {
    id: 'motion',
    label: 'Motion',
    description: 'The shared animation layer: presets, springs, enters, FLIP lists and count-ups from @dshfiles/plugin-ui/motion.',
    demos: motionDemos,
  },
  {
    id: 'kit',
    label: 'Kit',
    description: 'The base shadcn kit every plugin builds on.',
    demos: kitDemos,
  },
]
