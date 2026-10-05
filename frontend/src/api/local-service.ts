import { crsMatches } from '@/data/coordinate-crs'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 个别模块在通用 includes 之外还有专属检索条件（范围值、坐标系别名），从这里分流，
// 这些键不再走默认的字段包含匹配。
const SPECIAL_FILTER_FIELDS: Record<string, string[]> = {
  coordinate: ['坐标系', '高程下限', '高程上限'],
}

function withinElevation(value: unknown, minRaw?: string, maxRaw?: string): boolean {
  const min = Number(minRaw ?? '')
  const max = Number(maxRaw ?? '')
  const hasMin = (minRaw ?? '').trim() !== '' && !Number.isNaN(min)
  const hasMax = (maxRaw ?? '').trim() !== '' && !Number.isNaN(max)
  if (!hasMin && !hasMax) {
    return true
  }
  const elevation = Number(value)
  if (Number.isNaN(elevation)) {
    return false
  }
  if (hasMin && elevation < min) {
    return false
  }
  if (hasMax && elevation > max) {
    return false
  }
  return true
}

const SPECIAL_MATCHERS: Record<string, (row: EntryRow, filters: Record<string, string>) => boolean> = {
  coordinate(row, filters) {
    const crsQuery = (filters['坐标系'] ?? '').trim()
    if (crsQuery !== '' && !crsMatches(String(row['坐标系'] ?? ''), crsQuery)) {
      return false
    }
    return withinElevation(row['高程值'], filters['高程下限'], filters['高程上限'])
  },
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>, key?: string): EntryRow[] {
  const specialFields = (key && SPECIAL_FILTER_FIELDS[key]) || []
  const pairs = Object.entries(filters).filter(
    ([field, value]) => value.trim() !== '' && !specialFields.includes(field),
  )
  const base =
    pairs.length === 0
      ? rows
      : rows.filter((row) =>
          pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
        )
  const matcher = key ? SPECIAL_MATCHERS[key] : undefined
  return matcher ? base.filter((row) => matcher(row, filters)) : base
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters, key)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// 安排重测后，考古调查业务面要同步出现一条现场复测提醒。
function appendResurveyReminder(point: EntryRow, date: string): void {
  const surveys = listRows('survey')
  const nextId = surveys.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const reminder: EntryRow = {
    id: nextId,
    status: '需复查',
    pending: true,
    abnormal: false,
    调查编号: `SURV-${String(nextId).padStart(4, '0')}`,
    调查区域: String(point['所属单位'] ?? ''),
    调查方法: '现场复测提醒',
    地表发现: `测点 ${String(point['测点编号'] ?? '')} 于 ${date} 安排重测，需现场复测确认`,
    断面观察: '—',
    初步断代: '—',
    调查人: '系统联动',
    记录状态: '待现场确认',
  }
  saveRows('survey', [...surveys, reminder])
}

// 三维坐标的动作副作用：校核/重测要在测点上留痕，重测还要联动考古调查。
// 首次校核值一旦写入就不再被后续校核覆盖，重复校核只刷新最近校核时间。
function applyCoordinateEffect(row: EntryRow, action: string): { row: EntryRow; note?: string } {
  const date = today()
  if (action.includes('校核')) {
    const next: EntryRow = { ...row, 最近校核: date }
    if (next['首次校核值'] === undefined || next['首次校核值'] === '') {
      next['首次校核值'] = `高程 ${String(row['高程值'] ?? '—')}`
      next['首次校核时间'] = date
      return { row: next }
    }
    return { row: next, note: '首次校核值保留不变' }
  }
  if (action.includes('重测')) {
    const next: EntryRow = { ...row, 最近重测: date }
    appendResurveyReminder(next, date)
    return { row: next, note: '已同步在考古调查增加一条现场复测提醒' }
  }
  return { row }
}

// 模块级动作副作用：通用状态流转之外，个别模块要留痕或联动其他业务面，
// 返回的 note 会拼进动作结果提示。
const ACTION_EFFECTS: Record<string, (row: EntryRow, action: string) => { row: EntryRow; note?: string }> = {
  coordinate: applyCoordinateEffect,
}

export function runAction(key: string, id: number, action: string): ActionResult {
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
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  let updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  let note = ''
  const effect = ACTION_EFFECTS[key]
  if (effect) {
    const result = effect(updated, action)
    updated = result.row
    note = result.note ? `，${result.note}` : ''
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${note}` }
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
