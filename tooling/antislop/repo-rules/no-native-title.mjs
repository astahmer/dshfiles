const nameOf = node => {
  if (node.type === 'JSXIdentifier') return node.name
  if (node.type === 'JSXMemberExpression') return `${nameOf(node.object)}.${nameOf(node.property)}`
  return ''
}

const noNativeTitleRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prefer the shared Tooltip component over native title attributes for hover help.',
    },
    messages: {
      nativeTitle: 'Use the shared Tooltip component instead of the native title attribute; native title tooltips appear after a long delay.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowComponents: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowComponents: [] }],
  },
  create(context) {
    const allowComponents = new Set(context.options?.[0]?.allowComponents ?? [])
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'title') return
        const openingElement = node.parent
        if (openingElement.type !== 'JSXOpeningElement') return
        if (allowComponents.has(nameOf(openingElement.name))) return
        context.report({ node, messageId: 'nativeTitle' })
      },
    }
  },
}

export default { meta: { name: 'ui-guidance' }, rules: { 'no-native-title': noNativeTitleRule } }
