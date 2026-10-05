<template>
  <section class="page" data-module="coordinate">
    <header class="page-head">
      <div>
        <h2>三维坐标管理</h2>
        <p class="page-desc">维护测点记录，围绕测点编号、所属单位、坐标系、高程范围做组合检索、校核留痕与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记测点记录</button>
        <button class="btn" type="button" @click="exportRows">导出三维坐标清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in textFilterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>高程下限</span>
        <input v-model="filters['高程下限']" placeholder="高程 ≥" />
      </label>
      <label class="filter-item">
        <span>高程上限</span>
        <input v-model="filters['高程上限']" placeholder="高程 ≤" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <button
              v-if="column === '所属单位'"
              class="link"
              type="button"
              title="按该单位筛选测点"
              @click="filterByUnit(row)"
            >
              {{ row[column] ?? '—' }}
            </button>
            <template v-else>{{ row[column] || '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="!canOperate(row)"
              :title="canOperate(row) ? '' : '跨单位测点仅可查看'"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无三维坐标数据，可先登记测点记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条三维坐标记录</span>
      <span>当前值班单位：{{ session.homeUnit }}，跨单位测点仅可查看</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('coordinate')
const columns = ["测点编号", "所属单位", "坐标系", "北坐标", "东坐标", "高程值", "测量人", "记录状态", "最近校核", "最近重测"]
const actions = ["提交校核", "确认校核", "安排重测"]
const statuses = ["已测量", "已校核", "需重测", "已归档"]
const stats = [{"label": "测点总数", "value": 0}, {"label": "已校核数", "value": 0}, {"label": "待校核数", "value": 0}]

const session = useSessionStore()
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const textFilterFields = ["测点编号", "所属单位", "坐标系"]
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function filterByUnit(row: EntryRow) {
  filters.value = { ...filters.value, 所属单位: String(row['所属单位'] ?? '') }
  reload()
}

function canOperate(row: EntryRow) {
  return String(row['所属单位'] ?? '') === session.homeUnit
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '测点记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '三维坐标列表读取失败'
  }
}

onMounted(reload)
</script>
