const normalizePath = (value) => String(value).replaceAll("\\", "/");

const pathMatches = (filename, pattern) => {
  const normalizedFilename = normalizePath(filename);
  const normalizedPattern = normalizePath(pattern);
  if (normalizedFilename.includes(normalizedPattern)) return true;

  const segments = normalizedPattern.split(/[*\\/]+/u).filter(Boolean);
  let offset = 0;
  for (const segment of segments) {
    const next = normalizedFilename.indexOf(segment, offset);
    if (next === -1) return false;
    offset = next + segment.length;
  }
  return true;
};

const inScope = (context, optionName, defaults) => {
  const options = context.options?.[0] ?? {};
  const filename = normalizePath(context.getFilename());
  const include = options[optionName] ?? options.paths ?? defaults;
  const exclude = options.excludePaths ?? ["/test/", "/tests/", "/fixtures/", "/generated/"];
  if (exclude.some((pattern) => pathMatches(filename, pattern))) return false;
  return include.some((pattern) => pathMatches(filename, pattern));
};

const memberName = (node) => {
  if (node.computed) return undefined;
  return node.property?.type === "Identifier" ? node.property.name : undefined;
};

const isEffectMethod = (node, method) =>
  node.callee?.type === "MemberExpression" &&
  node.callee.object?.type === "Identifier" &&
  node.callee.object.name === "Effect" &&
  memberName(node.callee) === method;

const isEffectExecution = (node) =>
  isEffectMethod(node, "runPromise") ||
  isEffectMethod(node, "runPromiseExit") ||
  isEffectMethod(node, "runSync") ||
  isEffectMethod(node, "runSyncExit");

const effectCatchMethods = new Set([
  "catch",
  "catchTag",
  "catchTags",
  "catchReason",
  "catchReasons",
]);
const effectVoidUnitMethods = new Set(["void", "unit"]);

const isEffectMemberIn = (node, names) =>
  node?.type === "MemberExpression" &&
  node.object?.type === "Identifier" &&
  node.object.name === "Effect" &&
  !node.computed &&
  node.property?.type === "Identifier" &&
  names.has(node.property.name);

const returnsOnlyEffectVoidOrUnit = (node) => {
  if (node?.type !== "ArrowFunctionExpression" && node?.type !== "FunctionExpression") return false;
  if (isEffectMemberIn(node.body, effectVoidUnitMethods)) return true;
  if (node.body?.type !== "BlockStatement" || node.body.body?.length !== 1) return false;
  const statement = node.body.body[0];
  return (
    statement?.type === "ReturnStatement" &&
    isEffectMemberIn(statement.argument, effectVoidUnitMethods)
  );
};

const effectOptionsSchema = [
  {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" } },
      domainPaths: { type: "array", items: { type: "string" } },
      implementationPaths: { type: "array", items: { type: "string" } },
      databasePaths: { type: "array", items: { type: "string" } },
      streamPaths: { type: "array", items: { type: "string" } },
      excludePaths: { type: "array", items: { type: "string" } },
      serviceNames: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
];

const plugin = {
  meta: { name: "effect-antislop" },
  rules: {
    "no-domain-effect-run": {
      meta: { schema: effectOptionsSchema },
      create(context) {
        return {
          CallExpression(node) {
            if (
              !inScope(context, "domainPaths", [
                "/domain/",
                "/domains/",
                "/ports/",
                "/use-cases/",
                "/usecases/",
              ])
            )
              return;
            if (!isEffectExecution(node)) return;
            context.report({
              node,
              message:
                "Effect domain code must preserve Effect programs; run them only at an outer application or platform boundary.",
            });
          },
        };
      },
    },
    "no-effect-context-reprovide": {
      meta: { schema: effectOptionsSchema },
      create(context) {
        return {
          CallExpression(node) {
            if (!inScope(context, "implementationPaths", ["/src/"])) return;
            if (!isEffectMethod(node, "context") && !isEffectMethod(node, "provideContext")) return;
            context.report({
              node,
              message:
                "Do not capture and re-provide Effect context inside implementation code; provide platform context only at the outer boundary.",
            });
          },
        };
      },
    },
    "no-catch-if-tagged-error": {
      meta: { schema: effectOptionsSchema },
      create(context) {
        return {
          CallExpression(node) {
            if (!inScope(context, "implementationPaths", ["/src/"])) return;
            if (!isEffectMethod(node, "catchIf")) return;
            const predicate = node.arguments[0];
            if (
              predicate === undefined ||
              !context.sourceCode.getText(predicate).includes("instanceof")
            )
              return;
            context.report({
              node,
              message:
                "Handle tagged Effect errors with Effect.catch or Effect.catchTag; use catchIf only for genuinely predicate-based recovery.",
            });
          },
        };
      },
    },
    "no-silent-error-swallow": {
      meta: { schema: effectOptionsSchema },
      create(context) {
        return {
          CallExpression(node) {
            if (!inScope(context, "implementationPaths", ["/src/"])) return;
            if (!isEffectMemberIn(node.callee, effectCatchMethods)) return;
            for (const argument of node.arguments ?? []) {
              if (returnsOnlyEffectVoidOrUnit(argument)) {
                context.report({
                  node,
                  message:
                    "Do not silently swallow Effect errors with Effect.void or Effect.unit; recover meaningfully, transform the error, or add a narrow justified disable.",
                });
              }
              if (argument?.type !== "ObjectExpression") continue;
              for (const property of argument.properties ?? []) {
                if (property.type === "Property" && returnsOnlyEffectVoidOrUnit(property.value)) {
                  context.report({
                    node,
                    message:
                      "Do not silently swallow Effect errors with Effect.void or Effect.unit; recover meaningfully, transform the error, or add a narrow justified disable.",
                  });
                }
              }
            }
          },
        };
      },
    },
    "no-service-flat-map-facade": {
      meta: { schema: effectOptionsSchema },
      create(context) {
        return {
          CallExpression(node) {
            if (!inScope(context, "implementationPaths", ["/src/"])) return;
            if (!isEffectMethod(node, "flatMap")) return;
            const service = node.arguments[0];
            if (service?.type !== "Identifier") return;
            const options = context.options?.[0] ?? {};
            const serviceNames = options.serviceNames ?? [];
            const matchesConfiguredName = serviceNames.includes(service.name);
            if (
              !matchesConfiguredName &&
              !/(?:Database|Reader|Writer|Store|Repository|Service)$/u.test(service.name)
            )
              return;
            context.report({
              node,
              message:
                "Yield Effect services once and call their implementation methods; do not build static operation facades with Effect.flatMap(ServiceKey, ...).",
            });
          },
        };
      },
    },
    "no-fallible-database-promise": {
      meta: { schema: effectOptionsSchema },
      create(context) {
        return {
          CallExpression(node) {
            if (
              !inScope(context, "databasePaths", [
                "/db/",
                "/database/",
                "/repositories/",
                "/repository/",
              ])
            )
              return;
            if (!isEffectMethod(node, "promise")) return;
            context.report({
              node,
              message:
                "Preserve fallible database failures with Effect.tryPromise or another tagged boundary; do not erase them with Effect.promise.",
            });
          },
        };
      },
    },
    "no-untyped-readable-stream-error": {
      meta: { schema: effectOptionsSchema },
      create(context) {
        return {
          CallExpression(node) {
            if (!inScope(context, "streamPaths", ["/src/"])) return;
            if (node.callee?.type !== "MemberExpression") return;
            if (node.callee.object?.type !== "Identifier" || node.callee.object.name !== "Stream")
              return;
            if (memberName(node.callee) !== "fromReadableStream") return;
            const source = context.sourceCode.getText(node);
            if (!/fromReadableStream\s*\(\s*\{/su.test(source)) return;
            if (!/onError\s*:\s*(?:\(\s*)?([A-Za-z_$][\w$]*)(?:\s*\))?\s*=>\s*\1\b/su.test(source))
              return;
            context.report({
              node,
              message:
                "Map Stream.fromReadableStream onError causes into a tagged domain error; do not leak raw unknown failures.",
            });
          },
        };
      },
    },
    "no-sequential-effect-yield-in-loop": {
      meta: { schema: effectOptionsSchema },
      create(context) {
        const loopVariable = (left) => {
          if (left?.type === "Identifier") return left.name;
          if (left?.type === "VariableDeclaration") {
            const declaration = left.declarations?.[0];
            if (declaration?.id?.type === "Identifier") return declaration.id.name;
          }
          return undefined;
        };

        return {
          ForOfStatement(node) {
            if (
              !inScope(context, "domainPaths", [
                "/domain/",
                "/domains/",
                "/ports/",
                "/use-cases/",
                "/usecases/",
              ])
            )
              return;
            const body = context.sourceCode.getText(node.body);
            if (!/\byield\s*\*/u.test(body)) return;

            const yieldedBindings = new Set();
            for (const match of body.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*yield\s*/gu)) {
              yieldedBindings.add(match[1]);
            }
            const loopVar = loopVariable(node.left);
            if (loopVar !== undefined) yieldedBindings.add(loopVar);
            if (yieldedBindings.size === 0) return;

            const referenced = [...yieldedBindings].map((name) => `\\b${name}\\b`).join("|");
            const accumulatesResult = new RegExp(
              `\\.(?:push|set|add|unshift|append)\\([^)]*?(?:${referenced})`,
            ).test(body);
            if (!accumulatesResult) return;

            context.report({
              node,
              message:
                "Independent Effect work inside a loop should be batched with Effect.forEach or Effect.all; add a narrow disable comment when ordering or transaction semantics require sequential execution.",
            });
          },
        };
      },
    },
  },
};

export default plugin;
