// 会計タブのドメインロジック。
// ユーザーには複式簿記を見せない: 経費フォーム/収入登録フォームの入力を
// record_expense / record_platform_revenue RPC に渡すと、裏側で仕訳(journal_entries
// + journal_lines)が自動生成される。ここでは取得・集計・フォーム送信のみを扱う。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
export type Segment = { id: string; code: string; name: string; sort_order: number }
export type Account = { id: string; code: string; name: string; type: AccountType; sort_order: number }

export type JournalLine = {
  id: string
  account_id: string
  side: 'debit' | 'credit'
  amount: number
  memo: string
  accounts: { code: string; name: string; type: AccountType }
}

export type JournalEntry = {
  id: string
  entry_date: string
  description: string
  segment_id: string
  source_type: 'pos_close' | 'expense' | 'platform_revenue' | 'manual' | 'migration'
  source_id: string | null
  created_at: string
  segments: { code: string; name: string }
  journal_lines: JournalLine[]
}

// ---------- マスタ ----------

export async function fetchSegments(): Promise<Segment[]> {
  const { data, error } = await supabase
    .from('segments')
    .select('id, code, name, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}
export function useSegments() {
  return useQuery({ queryKey: ['segments'], queryFn: fetchSegments, staleTime: 5 * 60_000 })
}

export async function fetchAccounts(type?: AccountType): Promise<Account[]> {
  let query = supabase.from('accounts').select('id, code, name, type, sort_order').eq('active', true)
  if (type) query = query.eq('type', type)
  const { data, error } = await query.order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}
export function useExpenseAccounts() {
  return useQuery({ queryKey: ['accounts', 'expense'], queryFn: () => fetchAccounts('expense'), staleTime: 5 * 60_000 })
}
export function useAllAccounts() {
  return useQuery({ queryKey: ['accounts', 'all'], queryFn: () => fetchAccounts(), staleTime: 5 * 60_000 })
}

// ---------- 仕訳一覧 ----------

const JOURNAL_SELECT =
  'id, entry_date, description, segment_id, source_type, source_id, created_at, ' +
  'segments(code, name), journal_lines(id, account_id, side, amount, memo, accounts(code, name, type))'

export async function fetchJournalEntries(range: { from: string; to: string }): Promise<JournalEntry[]> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select(JOURNAL_SELECT)
    .gte('entry_date', range.from)
    .lte('entry_date', range.to)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as JournalEntry[]
}

export function useJournalEntries(range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['journal', range.from, range.to],
    queryFn: () => fetchJournalEntries(range),
    staleTime: 30_000,
  })
}

export function entryTotal(entry: JournalEntry, side: 'debit' | 'credit'): number {
  return entry.journal_lines.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0)
}

// ---------- 経費入力 ----------

export type RecordExpenseParams = {
  id?: string // 訂正時は既存の仕訳のsource_idを渡す
  entryDate: string
  segmentId: string
  accountId: string
  amount: number
  paymentMethod: 'cash' | 'bank'
  memo?: string
}

export async function recordExpense(params: RecordExpenseParams): Promise<string> {
  const id = params.id ?? crypto.randomUUID()
  const { error } = await supabase.rpc('record_expense', {
    p_id: id,
    p_entry_date: params.entryDate,
    p_segment_id: params.segmentId,
    p_account_id: params.accountId,
    p_amount: params.amount,
    p_payment_method: params.paymentMethod,
    p_memo: params.memo ?? '',
  })
  if (error) throw error
  return id
}

// ---------- note/YouTube 収入登録 ----------

export type RecordPlatformRevenueParams = {
  id?: string
  entryDate: string
  segmentId: string
  gross: number
  fee: number
  memo?: string
}

export async function recordPlatformRevenue(params: RecordPlatformRevenueParams): Promise<string> {
  const id = params.id ?? crypto.randomUUID()
  const { error } = await supabase.rpc('record_platform_revenue', {
    p_id: id,
    p_entry_date: params.entryDate,
    p_segment_id: params.segmentId,
    p_gross: params.gross,
    p_fee: params.fee,
    p_memo: params.memo ?? '',
  })
  if (error) throw error
  return id
}

// ---------- 削除 ----------

export async function deleteJournalEntry(entryId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_journal_entry', { p_entry_id: entryId })
  if (error) throw error
}

// ---------- 集計（セグメント別P&L） ----------

export type SegmentPnl = { segmentCode: string; segmentName: string; revenue: number; expense: number; profit: number }

export function computeSegmentPnl(entries: JournalEntry[]): SegmentPnl[] {
  const bySegment = new Map<string, SegmentPnl>()
  for (const entry of entries) {
    const code = entry.segments.code
    const existing = bySegment.get(code) ?? {
      segmentCode: code,
      segmentName: entry.segments.name,
      revenue: 0,
      expense: 0,
      profit: 0,
    }
    for (const line of entry.journal_lines) {
      if (line.accounts.type === 'revenue') {
        existing.revenue += line.side === 'credit' ? line.amount : -line.amount
      } else if (line.accounts.type === 'expense') {
        existing.expense += line.side === 'debit' ? line.amount : -line.amount
      }
    }
    existing.profit = existing.revenue - existing.expense
    bySegment.set(code, existing)
  }
  return [...bySegment.values()].sort((a, b) => b.revenue - a.revenue)
}

// ---------- 月次チェック ----------

export function hasPlatformRevenueInMonth(entries: JournalEntry[], segmentCode: string, yearMonth: string): boolean {
  return entries.some(
    (e) =>
      e.source_type === 'platform_revenue' &&
      e.segments.code === segmentCode &&
      e.entry_date.startsWith(yearMonth),
  )
}

// ---------- 日付ユーティリティ ----------

export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function currentYearMonth(): string {
  return todayStr().slice(0, 7)
}

export function monthRange(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split('-').map(Number)
  const from = `${yearMonth}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${yearMonth}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

export function useInvalidateJournal() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['journal'] })
}
