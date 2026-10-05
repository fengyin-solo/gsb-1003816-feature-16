// 坐标系标准名与别名表：检索时别名归一到标准名；表外的坐标系（老测点）原样保留、原样匹配。
const CANONICAL_SYSTEMS: { name: string; aliases: string[] }[] = [
  { name: '1954北京坐标系', aliases: ['北京54', '54北京', 'BJ54', '1954北京'] },
  { name: '1980西安坐标系', aliases: ['西安80', '80西安', 'XA80', '1980西安'] },
  { name: '2000国家大地坐标系', aliases: ['CGCS2000', 'CGCS-2000', '2000国家大地', '国家2000'] },
  { name: 'WGS84世界大地坐标系', aliases: ['WGS84', 'WGS-84', '84坐标'] },
]

export function listCoordinateSystems(): string[] {
  return CANONICAL_SYSTEMS.map((item) => item.name)
}

export function normalizeCoordinateSystem(value: string): string {
  const text = value.trim()
  if (!text) {
    return text
  }
  const lower = text.toLowerCase()
  for (const item of CANONICAL_SYSTEMS) {
    if (item.name === text || item.aliases.some((alias) => alias.toLowerCase() === lower)) {
      return item.name
    }
  }
  return text
}

export function coordinateSystemMatches(rowValue: unknown, query: string): boolean {
  const keyword = query.trim()
  if (!keyword) {
    return true
  }
  const raw = String(rowValue ?? '')
  if (raw.includes(keyword)) {
    return true
  }
  return normalizeCoordinateSystem(raw) === normalizeCoordinateSystem(keyword)
}
