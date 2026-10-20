import SessionController from './native/index.js';
export const inject = SessionController.inject;
export const Config = SessionController.Config;
/** The native controller is a Cordis Service class; this Loader row hosts it unchanged. */
export const apply = (ctx, config) => {
    ctx.plugin(SessionController, config);
};
//# sourceMappingURL=host.js.map