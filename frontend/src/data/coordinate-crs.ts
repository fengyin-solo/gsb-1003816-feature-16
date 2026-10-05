// 坐标系别名族：同一套坐标系在现场常有规范名、简称、旧称等多种写法。
// 检索时把查询词归一到别名族，族内任意写法都能命中测点；
// 同一测点命中多个别名时，一律保留测点登记的原始坐标系写法（不改写数据），
// 只在匹配阶段做归一，老测点没有登记别名族写法时仍按原文兼容。
const CRS_ALIAS_GROUPS: string[][] = [
  ['CGCS2000', '2000国家大地坐标系', '国家2000坐标系'],
  ['西安80', '1980西安坐标系', 'XA80'],
  ['北京54', '1954北京坐标系', 'BJ54'],
]

function aliasGroupOf(text: string): string[] | null {
  for (const group of CRS_ALIAS_GROUPS) {
    if (group.some((alias) => text.includes(alias) || alias.includes(text))) {
      return group
    }
  }
  return null
}

export function crsMatches(rowValue: string, query: string): boolean {
  const value = rowValue.trim()
  const needle = query.trim()
  if (needle === '') {
    return true
  }
  if (value.includes(needle)) {
    return true
  }
  const group = aliasGroupOf(needle)
  if (!group) {
    return false
  }
  return group.some((alias) => value.includes(alias))
}
