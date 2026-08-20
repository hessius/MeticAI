export function convertGeminiToOEPF(p: Record<string, unknown>): Record<string, unknown> {
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_$/, '')
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
  const varLookup: Record<string, number> = {}
  if (Array.isArray(p.variables)) {
    for (const v of p.variables as Array<Record<string, unknown>>) {
      if (v.key && typeof v.value === 'number') varLookup[v.key as string] = v.value
      if (v.name && typeof v.value === 'number') varLookup[v.name as string] = v.value
    }
  } else if (p.variables && typeof p.variables === 'object') {
    for (const [k, v] of Object.entries(p.variables as Record<string, unknown>)) {
      const num = typeof v === 'number' ? v : typeof v === 'object' && v !== null ? (v as Record<string, unknown>).value : undefined
      if (typeof num === 'number') varLookup[k] = num
    }
  }
  const resolve = (val: unknown): unknown => {
    if (typeof val === 'string' && val.startsWith('$')) {
      const name = val.slice(1)
      return varLookup[name] ?? 0
    }
    return val
  }
  const validTypes = ['power', 'flow', 'pressure', 'weight', 'time', 'piston_position']
  const infoTypeAliases = ['info', 'information', 'display', 'readonly', 'read_only']
  const emojiRegex = /^\p{Extended_Pictographic}/u
  const infoEmojiMap: Record<string, string> = {
    dose: '☕', ratio: '📏', grind: '⚙️', roast: '🔥', bean: '🫘',
    beans: '🫘', origin: '🌍', water: '💧', yield: '⚖️', output: '⚖️',
    notes: '📝', method: '📋', recipe: '📋', default: 'ℹ️',
  }
  function ensureEmojiPrefix(name: string): string {
    if (emojiRegex.test(name)) return name
    const lower = name.toLowerCase()
    for (const [keyword, emoji] of Object.entries(infoEmojiMap)) {
      if (keyword !== 'default' && lower.includes(keyword)) return `${emoji} ${name}`
    }
    return `ℹ️ ${name}`
  }
  const vars: Array<Record<string, unknown>> = []
  if (Array.isArray(p.variables)) {
    for (const v of (p.variables as Array<Record<string, unknown>>)) {
      if (typeof v.value !== 'number') continue
      const varType = String(v.type ?? '')
      const varKey = String(v.key ?? v.name ?? '')
      const varName = String(v.name ?? v.key ?? '')
      if (validTypes.includes(varType)) {
        vars.push(v)
      } else if (infoTypeAliases.includes(varType.toLowerCase()) || varKey.startsWith('info_')) {
        const preservedType = validTypes.includes(varType) ? varType : 'power'
        const infoKey = varKey.startsWith('info_') ? varKey : `info_${slugify(varKey || varName)}`
        if (!infoKey || infoKey === 'info_') continue
        vars.push({
          ...v,
          key: infoKey,
          name: ensureEmojiPrefix(varName),
          type: preservedType,
        })
      }
    }
  }
  const stages = Array.isArray(p.stages) ? (p.stages as Array<Record<string, unknown>>).map((s, i) => {
    let dynamics = s.dynamics
    if (Array.isArray(dynamics)) {
      dynamics = {
        points: (dynamics as Array<Record<string, unknown>>).map(pt => [
          Number(resolve(pt.time)) || 0, Number(resolve(pt.value)) || 0
        ]),
        over: 'time', interpolation: 'linear',
      }
    } else if (dynamics && typeof dynamics === 'object') {
      const d = dynamics as Record<string, unknown>
      if (Array.isArray(d.points) && d.points.length > 0) {
        if (Array.isArray(d.points[0])) {
          d.points = (d.points as Array<Array<unknown>>).map(pt => [
            Number(resolve(pt[0])) || 0, Number(resolve(pt[1])) || 0
          ])
        } else if (typeof d.points[0] === 'object') {
          d.points = (d.points as Array<Record<string, unknown>>).map(pt => [
            Number(resolve(pt.time)) || 0, Number(resolve(pt.value)) || 0
          ])
        }
      }
      if (!d.over) d.over = 'time'
      if (!d.interpolation) d.interpolation = 'linear'
    }
    const typeMap: Record<string, string> = { flowRate: 'flow', flow_rate: 'flow', flowrate: 'flow' }
    let type = typeMap[s.type as string] || (s.type as string)
    if (!['power', 'flow', 'pressure'].includes(type)) type = 'pressure'
    const triggerTypes = ['weight', 'pressure', 'flow', 'time', 'piston_position', 'power', 'user_interaction']
    const mapTriggerType = (t: string) => {
      if (triggerTypes.includes(t)) return t
      if (/weight|dose|grams/i.test(t)) return 'weight'
      if (/time|duration|elapsed/i.test(t)) return 'time'
      if (/pressure/i.test(t)) return 'pressure'
      if (/flow/i.test(t)) return 'flow'
      return 'time'
    }
    const triggers = Array.isArray(s.exit_triggers)
      ? (s.exit_triggers as Array<Record<string, unknown>>).map(t => ({
          type: mapTriggerType(String(t.type || 'time')),
          value: Number(resolve(t.value)) || 0,
          relative: t.relative ?? true,
          comparison: t.comparison || t.comparator || '>=',
        }))
      : []
    const limits = Array.isArray(s.limits)
      ? (s.limits as Array<Record<string, unknown>>).map(l => {
          let lt = String(l.type || 'pressure')
          if (lt !== 'pressure' && lt !== 'flow') {
            lt = /flow/i.test(lt) ? 'flow' : 'pressure'
          }
          return { type: lt, value: Number(resolve(l.value)) || 0 }
        })
      : []
    return {
      name: s.name || `Stage ${i + 1}`,
      key: s.key || slugify(String(s.name || `stage_${i + 1}`)),
      type, dynamics, exit_triggers: triggers, limits,
    }
  }) : []
  return {
    name: p.name || 'AI Generated Profile',
    id: uuid(),
    author: typeof p.author === 'string' ? p.author : 'MeticAI',
    author_id: uuid(),
    previous_authors: [],
    display: { accentColor: '#6366f1' },
    temperature: p.temperature ?? 93,
    final_weight: p.final_weight ?? 36,
    variables: vars,
    stages,
    last_changed: Date.now() / 1000,
  }
}
