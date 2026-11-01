import { z } from 'zod'

const sshTargetSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9][A-Za-z0-9._-]*$/)
const profileSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)

const localLaunchUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .superRefine((value, context) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      context.addIssue({ code: 'custom', message: 'The launch URL is invalid.' })
      return
    }
    const addressParts = url.hostname.split('.')
    const loopbackIpv4 = addressParts.length === 4 && addressParts[0] === '127' && addressParts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || url.hostname === '::1' || loopbackIpv4
    if (url.protocol !== 'http:' || !loopback || url.username || url.password) {
      context.addIssue({ code: 'custom', message: 'A local runtime URL must use HTTP loopback without user information.' })
    }
    const token = url.searchParams.get('token')
    if (url.pathname !== '/' || token === null || !/^[A-Za-z0-9._~-]{8,512}$/.test(token) || url.searchParams.size !== 1 || url.hash) {
      context.addIssue({ code: 'custom', message: 'A local runtime URL must be the tokenized root launch URL.' })
    }
  })

export const hostConnectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }).strict(),
  z.object({ kind: z.literal('ssh'), sshTarget: sshTargetSchema }).strict(),
])

export const runtimeLocatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), launchUrl: localLaunchUrlSchema }).strict(),
  z
    .object({
      kind: z.literal('ssh'),
      unit: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.@-]*$/)
        .optional(),
      remoteHome: z
        .string()
        .trim()
        .min(2)
        .max(1024)
        .regex(/^\/(?!.*(?:^|\/)\.\.(?:\/|$)).+$/),
    })
    .strict(),
])

export const runtimeIdentitySchema = z
  .object({
    protocolVersion: z.literal(1),
    runtimeId: z.string().uuid(),
    profile: profileSchema,
    homeLeaf: z.string().min(1).max(128),
    dshVersion: z.string().min(1).max(80),
    capabilities: z.array(z.enum(['workspace', 'session', 'agent'])).max(8),
  })
  .strict()
