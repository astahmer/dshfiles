import { z } from 'zod';
import { defineHost } from '@dshfiles/dshx/host';
import SessionController from './native/index.js';
import { interruptionHost } from './interruption-host.js';
const configSchema = z.object({ nativeOpen: z.boolean().optional(), listWorkSliceMs: z.number().int().positive().default(16) }).default({ listWorkSliceMs: 16 });
export default defineHost({
    name: '@dshfiles/session-controller',
    Config: configSchema,
    inject: [...SessionController.inject, 'remoteAccess'],
    apis: [interruptionHost],
    setup: (ctx, config) => { ctx.plugin(SessionController, SessionController.Config(configSchema.parse(config))); },
});
//# sourceMappingURL=host.js.map