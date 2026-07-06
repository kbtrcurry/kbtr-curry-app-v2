// 「最近開いた／使った」項目の履歴をlocalStorageで管理する共通ユーティリティ
const MAX = 30

export const RECENT_LABEL = '最近'
export const RECENT_KEYS = {
  recipe: 'kbtr_recent_recipe',
  ingredient: 'kbtr_recent_ingredient',
  prep: 'kbtr_recent_prep',
} as const

export function getRecent(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function pushRecent(key: string, name: string): string[] {
  const cur = getRecent(key).filter((n) => n !== name)
  const next = [name, ...cur].slice(0, MAX)
  localStorage.setItem(key, JSON.stringify(next))
  return next
}
