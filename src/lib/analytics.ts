// ダッシュボード（分析）のドメインロジック。
// 実費ベースのP&Lは会計タブ（accounting.ts）が担うため、ここでは
// レジの実績データ（sales_sessions/receipts/receipt_lines）と
// レシピの理論原価から、売上推移・客単価・商品別分析・仕込み予測のみを扱う。
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export type ClosedSession = {
  id: string
  session_date: string
  segment_id: string
  groups: number
  people: number
  reserved_people: number
  rent: number
  other_cost: number
  memo: string
  segments: { code: string; name: string }
}

export async function fetchClosedSessions(): Promise<ClosedSession[]> {
  const { data, error } = await supabase
    .from('sales_sessions')
    .select('id, session_date, segment_id, groups, people, reserved_people, rent, other_cost, memo, segments(code, name)')
    .eq('status', 'closed')
    .order('session_date', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as ClosedSession[]
}
export function useClosedSessions() {
  return useQuery({ queryKey: ['analytics', 'sessions'], queryFn: fetchClosedSessions, staleTime: 60_000 })
}

export type ReceiptLineRow = {
  session_id: string
  menu_id: string | null
  name_snapshot: string
  qty: number
  unit_price: number
}

// voided でないレシートの明細のみ、session_id 付きで取得
export async function fetchReceiptLines(): Promise<ReceiptLineRow[]> {
  const { data, error } = await supabase
    .from('receipts')
    .select('session_id, voided, receipt_lines(menu_id, name_snapshot, qty, unit_price)')
    .eq('voided', false)
  if (error) throw error
  const rows: ReceiptLineRow[] = []
  for (const r of (data ?? []) as unknown as { session_id: string; receipt_lines: Omit<ReceiptLineRow, 'session_id'>[] }[]) {
    for (const l of r.receipt_lines) {
      rows.push({ session_id: r.session_id, ...l })
    }
  }
  return rows
}
export function useReceiptLines() {
  return useQuery({ queryKey: ['analytics', 'receipt_lines'], queryFn: fetchReceiptLines, staleTime: 60_000 })
}

export function salesBySession(lines: ReceiptLineRow[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const l of lines) {
    map[l.session_id] = (map[l.session_id] ?? 0) + l.qty * l.unit_price
  }
  return map
}

export function daysAgoStr(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}
