import { useMemo, useState } from 'react'
import { Receipt, Check, AlertTriangle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { useSegments, useAllAccounts, useJournalEntries, type JournalEntry } from '../lib/accounting'
import {
  yearRange,
  journalBookCsv,
  accountLedger,
  generalLedgerCsv,
  cashBookCsv,
  accountSummary,
  accountSummaryCsv,
  unbalancedEntries,
  monthlyPlatformCheck,
  downloadCsv,
  type LedgerRow,
  type AccountSummaryRow,
} from '../lib/exports'

type Tab = 'journal' | 'ledger' | 'cash' | 'summary' | 'check'

const TABS: { key: Tab; label: string }[] = [
  { key: 'journal', label: '仕訳帳' },
  { key: 'ledger', label: '総勘定元帳' },
  { key: 'cash', label: '現金出納帳' },
  { key: 'summary', label: '科目別集計' },
  { key: 'check', label: '年次チェック' },
]

const PLATFORM_SEGMENT_CODES = ['note', 'youtube']

function YearSwitcher({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-4">
      <button
        onClick={() => onChange(year - 1)}
        className="w-9 h-9 rounded-full bg-stone-100 text-stone-600 font-bold active:bg-stone-200"
      >
        ‹
      </button>
      <span className="text-lg font-bold text-stone-900 w-20 text-center">{year}年</span>
      <button
        onClick={() => onChange(year + 1)}
        className="w-9 h-9 rounded-full bg-stone-100 text-stone-600 font-bold active:bg-stone-200"
      >
        ›
      </button>
    </div>
  )
}

function DownloadButton({ onClick, label = 'CSVダウンロード' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="bg-amber-700 text-[#faf9f5] px-4 py-2 rounded-lg text-sm font-semibold active:scale-95 transition-transform"
    >
      ⬇️ {label}
    </button>
  )
}

export default function TaxPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const [tab, setTab] = useState<Tab>('journal')
  const [year, setYear] = useState(new Date().getFullYear())
  const range = useMemo(() => yearRange(year), [year])

  const { data: segments = [] } = useSegments()
  const { data: accounts = [] } = useAllAccounts()
  const { data: entries = [], isLoading } = useJournalEntries(range)

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <Receipt className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <h1 className="text-2xl font-bold text-amber-800">確定申告準備</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-8 py-4 rounded-xl font-semibold text-lg shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-amber-800 mb-3 flex items-center gap-2">
        <Receipt className="w-6 h-6" /> 確定申告準備
      </h1>

      <div className="flex gap-1 mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${
              tab === t.key ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <YearSwitcher year={year} onChange={setYear} />

      {isLoading && <Spinner />}

      {!isLoading && tab === 'journal' && <JournalTab entries={entries} year={year} />}
      {!isLoading && tab === 'ledger' && <LedgerTab entries={entries} accounts={accounts} year={year} />}
      {!isLoading && tab === 'cash' && <CashTab entries={entries} accounts={accounts} year={year} />}
      {!isLoading && tab === 'summary' && <SummaryTab entries={entries} accounts={accounts} year={year} />}
      {!isLoading && tab === 'check' && <CheckTab entries={entries} accounts={accounts} segments={segments} year={year} />}
    </div>
  )
}

// ---------- 仕訳帳 ----------

function JournalTab({ entries, year }: { entries: JournalEntry[]; year: number }) {
  return (
    <div className="space-y-3">
      <DownloadButton onClick={() => downloadCsv(`仕訳帳_${year}.csv`, journalBookCsv(entries))} />
      <p className="text-xs text-stone-400">{entries.length}件の仕訳（{year}年）</p>
      <div className="border border-stone-200 rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-stone-50 text-stone-500">
            <tr>
              <th className="text-left px-2 py-1.5 font-medium">日付</th>
              <th className="text-left px-2 py-1.5 font-medium">借方</th>
              <th className="text-right px-2 py-1.5 font-medium">金額</th>
              <th className="text-left px-2 py-1.5 font-medium">貸方</th>
              <th className="text-right px-2 py-1.5 font-medium">金額</th>
              <th className="text-left px-2 py-1.5 font-medium">摘要</th>
            </tr>
          </thead>
          <tbody>
            {[...entries]
              .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
              .map((e) =>
                e.journal_lines
                  .filter((l) => l.side === 'debit')
                  .map((d, i) => {
                    const c = e.journal_lines.filter((l) => l.side === 'credit')[i]
                    return (
                      <tr key={`${e.id}-${i}`} className="border-t border-stone-100">
                        <td className="px-2 py-1.5 text-stone-500">{i === 0 ? e.entry_date : ''}</td>
                        <td className="px-2 py-1.5 text-stone-800">{d.accounts.name}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{d.amount.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-stone-800">{c?.accounts.name ?? ''}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{c ? c.amount.toLocaleString() : ''}</td>
                        <td className="px-2 py-1.5 text-stone-500 truncate max-w-[8rem]">
                          {i === 0 ? e.description : ''}
                        </td>
                      </tr>
                    )
                  }),
              )}
          </tbody>
        </table>
        {entries.length === 0 && <p className="text-center text-stone-400 text-sm py-6">{year}年の仕訳はありません</p>}
      </div>
    </div>
  )
}

// ---------- 総勘定元帳 ----------

function LedgerRowsTable({ rows }: { rows: LedgerRow[] }) {
  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-stone-50 text-stone-500">
          <tr>
            <th className="text-left px-2 py-1.5 font-medium">日付</th>
            <th className="text-left px-2 py-1.5 font-medium">相手科目</th>
            <th className="text-right px-2 py-1.5 font-medium">借方</th>
            <th className="text-right px-2 py-1.5 font-medium">貸方</th>
            <th className="text-right px-2 py-1.5 font-medium">残高</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-stone-100">
              <td className="px-2 py-1.5 text-stone-500">{r.date}</td>
              <td className="px-2 py-1.5 text-stone-800 truncate max-w-[8rem]">{r.counterAccount}</td>
              <td className="px-2 py-1.5 text-right font-mono">{r.debit ? r.debit.toLocaleString() : ''}</td>
              <td className="px-2 py-1.5 text-right font-mono">{r.credit ? r.credit.toLocaleString() : ''}</td>
              <td className="px-2 py-1.5 text-right font-mono font-semibold">{r.balance.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-center text-stone-400 text-sm py-6">該当する記帳はありません</p>}
    </div>
  )
}

function LedgerTab({
  entries,
  accounts,
  year,
}: {
  entries: JournalEntry[]
  accounts: { id: string; code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' }[]
  year: number
}) {
  const [accountId, setAccountId] = useState('')
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0]
  const rows = useMemo(() => (account ? accountLedger(entries, account) : []), [entries, account])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={account?.id ?? ''}
          onChange={(e) => setAccountId(e.target.value)}
          className="flex-1 border border-stone-300 rounded-lg px-3 py-2 text-sm"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {a.name}
            </option>
          ))}
        </select>
      </div>
      {account && (
        <DownloadButton
          onClick={() => downloadCsv(`総勘定元帳_${account.name}_${year}.csv`, generalLedgerCsv(rows, account.name))}
        />
      )}
      <LedgerRowsTable rows={rows} />
    </div>
  )
}

// ---------- 現金出納帳 ----------

function CashTab({
  entries,
  accounts,
  year,
}: {
  entries: JournalEntry[]
  accounts: { id: string; code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' }[]
  year: number
}) {
  const cashAccount = accounts.find((a) => a.code === '101')
  const rows = useMemo(() => (cashAccount ? accountLedger(entries, cashAccount) : []), [entries, cashAccount])

  if (!cashAccount) return <p className="text-center text-stone-400 text-sm py-6">現金科目が見つかりません</p>

  return (
    <div className="space-y-3">
      <DownloadButton onClick={() => downloadCsv(`現金出納帳_${year}.csv`, cashBookCsv(rows))} />
      <p className="text-xs text-stone-400">期首残高0円起点の当年増減（前年繰越は含みません）</p>
      <LedgerRowsTable rows={rows} />
    </div>
  )
}

// ---------- 科目別集計 ----------

function SummaryTab({
  entries,
  accounts,
  year,
}: {
  entries: JournalEntry[]
  accounts: { id: string; code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'; sort_order: number }[]
  year: number
}) {
  const rows = useMemo(() => accountSummary(entries, accounts), [entries, accounts])
  const groups: { label: string; types: AccountSummaryRow['type'][] }[] = [
    { label: '資産・負債・純資産', types: ['asset', 'liability', 'equity'] },
    { label: '収益', types: ['revenue'] },
    { label: '費用', types: ['expense'] },
  ]

  return (
    <div className="space-y-4">
      <DownloadButton onClick={() => downloadCsv(`科目別集計_${year}.csv`, accountSummaryCsv(rows))} />
      {groups.map((g) => {
        const grows = rows.filter((r) => g.types.includes(r.type))
        if (grows.length === 0) return null
        return (
          <div key={g.label}>
            <p className="text-xs text-stone-400 mb-1">{g.label}</p>
            <div className="border border-stone-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {grows.map((r) => (
                    <tr key={r.code} className="border-t border-stone-100 first:border-t-0">
                      <td className="px-3 py-1.5 text-stone-800">
                        {r.code} {r.name}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold">¥{r.net.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
      {rows.length === 0 && <p className="text-center text-stone-400 text-sm py-6">{year}年のデータはありません</p>}
    </div>
  )
}

// ---------- 年次チェック ----------

function CheckTab({
  entries,
  accounts,
  segments,
  year,
}: {
  entries: JournalEntry[]
  accounts: { id: string; code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' }[]
  segments: { id: string; code: string; name: string }[]
  year: number
}) {
  const unbalanced = useMemo(() => unbalancedEntries(entries), [entries])
  const platformSegments = segments.filter((s) => PLATFORM_SEGMENT_CODES.includes(s.code))
  const cashAccount = accounts.find((a) => a.code === '101')
  const bankAccount = accounts.find((a) => a.code === '102')
  const cashBalance = cashAccount ? accountLedger(entries, cashAccount).at(-1)?.balance ?? 0 : 0
  const bankBalance = bankAccount ? accountLedger(entries, bankAccount).at(-1)?.balance ?? 0 : 0
  const totalDebit = entries.reduce(
    (s, e) => s + e.journal_lines.filter((l) => l.side === 'debit').reduce((a, l) => a + l.amount, 0),
    0,
  )
  const totalCredit = entries.reduce(
    (s, e) => s + e.journal_lines.filter((l) => l.side === 'credit').reduce((a, l) => a + l.amount, 0),
    0,
  )

  return (
    <div className="space-y-5">
      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <p className="font-bold text-stone-900 mb-2">貸借一致チェック</p>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-stone-500">借方合計</span>
          <span className="font-mono">¥{totalDebit.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-stone-500">貸方合計</span>
          <span className="font-mono">¥{totalCredit.toLocaleString()}</span>
        </div>
        {totalDebit === totalCredit && unbalanced.length === 0 ? (
          <p className="text-green-600 text-sm font-semibold flex items-center gap-1">
            <Check className="w-4 h-4" /> 一致しています
          </p>
        ) : (
          <div className="text-red-600 text-sm font-semibold space-y-1">
            <p className="flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" /> 不一致の仕訳が {unbalanced.length} 件あります
            </p>
            {unbalanced.map((e) => (
              <p key={e.id} className="font-normal text-stone-600">
                {e.entry_date} {e.description}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <p className="font-bold text-stone-900 mb-2">{year}年末 残高</p>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-stone-500">現金</span>
          <span className="font-mono font-semibold">¥{cashBalance.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-stone-500">普通預金</span>
          <span className="font-mono font-semibold">¥{bankBalance.toLocaleString()}</span>
        </div>
        <p className="text-[11px] text-stone-400 mt-2">前年繰越を含まない当年増減ベースです</p>
      </div>

      {platformSegments.map((s) => {
        const months = monthlyPlatformCheck(entries, s.code, year)
        const missing = months.filter((m) => !m.done)
        return (
          <div key={s.id} className="bg-white border border-stone-200 rounded-xl p-4">
            <p className="font-bold text-stone-900 mb-2">{s.name} 月次収入 入力状況</p>
            <div className="grid grid-cols-6 gap-1.5">
              {months.map((m) => (
                <div
                  key={m.month}
                  className={`text-center rounded-lg py-1.5 text-xs font-semibold ${
                    m.done ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {m.month.slice(5)}月
                  <br />
                  {m.done ? <Check className="w-3.5 h-3.5 inline" /> : <AlertTriangle className="w-3.5 h-3.5 inline" />}
                </div>
              ))}
            </div>
            {missing.length > 0 && (
              <p className="text-xs text-amber-700 mt-2">{missing.length}ヶ月分が未入力です</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
