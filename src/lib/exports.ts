// 確定申告（青色申告）準備タブのドメインロジック。
// journal_entries/journal_lines を年単位で集計し、仕訳帳・総勘定元帳・現金出納帳・
// 科目別集計表をCSV化する。期首残高は追跡していないため、当年の増減のみを0円起点で集計する。
import type { Account, JournalEntry } from './accounting'

function csvEscape(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n')
}

// Excel（Windows）で文字化けしないようUTF-8 BOM付きで書き出す
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function sortedAsc(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort(
    (a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at),
  )
}

export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` }
}

// ---------- 仕訳帳 ----------

export function journalBookCsv(entries: JournalEntry[]): string {
  const rows: (string | number)[][] = [['日付', '借方科目', '借方金額', '貸方科目', '貸方金額', '摘要', 'セグメント']]
  for (const e of sortedAsc(entries)) {
    const debits = e.journal_lines.filter((l) => l.side === 'debit')
    const credits = e.journal_lines.filter((l) => l.side === 'credit')
    const n = Math.max(debits.length, credits.length)
    for (let i = 0; i < n; i++) {
      rows.push([
        i === 0 ? e.entry_date : '',
        debits[i]?.accounts.name ?? '',
        debits[i]?.amount ?? '',
        credits[i]?.accounts.name ?? '',
        credits[i]?.amount ?? '',
        i === 0 ? e.description : '',
        i === 0 ? e.segments.name : '',
      ])
    }
  }
  return toCsv(rows)
}

// ---------- 総勘定元帳・現金出納帳（共通: 単一科目の増減＋残高） ----------

export type LedgerRow = { date: string; counterAccount: string; debit: number; credit: number; balance: number; memo: string }

export function accountLedger(entries: JournalEntry[], account: Pick<Account, 'id' | 'type'>): LedgerRow[] {
  const rows: LedgerRow[] = []
  let balance = 0
  const normalSide = account.type === 'asset' || account.type === 'expense' ? 'debit' : 'credit'
  for (const e of sortedAsc(entries)) {
    const lines = e.journal_lines.filter((l) => l.account_id === account.id)
    if (lines.length === 0) continue
    const counterNames = [...new Set(e.journal_lines.filter((l) => l.account_id !== account.id).map((l) => l.accounts.name))]
    for (const l of lines) {
      const signed = l.side === normalSide ? l.amount : -l.amount
      balance += signed
      rows.push({
        date: e.entry_date,
        counterAccount: counterNames.join('/') || e.description,
        debit: l.side === 'debit' ? l.amount : 0,
        credit: l.side === 'credit' ? l.amount : 0,
        balance,
        memo: l.memo || e.description,
      })
    }
  }
  return rows
}

export function generalLedgerCsv(rows: LedgerRow[], accountName: string): string {
  const out: (string | number)[][] = [[`総勘定元帳: ${accountName}`], ['日付', '相手科目', '借方', '貸方', '残高', '摘要']]
  for (const r of rows) out.push([r.date, r.counterAccount, r.debit || '', r.credit || '', r.balance, r.memo])
  return toCsv(out)
}

export function cashBookCsv(rows: LedgerRow[]): string {
  const out: (string | number)[][] = [['日付', '摘要', '収入', '支出', '残高']]
  for (const r of rows) out.push([r.date, r.memo || r.counterAccount, r.debit || '', r.credit || '', r.balance])
  return toCsv(out)
}

// ---------- 科目別集計 ----------

export type AccountSummaryRow = { code: string; name: string; type: Account['type']; debit: number; credit: number; net: number }

export function accountSummary(entries: JournalEntry[], accounts: Account[]): AccountSummaryRow[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const totals = new Map<string, { debit: number; credit: number }>()
  for (const e of entries) {
    for (const l of e.journal_lines) {
      const t = totals.get(l.account_id) ?? { debit: 0, credit: 0 }
      if (l.side === 'debit') t.debit += l.amount
      else t.credit += l.amount
      totals.set(l.account_id, t)
    }
  }
  const rows: AccountSummaryRow[] = []
  for (const [accountId, t] of totals) {
    const a = byId.get(accountId)
    if (!a) continue
    const net = a.type === 'asset' || a.type === 'expense' ? t.debit - t.credit : t.credit - t.debit
    rows.push({ code: a.code, name: a.name, type: a.type, debit: t.debit, credit: t.credit, net })
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code))
}

export function accountSummaryCsv(rows: AccountSummaryRow[]): string {
  const out: (string | number)[][] = [['科目コード', '科目名', '借方合計', '貸方合計', '差引']]
  for (const r of rows) out.push([r.code, r.name, r.debit, r.credit, r.net])
  return toCsv(out)
}

// ---------- 年次チェック ----------

export function unbalancedEntries(entries: JournalEntry[]): JournalEntry[] {
  return entries.filter((e) => {
    const debit = e.journal_lines.filter((l) => l.side === 'debit').reduce((s, l) => s + l.amount, 0)
    const credit = e.journal_lines.filter((l) => l.side === 'credit').reduce((s, l) => s + l.amount, 0)
    return debit !== credit
  })
}

export function monthlyPlatformCheck(
  entries: JournalEntry[],
  segmentCode: string,
  year: number,
): { month: string; done: boolean }[] {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  return months.map((month) => ({
    month,
    done: entries.some(
      (e) => e.source_type === 'platform_revenue' && e.segments.code === segmentCode && e.entry_date.startsWith(month),
    ),
  }))
}
