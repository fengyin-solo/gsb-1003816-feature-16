import { defineStore } from 'pinia'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '田野考古发掘数字化管理系统',
    // 当前值班人员所属单位：三维坐标模块按它判定跨单位只读。
    unit: '发掘一队',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isOwnUnit: (state) => (unit: string) => unit === state.unit,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})
