// ローカル(IndexedDB)→Supabase への同期エンジン。
// 通信断でもレジ操作を止めないため、書込みはまずローカルに確定し、
// この仕組みがバックグラウンドで（オンライン復帰時・定期的に）反映を試みる。
// receipts/sales_sessions の主キーはクライアント生成UUIDなので、
// 再送しても upsert で重複しない（= 何度リトライしても安全）。
import { supabase } from './supabase'
import { localSessions, localReceipts } from './offlineDb'

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeQueue(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify() {
  listeners.forEach((fn) => fn())
}

let flushing = false
let retryTimer: ReturnType<typeof setTimeout> | null = null

export async function getPendingCount(): Promise<number> {
  const [sessions, receipts] = await Promise.all([localSessions.getAll(), localReceipts.getAll()])
  return sessions.filter((s) => !s.synced).length + receipts.filter((r) => !r.synced).length
}

export function scheduleFlush(delayMs = 0) {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    void flushQueue()
  }, delayMs)
}

export async function flushQueue(): Promise<void> {
  if (flushing) return
  flushing = true
  try {
    const pendingSessions = (await localSessions.getAll()).filter((s) => !s.synced)
    for (const s of pendingSessions) {
      try {
        const row = {
          id: s.id,
          session_date: s.session_date,
          segment_id: s.segment_id,
          status: s.status,
        }
        const { error } = await supabase.from('sales_sessions').upsert(row)
        if (error) throw error
        await localSessions.put({ ...s, synced: true })
      } catch {
        // オフライン・一時エラー。次回のフラッシュで再試行
      }
    }

    const pendingReceipts = (await localReceipts.getAll()).filter((r) => !r.synced)
    for (const r of pendingReceipts) {
      try {
        const row = {
          id: r.id,
          session_id: r.sessionId,
          total: r.total,
          received: r.received,
          people: r.people,
          voided: r.voided,
          created_at: r.createdAt,
        }
        const { lines } = r
        const { error: recErr } = await supabase.from('receipts').upsert(row)
        if (recErr) throw recErr
        if (lines.length > 0) {
          const lineRows = lines.map((l) => ({
            id: l.id,
            receipt_id: r.id,
            menu_id: l.menuId,
            name_snapshot: l.nameSnapshot,
            qty: l.qty,
            unit_price: l.unitPrice,
          }))
          const { error: lineErr } = await supabase.from('receipt_lines').upsert(lineRows)
          if (lineErr) throw lineErr
        }
        await localReceipts.put({ ...r, synced: true })
      } catch {
        // 次回のフラッシュで再試行
      }
    }
  } finally {
    flushing = false
    notify()
    const remaining = await getPendingCount()
    if (remaining > 0) scheduleFlush(8000)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => scheduleFlush(0))
  setInterval(() => {
    void flushQueue()
  }, 15000)
}
