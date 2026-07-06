import { describe, it, expect } from 'vitest'
import {
  journalBookCsv,
  accountLedger,
  accountSummary,
  unbalancedEntries,
  monthlyPlatformCheck,
  toCsv,
} from './exports'
import type { Account, JournalEntry } from './accounting'

const cash: Account = { id: 'acc-cash', code: '101', name: '現金', type: 'asset', sort_order: 101 }
const sales: Account = { id: 'acc-sales', code: '401', name: '売上高', type: 'revenue', sort_order: 401 }
const purchase: Account = { id: 'acc-purchase', code: '501', name: '仕入高', type: 'expense', sort_order: 501 }
const accounts = [cash, sales, purchase]

const segMagari = { code: 'magari', name: '間借り営業' }

function entry(partial: Partial<JournalEntry> & Pick<JournalEntry, 'entry_date' | 'journal_lines'>): JournalEntry {
  return {
    id: crypto.randomUUID(),
    description: '',
    segment_id: 'seg-magari',
    source_type: 'manual',
    source_id: null,
    created_at: partial.entry_date + 'T00:00:00Z',
    segments: segMagari,
    ...partial,
  }
}

function line(account: Account, side: 'debit' | 'credit', amount: number): JournalEntry['journal_lines'][number] {
  return { id: crypto.randomUUID(), account_id: account.id, side, amount, memo: '', accounts: account }
}

// 1日目: 売上1000円（現金入金）、2日目: 仕入300円（現金支払）
const entries: JournalEntry[] = [
  entry({
    entry_date: '2026-01-01',
    description: '売上',
    journal_lines: [line(cash, 'debit', 1000), line(sales, 'credit', 1000)],
  }),
  entry({
    entry_date: '2026-01-02',
    description: '仕入',
    journal_lines: [line(purchase, 'debit', 300), line(cash, 'credit', 300)],
  }),
]

describe('journalBookCsv', () => {
  it('日付昇順で借方/貸方を1行にまとめる', () => {
    const csv = journalBookCsv(entries)
    const rows = csv.split('\r\n')
    expect(rows[0]).toBe('日付,借方科目,借方金額,貸方科目,貸方金額,摘要,セグメント')
    expect(rows[1]).toBe('2026-01-01,現金,1000,売上高,1000,売上,間借り営業')
    expect(rows[2]).toBe('2026-01-02,仕入高,300,現金,300,仕入,間借り営業')
  })
})

describe('accountLedger', () => {
  it('現金（資産）は借方で残高が増え、貸方で減る', () => {
    const rows = accountLedger(entries, cash)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ debit: 1000, credit: 0, balance: 1000 })
    expect(rows[1]).toMatchObject({ debit: 0, credit: 300, balance: 700 })
  })

  it('売上高（収益）は貸方で残高が増える', () => {
    const rows = accountLedger(entries, sales)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ debit: 0, credit: 1000, balance: 1000 })
  })
})

describe('accountSummary', () => {
  it('科目ごとの借方/貸方合計と差引を出す', () => {
    const rows = accountSummary(entries, accounts)
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]))
    expect(byCode['101']).toMatchObject({ debit: 1000, credit: 300, net: 700 })
    expect(byCode['401']).toMatchObject({ debit: 0, credit: 1000, net: 1000 })
    expect(byCode['501']).toMatchObject({ debit: 300, credit: 0, net: 300 })
  })
})

describe('unbalancedEntries', () => {
  it('貸借が一致していれば空配列', () => {
    expect(unbalancedEntries(entries)).toEqual([])
  })

  it('貸借が不一致な仕訳を検出する', () => {
    const broken = entry({
      entry_date: '2026-01-03',
      journal_lines: [line(purchase, 'debit', 500), line(cash, 'credit', 400)],
    })
    expect(unbalancedEntries([...entries, broken])).toHaveLength(1)
  })
})

describe('monthlyPlatformCheck', () => {
  it('platform_revenue が記録された月をdone扱いする', () => {
    const revenueEntry = entry({
      entry_date: '2026-03-15',
      source_type: 'platform_revenue',
      segments: { code: 'note', name: 'note' },
      journal_lines: [line(cash, 'debit', 2000), line(sales, 'credit', 2000)],
    })
    const months = monthlyPlatformCheck([revenueEntry], 'note', 2026)
    expect(months).toHaveLength(12)
    expect(months.find((m) => m.month === '2026-03')?.done).toBe(true)
    expect(months.find((m) => m.month === '2026-04')?.done).toBe(false)
  })
})

describe('toCsv', () => {
  it('カンマ・改行を含む値をダブルクォートでエスケープする', () => {
    expect(toCsv([['a,b', 'c"d', 'plain']])).toBe('"a,b","c""d",plain')
  })
})
