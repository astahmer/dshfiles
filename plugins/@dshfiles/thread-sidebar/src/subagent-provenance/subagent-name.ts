const modifiers = [
  'Amber',
  'Arctic',
  'Azure',
  'Bright',
  'Calm',
  'Cedar',
  'Clever',
  'Copper',
  'Coral',
  'Cosmic',
  'Daring',
  'Dawn',
  'Dusky',
  'Fern',
  'Golden',
  'Jade',
  'Kind',
  'Lunar',
  'Maple',
  'Mellow',
  'Misty',
  'Mossy',
  'Nimble',
  'Opal',
  'Quiet',
  'Silver',
  'Solar',
  'Steady',
  'Swift',
  'Velvet',
  'Willow',
  'Zephyr',
]

const animals = [
  'Badger',
  'Bear',
  'Bee',
  'Bison',
  'Cardinal',
  'Cheetah',
  'Cobra',
  'Crane',
  'Crow',
  'Dolphin',
  'Dove',
  'Eagle',
  'Falcon',
  'Finch',
  'Fox',
  'Gecko',
  'Heron',
  'Horse',
  'Ibex',
  'Jay',
  'Koala',
  'Lark',
  'Lynx',
  'Mantis',
  'Newt',
  'Otter',
  'Owl',
  'Panda',
  'Puffin',
  'Rabbit',
  'Raven',
  'Robin',
  'Seal',
  'Sparrow',
  'Swan',
  'Tiger',
  'Turtle',
  'Viper',
  'Whale',
  'Wolf',
  'Wren',
  'Yak',
]

const hash = (value: string) => {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619)
  }
  return result >>> 0
}

export const subagentName = ({ sessionId, callId }: { sessionId: string; callId: string }) => {
  const seed = hash(`${sessionId}:${callId}`)
  const modifier = modifiers[seed % modifiers.length] ?? 'Quiet'
  const animal = animals[Math.floor(seed / modifiers.length) % animals.length] ?? 'Finch'
  return `${modifier} ${animal}`
}
