import { useMemo, useState } from 'react'
import { Wallet, Trash2, Check, AlertTriangle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { ConfirmModal } from '../components/ConfirmModal'
import {
  useSegments,
  useExpenseAccounts,
  useJournalEntries,
  useInvalidateJournal,
  recordExpense,
  recordPlatformRevenue,
  deleteJournalEntry,
  computeSegmentPnl,
  hasPlatformRevenueInMonth,
  entryTotal,
  currentYearMonth,
  monthRange,
  todayStr,
  type JournalEntry,
} from '../lib/accounting'

type Tab = 'expense' | 'revenue' | 'ledger' | 'pnl'

const TABS: { key: Tab; label: string }[] = [
  { key: 'expense', label: '経費入力' },
  { key: 'revenue', label: 'note/YouTube収入' },
  { key: 'ledger', label: '仕訳一覧' },
  { key: 'pnl', label: 'セグメント別P&L' },
]

const PLATFORM_SEGMENT_CODES = ['note', 'youtube']

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function MonthSwitcher({ yearMonth, onChange }: { yearMonth: string; onChange: (ym: string) => void }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-4">
      <button
        onClick={() => onChange(shiftMonth(yearMonth, -1))}
        className="w-9 h-9 rounded-full bg-stone-100 text-stone-600 font-bold active:bg-stone-200"
      >
        ‹
      </button>
      <span className="text-lg font-bold text-stone-900 w-28 text-center">{yearMonth}</span>
      <button
        onClick={() => onChange(shiftMonth(yearMonth, 1))}
        className="w-9 h-9 rounded-full bg-stone-100 text-stone-600 font-bold active:bg-stone-200"
      >
        ›
      </button>
    </div>
  )
}

function SourceBadge({ sourceType }: { sourceType: JournalEntry['source_type'] }) {
  const label = {
    pos_close: 'レジ締め',
    expense: '経費',
    platform_revenue: 'プラットフォーム収入',
    manual: '手動',
    migration: '移行',
  }[sourceType]
  return (
    <span className="text-[10px] text-stone-500 border border-stone-300 rounded-full px-1.5 py-0.5 shrink-0">
      {label}
    </span>
  )
}

export default function AccountingPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const [tab, setTab] = useState<Tab>('expense')
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const range = useMemo(() => monthRange(yearMonth), [yearMonth])

  const { data: segments = [] } = useSegments()
  const { data: expenseAccounts = [] } = useExpenseAccounts()
  const { data: entries = [], isLoading: entriesLoading } = useJournalEntries(range)
  const invalidateJournal = useInvalidateJournal()

  const expenseEntries = entries.filter((e) => e.source_type === 'expense')
  const revenueEntries = entries.filter((e) => e.source_type === 'platform_revenue')
  const pnl = useMemo(() => computeSegmentPnl(entries), [entries])
  const platformSegments = segments.filter((s) => PLATFORM_SEGMENT_CODES.includes(s.code))

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <Wallet className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <h1 className="text-2xl font-bold text-amber-800">コバタロカレー 会計</h1>
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
        <Wallet className="w-6 h-6" /> 会計
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

      <MonthSwitcher yearMonth={yearMonth} onChange={setYearMonth} />

      {entriesLoading && <Spinner />}

      {tab === 'expense' && (
        <ExpenseTab
          segments={segments}
          accounts={expenseAccounts}
          entries={expenseEntries}
          onSaved={invalidateJournal}
        />
      )}
      {tab === 'revenue' && (
        <RevenueTab
          segments={platformSegments}
          allSegments={segments}
          entries={revenueEntries}
          yearMonth={yearMonth}
          onSaved={invalidateJournal}
        />
      )}
      {tab === 'ledger' && <LedgerTab entries={entries} onSaved={invalidateJournal} />}
      {tab === 'pnl' && <PnlTab pnl={pnl} />}
    </div>
  )
}

// ---------- 経費入力 ----------

function ExpenseTab({
  segments,
  accounts,
  entries,
  onSaved,
}: {
  segments: { id: string; code: string; name: string }[]
  accounts: { id: string; code: string; name: string }[]
  entries: JournalEntry[]
  onSaved: () => void
}) {
  const [entryDate, setEntryDate] = useState(todayStr())
  const [segmentId, setSegmentId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank'>('cash')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<JournalEntry | null>(null)

  const segId = segmentId || segments.find((s) => s.code === 'common')?.id || segments[0]?.id || ''
  const acctId = accountId || accounts[0]?.id || ''

  const submit = async () => {
    const amt = Number(amount)
    if (!(amt > 0) || !segId || !acctId) return
    setSaving(true)
    setError(null)
    try {
      await recordExpense({
        entryDate,
        segmentId: segId,
        accountId: acctId,
        amount: amt,
        paymentMethod,
        memo,
      })
      setAmount('')
      setMemo('')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (entryId: string) => {
    await deleteJournalEntry(entryId)
    onSaved()
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-stone-500 mb-1">日付</label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">セグメント</label>
            <select
              value={segId}
              onChange={(e) => setSegmentId(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-3 py-2"
            >
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm text-stone-500 mb-1">科目（カテゴリ）</label>
          <select
            value={acctId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full border border-stone-300 rounded-lg px-3 py-2"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-stone-500 mb-1">金額（円）</label>
            <input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-lg"
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">支払方法</label>
            <div className="flex rounded-lg border border-stone-300 overflow-hidden">
              <button
                onClick={() => setPaymentMethod('cash')}
                className={`flex-1 py-2 text-sm font-semibold ${
                  paymentMethod === 'cash' ? 'bg-amber-700 text-[#faf9f5]' : 'bg-white text-stone-600'
                }`}
              >
                現金
              </button>
              <button
                onClick={() => setPaymentMethod('bank')}
                className={`flex-1 py-2 text-sm font-semibold ${
                  paymentMethod === 'bank' ? 'bg-amber-700 text-[#faf9f5]' : 'bg-white text-stone-600'
                }`}
              >
                口座
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm text-stone-500 mb-1">メモ（任意）</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="仕入れ先・内容など"
            className="w-full border border-stone-300 rounded-lg px-3 py-2"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        <button
          onClick={() => void submit()}
          disabled={saving || !(Number(amount) > 0)}
          className="w-full bg-amber-700 text-[#faf9f5] py-3 rounded-xl font-bold disabled:opacity-40 active:scale-95 transition-transform"
        >
          {saving ? '保存中...' : '経費を記録する'}
        </button>
      </div>

      <div className="space-y-2">
        {entries.length === 0 && <p className="text-center text-stone-400 text-sm py-4">この月の経費はまだありません</p>}
        {entries.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between gap-2 bg-white border border-stone-200 rounded-xl px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-stone-400">{e.entry_date}</span>
                <span className="text-xs text-stone-500">{e.segments.name}</span>
              </div>
              <p className="text-sm text-stone-800 truncate">
                {e.journal_lines.find((l) => l.side === 'debit')?.accounts.name} {e.description && `｜${e.description}`}
              </p>
            </div>
            <span className="font-bold text-stone-900 shrink-0">¥{entryTotal(e, 'debit').toLocaleString()}</span>
            <button onClick={() => setConfirmTarget(e)} className="text-red-400 shrink-0" title="削除">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {confirmTarget && (
        <ConfirmModal
          message={`${confirmTarget.entry_date} の経費「${confirmTarget.description || '記録'}」を削除しますか？\n（元に戻せません）`}
          onConfirm={() => {
            const id = confirmTarget.id
            setConfirmTarget(null)
            void remove(id)
          }}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </div>
  )
}

// ---------- note/YouTube 収入登録 ----------

function RevenueTab({
  segments,
  allSegments,
  entries,
  yearMonth,
  onSaved,
}: {
  segments: { id: string; code: string; name: string }[]
  allSegments: { id: string; code: string; name: string }[]
  entries: JournalEntry[]
  yearMonth: string
  onSaved: () => void
}) {
  const [entryDate, setEntryDate] = useState(todayStr())
  const [segmentId, setSegmentId] = useState('')
  const [gross, setGross] = useState('')
  const [fee, setFee] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<JournalEntry | null>(null)

  const segId = segmentId || segments[0]?.id || ''
  const grossNum = Number(gross) || 0
  const feeNum = Number(fee) || 0
  const netNum = grossNum - feeNum

  const submit = async () => {
    if (!(grossNum > 0) || feeNum < 0 || feeNum > grossNum || !segId) return
    setSaving(true)
    setError(null)
    try {
      await recordPlatformRevenue({ entryDate, segmentId: segId, gross: grossNum, fee: feeNum, memo })
      setGross('')
      setFee('')
      setMemo('')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (entryId: string) => {
    await deleteJournalEntry(entryId)
    onSaved()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1">
        {segments.map((s) => {
          const done = hasPlatformRevenueInMonth(entries, s.code, yearMonth)
          return (
            <div
              key={s.id}
              className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${
                done ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              <span className="flex items-center gap-1">
                {done ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {s.name}の{yearMonth}分
              </span>
              <span>{done ? '入力済み' : '未入力'}</span>
            </div>
          )
        })}
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-stone-500 mb-1">日付</label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">セグメント</label>
            <select
              value={segId}
              onChange={(e) => setSegmentId(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-3 py-2"
            >
              {(segments.length > 0 ? segments : allSegments).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-stone-500 mb-1">売上総額（円・手数料込）</label>
            <input
              type="number"
              inputMode="numeric"
              value={gross}
              onChange={(e) => setGross(e.target.value)}
              placeholder="0"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-lg"
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">手数料（円）</label>
            <input
              type="number"
              inputMode="numeric"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="0"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-lg"
            />
          </div>
        </div>

        <div className="flex items-baseline justify-between bg-stone-50 rounded-lg px-3 py-2">
          <span className="text-stone-500 text-sm">入金額（差引後）</span>
          <span className="font-bold text-stone-900 text-lg">¥{netNum.toLocaleString()}</span>
        </div>

        <div>
          <label className="block text-sm text-stone-500 mb-1">メモ（任意）</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="対象月・備考など"
            className="w-full border border-stone-300 rounded-lg px-3 py-2"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        <button
          onClick={() => void submit()}
          disabled={saving || !(grossNum > 0) || feeNum > grossNum}
          className="w-full bg-amber-700 text-[#faf9f5] py-3 rounded-xl font-bold disabled:opacity-40 active:scale-95 transition-transform"
        >
          {saving ? '保存中...' : '収入を記録する'}
        </button>
      </div>

      <div className="space-y-2">
        {entries.length === 0 && <p className="text-center text-stone-400 text-sm py-4">この月の登録はまだありません</p>}
        {entries.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between gap-2 bg-white border border-stone-200 rounded-xl px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-stone-400">{e.entry_date}</span>
                <span className="text-xs text-stone-500">{e.segments.name}</span>
              </div>
              {e.description && <p className="text-sm text-stone-800 truncate">{e.description}</p>}
            </div>
            <span className="font-bold text-stone-900 shrink-0">¥{entryTotal(e, 'credit').toLocaleString()}</span>
            <button onClick={() => setConfirmTarget(e)} className="text-red-400 shrink-0" title="削除">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {confirmTarget && (
        <ConfirmModal
          message={`${confirmTarget.entry_date} の収入登録「${confirmTarget.description || '記録'}」を削除しますか？\n（元に戻せません）`}
          onConfirm={() => {
            const id = confirmTarget.id
            setConfirmTarget(null)
            void remove(id)
          }}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </div>
  )
}

// ---------- 仕訳一覧 ----------

function LedgerTab({ entries, onSaved }: { entries: JournalEntry[]; onSaved: () => void }) {
  const [confirmTarget, setConfirmTarget] = useState<JournalEntry | null>(null)

  const remove = async (entryId: string) => {
    await deleteJournalEntry(entryId)
    onSaved()
  }

  return (
    <div className="space-y-2">
      {entries.length === 0 && <p className="text-center text-stone-400 text-sm py-4">この月の仕訳はまだありません</p>}
      {entries.map((e) => (
        <div key={e.id} className="bg-white border border-stone-200 rounded-xl px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-stone-400 shrink-0">{e.entry_date}</span>
              <span className="text-xs text-stone-500 shrink-0">{e.segments.name}</span>
              <SourceBadge sourceType={e.source_type} />
            </div>
            {e.source_type !== 'pos_close' && (
              <button onClick={() => setConfirmTarget(e)} className="text-red-400 shrink-0" title="削除">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          {e.description && <p className="text-sm text-stone-600 mb-1">{e.description}</p>}
          <div className="space-y-0.5">
            {e.journal_lines.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-sm">
                <span className={l.side === 'debit' ? 'text-stone-800' : 'text-stone-800 pl-6'}>
                  {l.side === 'credit' && '/ '}
                  {l.accounts.name}
                </span>
                <span className="font-mono text-stone-700">¥{l.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {confirmTarget && (
        <ConfirmModal
          message={`${confirmTarget.entry_date} の仕訳「${confirmTarget.description || confirmTarget.segments.name}」を削除しますか？\n（元に戻せません）`}
          onConfirm={() => {
            const id = confirmTarget.id
            setConfirmTarget(null)
            void remove(id)
          }}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </div>
  )
}

// ---------- セグメント別P&L ----------

function PnlTab({ pnl }: { pnl: { segmentCode: string; segmentName: string; revenue: number; expense: number; profit: number }[] }) {
  const total = pnl.reduce(
    (acc, p) => ({ revenue: acc.revenue + p.revenue, expense: acc.expense + p.expense, profit: acc.profit + p.profit }),
    { revenue: 0, expense: 0, profit: 0 },
  )

  return (
    <div className="space-y-2">
      {pnl.length === 0 && <p className="text-center text-stone-400 text-sm py-4">この月のデータはまだありません</p>}
      {pnl.map((p) => (
        <div key={p.segmentCode} className="bg-white border border-stone-200 rounded-xl px-4 py-3">
          <p className="font-bold text-stone-900 mb-1.5">{p.segmentName}</p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-stone-400">売上</p>
              <p className="font-semibold text-stone-800">¥{p.revenue.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-stone-400">経費</p>
              <p className="font-semibold text-stone-800">¥{p.expense.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-stone-400">利益</p>
              <p className={`font-bold ${p.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                ¥{p.profit.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      ))}
      {pnl.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mt-3">
          <p className="font-bold text-amber-900 mb-1.5">全体合計</p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <p className="text-amber-600">売上</p>
              <p className="font-semibold text-amber-900">¥{total.revenue.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-amber-600">経費</p>
              <p className="font-semibold text-amber-900">¥{total.expense.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-amber-600">利益</p>
              <p className={`font-bold ${total.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                ¥{total.profit.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
