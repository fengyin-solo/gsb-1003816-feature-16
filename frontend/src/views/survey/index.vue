<template>
  <section class="page" data-module="survey">
    <header class="page-head">
      <div>
        <h2>考古调查管理</h2>
        <p class="page-desc">维护调查记录，围绕调查编号、调查区域、调查方法、地表发现做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记调查记录</button>
        <button class="btn" type="button" @click="exportRows">导出考古调查清单</button>
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
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无考古调查数据，可先登记调查记录</td>
        </tr>
      </tbody>
    </table>

    <section class="reminder-section">
      <header class="reminder-head">
        <h3 class="reminder-title">现场复测提醒</h3>
        <span class="legend-item">待复测 {{ pendingReminderCount }} 条</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in reminderColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reminders" :key="String(row.id)">
            <td v-for="column in reminderColumns" :key="column">{{ row[column] || '—' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-if="row.status !== '已复测'"
                class="link"
                type="button"
                @click="resolveReminder(row)"
              >
                标记复测
              </button>
              <span v-else class="readonly-tag">已核销</span>
            </td>
          </tr>
          <tr v-if="!reminders.length">
            <td :colspan="reminderColumns.length + 2" class="empty-state">
              暂无现场复测提醒，三维坐标安排重测后会自动生成
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条考古调查记录</span>
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

const meta = moduleMeta('survey')
const columns = ["调查编号", "调查区域", "调查方法", "地表发现", "断面观察", "初步断代", "调查人", "记录状态"]
const actions = ["完成记录", "提交审核", "安排复查"]
const statuses = ["调查中", "已记录", "已审核", "需复查"]
const stats = [{"label": "调查次数", "value": 0}, {"label": "已审核记录", "value": 0}, {"label": "待复查记录", "value": 0}]

const reminderMeta = moduleMeta('reminder')
const reminderColumns = reminderMeta.fields

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const reminders = ref<EntryRow[]>([])
const pendingReminderCount = computed(
  () => reminders.value.filter((row) => String(row.status) === '待复测').length,
)
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

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '调查记录登记入口尚未接入审批流'
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

function loadReminders() {
  reminders.value = listEntries(reminderMeta.key).items
}

function resolveReminder(row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(reminderMeta.key, Number(row.id), '标记复测')
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  loadReminders()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '考古调查列表读取失败'
  }
}

onMounted(() => {
  reload()
  loadReminders()
})
</script>
