export type ApprovalRiskLevel = 'high' | 'review' | 'low'

/** Commands that delete, overwrite or publish beyond an easy undo; any one of them makes a request high risk. */
const DESTRUCTIVE: readonly RegExp[] = [
  /\brm\s+(?:-[a-z]*\s+)*-[a-z]*[rf]/iu,
  /\bgit\s+push\b[^\n;&|]*(?:--force\b|\s-f\b)/iu,
  /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)/iu,
  /\bjj\s+(?:abandon|git\s+push|op\s+(?:restore|abandon))\b/iu,
  /\bsudo\b/iu,
  /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba|z)?sh\b/iu,
  /\bdd\s+if=/iu,
  /\bmkfs\b/iu,
  /\bchmod\s+-R\b/iu,
  />\s*\/dev\/(?!null\b)/iu,
  /\bdrop\s+(?:table|database|schema)\b/iu,
  /\bkill(?:all)?\s+-9\b/iu,
]

/** Tool names that only read; anything else asking for approval changes something. */
const READ_ONLY_TOOL = /(?:^|_)(?:read|list|get|search|find|grep|glob|status|view|fetch|show)(?:_|$)/u

/**
 * How careful the approver should be: `high` for a command that destroys or publishes, `review` for any other command
 * or a tool that writes, `low` for a tool that only reads. A label for attention, never a policy: the decision stays
 * with the person.
 */
const assess = (input: { readonly toolName: string; readonly command: string | undefined }): ApprovalRiskLevel => {
  if (input.command !== undefined) return DESTRUCTIVE.some(pattern => pattern.test(input.command ?? '')) ? 'high' : 'review'
  return READ_ONLY_TOOL.test(input.toolName) ? 'low' : 'review'
}

export class ApprovalRisk {
  static readonly assess = assess
}
