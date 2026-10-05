import { coordinateSystemMatches, normalizeCoordinateSystem } from '@/data/coordinate-systems'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionContext, ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 三维坐标模块的校核类动作：都会刷新「最近校核」，但首次有效校核值只冻结一次。
const CALIBRATION_ACTIONS = ['提交校核', '确认校核']

function formatNow(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function parseNumber(value: string | undefined): number | null {
  if (!value || value.trim() === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// 三维坐标的组合检索：测点编号、所属单位走包含匹配，坐标系支持别名归一，高程按下限/上限区间过滤。
function filterCoordinateRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const elevationMin = parseNumber(filters['高程下限'])
  const elevationMax = parseNumber(filters['高程上限'])
  return rows.filter((row) => {
    const pointNo = String(row['测点编号'] ?? '')
    const unit = String(row['所属单位'] ?? '')
    const pointNoQuery = filters['测点编号']?.trim()
    const unitQuery = filters['所属单位']?.trim()
    if (pointNoQuery && !pointNo.includes(pointNoQuery)) {
      return false
    }
    if (unitQuery && !unit.includes(unitQuery)) {
      return false
    }
    if (!coordinateSystemMatches(row['坐标系'], filters['坐标系'] ?? '')) {
      return false
    }
    if (elevationMin !== null || elevationMax !== null) {
      const elevation = parseNumber(String(row['高程值'] ?? ''))
      if (elevation === null) {
        return false
      }
      if (elevationMin !== null && elevation < elevationMin) {
        return false
      }
      if (elevationMax !== null && elevation > elevationMax) {
        return false
      }
    }
    return true
  })
}

// 同一测点编号归一后命中同一坐标系的，视为别名重复登记，只保留一套：
// 优先保留以标准名登记的记录；都不是标准名时保留最早登记（id 最小）的一条。
// 坐标系不在别名表里的老测点不参与合并，按原坐标系保留。
function dedupeCoordinateRows(rows: EntryRow[]): EntryRow[] {
  const groups = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const key = `${String(row['测点编号'] ?? '')}::${normalizeCoordinateSystem(String(row['坐标系'] ?? ''))}`
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  const kept: EntryRow[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0])
      continue
    }
    const canonical = normalizeCoordinateSystem(String(group[0]['坐标系'] ?? ''))
    const named = group.filter((row) => String(row['坐标系'] ?? '').trim() === canonical)
    const pool = named.length > 0 ? named : group
    kept.push(pool.reduce((a, b) => (Number(a.id) <= Number(b.id) ? a : b)))
  }
  return kept.sort((a, b) => Number(a.id) - Number(b.id))
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched =
    key === 'coordinate'
      ? dedupeCoordinateRows(filterCoordinateRows(listRows(key), filters))
      : filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 校核类动作的副作用：刷新「最近校核」；首次有效校核值只在第一次校核时冻结，重复校核不覆盖。
// 返回追加到结果消息里的说明文字。
function applyCoordinateCalibration(row: EntryRow, context: ActionContext): string {
  const operator = context.operator?.trim() || '值班管理员'
  row['最近校核'] = `${formatNow()} · ${operator}`
  if (row['首次校核值']) {
    return '，首次校核值保持不变'
  }
  row['首次校核值'] =
    `N ${String(row['北坐标'] ?? '')} / E ${String(row['东坐标'] ?? '')} / H ${String(row['高程值'] ?? '')}` +
    `（${String(row['坐标系'] ?? '')}）`
  return '，已冻结首次校核值'
}

// 安排重测成功后，向考古调查业务面的现场复测提醒追加一条。
function appendResurveyReminder(row: EntryRow, context: ActionContext): void {
  const operator = context.operator?.trim() || '值班管理员'
  const reminders = listRows('reminder')
  const id = reminders.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const pointNo = String(row['测点编号'] ?? '')
  const reminder: EntryRow = {
    id,
    status: '待复测',
    pending: true,
    abnormal: false,
    提醒编号: `REM-${String(id).padStart(4, '0')}`,
    关联测点: pointNo,
    所属单位: String(row['所属单位'] ?? ''),
    坐标系: normalizeCoordinateSystem(String(row['坐标系'] ?? '')),
    提醒内容: `测点 ${pointNo} 已安排重测，请现场复测并回传校核值`,
    登记人: operator,
    创建时间: formatNow(),
  }
  saveRows('reminder', [...reminders, reminder])
}

export function runAction(key: string, id: number, action: string, context: ActionContext = {}): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (key === 'coordinate') {
    const currentUnit = context.unit?.trim()
    const rowUnit = String(rows[index]['所属单位'] ?? '')
    if (currentUnit && rowUnit && rowUnit !== currentUnit) {
      return { ok: false, message: `测点属于「${rowUnit}」，跨单位人员仅可查看，不能执行「${action}」` }
    }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  let extraMessage = ''
  if (key === 'coordinate') {
    if (CALIBRATION_ACTIONS.includes(action)) {
      extraMessage = applyCoordinateCalibration(updated, context)
    } else if (action === '安排重测') {
      const operator = context.operator?.trim() || '值班管理员'
      updated['最近重测'] = `${formatNow()} · ${operator}`
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  if (key === 'coordinate' && action === '安排重测') {
    appendResurveyReminder(updated, context)
    extraMessage = '，已同步现场复测提醒'
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${extraMessage}` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
