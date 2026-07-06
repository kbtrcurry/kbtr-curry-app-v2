import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import {
  localSessions,
  localReceipts,
  type LocalSessionRow,
  type LocalReceiptRow,
} from './offlineDb'
import { flushQueue, getPendingCount, scheduleFlush, subscribeQueue } from './offlineQueue'

export type Menu = { id: string; name: string; price: number; active: boolean; sort_order: number }

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const SESSION_KEY = (date: string) => `kbtr_v2_session_${date}`
const segCacheKey = (code: string) => `kbtr_v2_segment_${code}`

// ---------- メニュー ----------

export async function fetchActiveMenus(): Promise<Menu[]> {
  const { data, error } = await supabase
    .from('menus')
    .select('id, name, price, active, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

export function useActiveMenus() {
  return useQuery({ queryKey: ['menus', 'active'], queryFn: fetchActiveMenus, staleTime: 60_000 })
}

// ---------- セグメント（コードは変わらない前提でローカルにキャッシュ） ----------

async function fetchSegmentId(code: string): Promise<string> {
  try {
    const { data, error } = await supabase.from('segments').select('id').eq('code', code).single()
    if (error) throw error
    localStorage.setItem(segCacheKey(code), data.id)
    return data.id
  } catch (e) {
    const cached = localStorage.getItem(segCacheKey(code))
    if (cached) return cached
    throw e
  }
}

// ---------- 営業セッション（1日1営業） ----------

export async function getOrCreateTodaySession(segmentCode = 'magari'): Promise<LocalSessionRow> {
  const date = todayStr()
  const cachedId = localStorage.getItem(SESSION_KEY(date))
  if (cachedId) {
    const local = await localSessions.get(cachedId)
    if (local && local.status === 'open') return local
  }

  // オンラインなら既存のオープン中セッションを優先的に再利用（多端末対策）
  try {
    const { data, error } = await supabase
      .from('sales_sessions')
      .select('id, session_date, segment_id, status')
      .eq('session_date', date)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!error && data) {
      const row: LocalSessionRow = { ...data, synced: true }
      await localSessions.put(row)
      localStorage.setItem(SESSION_KEY(date), row.id)
      return row
    }
  } catch {
    /* オフライン等。ローカル新規作成にフォールバック */
  }

  const segmentId = await fetchSegmentId(segmentCode)
  const row: LocalSessionRow = {
    id: crypto.randomUUID(),
    session_date: date,
    segment_id: segmentId,
    status: 'open',
    synced: false,
  }
  await localSessions.put(row)
  localStorage.setItem(SESSION_KEY(date), row.id)
  scheduleFlush(0)
  return row
}

export function useTodaySession() {
  return useQuery({
    queryKey: ['pos', 'today-session'],
    queryFn: () => getOrCreateTodaySession('magari'),
    staleTime: Infinity,
  })
}

// ---------- 会計（レシート） ----------

export async function fetchLocalReceipts(sessionId: string): Promise<LocalReceiptRow[]> {
  const all = await localReceipts.getAll()
  return all
    .filter((r) => r.sessionId === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export type NewReceiptLine = { menuId: string | null; nameSnapshot: string; qty: number; unitPrice: number }

export async function addReceipt(
  session: LocalSessionRow,
  params: { lines: NewReceiptLine[]; total: number; received: number; people: number },
): Promise<LocalReceiptRow> {
  const receipt: LocalReceiptRow = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    total: params.total,
    received: params.received,
    people: params.people,
    voided: false,
    createdAt: new Date().toISOString(),
    lines: params.lines.map((l) => ({ id: crypto.randomUUID(), ...l })),
    synced: false,
  }
  await localReceipts.put(receipt)
  scheduleFlush(0)
  return receipt
}

export async function voidReceipt(receipt: LocalReceiptRow): Promise<void> {
  await localReceipts.put({ ...receipt, voided: true, synced: false })
  scheduleFlush(0)
}

export function useTodayReceipts(sessionId: string | undefined) {
  const [receipts, setReceipts] = useState<LocalReceiptRow[]>([])
  const refresh = useCallback(() => {
    if (!sessionId) return
    void fetchLocalReceipts(sessionId).then(setReceipts)
  }, [sessionId])
  useEffect(() => {
    refresh()
  }, [refresh])
  useEffect(() => subscribeQueue(refresh), [refresh])
  return { receipts, refresh }
}

export function usePendingCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let mounted = true
    const update = () => {
      void getPendingCount().then((c) => {
        if (mounted) setCount(c)
      })
    }
    update()
    const unsub = subscribeQueue(update)
    const id = setInterval(update, 5000)
    return () => {
      mounted = false
      unsub()
      clearInterval(id)
    }
  }, [])
  return count
}

// ---------- 締め ----------

export type CloseParams = {
  rent: number
  otherCost: number
  groups: number
  people: number
  reservedPeople: number
  memo: string
}

export type CloseResult =
  | { ok: true }
  | { ok: false; reason: 'pending'; pendingCount: number }
  | { ok: false; reason: 'error'; message: string }

export async function closeTodaySession(
  session: LocalSessionRow,
  params: CloseParams,
): Promise<CloseResult> {
  await flushQueue()
  const pending = await getPendingCount()
  if (pending > 0) return { ok: false, reason: 'pending', pendingCount: pending }

  try {
    const { error } = await supabase.rpc('close_session', {
      p_session_id: session.id,
      p_rent: params.rent,
      p_other_cost: params.otherCost,
      p_groups: params.groups,
      p_people: params.people,
      p_reserved_people: params.reservedPeople,
      p_memo: params.memo,
    })
    if (error) throw error

    const date = todayStr()
    localStorage.removeItem(SESSION_KEY(date))
    const receipts = await fetchLocalReceipts(session.id)
    for (const r of receipts) await localReceipts.delete(r.id)
    await localSessions.delete(session.id)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : '締め処理に失敗しました' }
  }
}

export { flushQueue, getPendingCount }
