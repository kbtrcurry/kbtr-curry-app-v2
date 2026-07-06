import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { usePersistedState } from '../lib/persistState'
import { useKeyboardOffset } from '../lib/useKeyboardOffset'
import { useRegisterBack } from '../lib/backHandler'
import {
  useActiveMenus,
  useTodaySession,
  useTodayReceipts,
  usePendingCount,
  addReceipt,
  voidReceipt,
  closeTodaySession,
} from '../lib/pos'

type CartItem = { menuId: string | null; name: string; price: number; qty: number }
type ManualItem = { id: string; price: number }

const QUICK_AMOUNTS = [1000, 5000, 10000]
const MANUAL_LABEL = '金額入力'

// Airレジ風テンキー。fill=true で利用可能な高さいっぱいに広がる
function Numpad({ onKey, fill = false }: { onKey: (k: string) => void; fill?: boolean }) {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '⌫']
  return (
    <div
      className={`grid grid-cols-3 gap-px bg-stone-200 rounded-2xl overflow-hidden ${fill ? 'flex-1 min-h-0 grid-rows-4' : ''}`}
    >
      {keys.map((k) => (
        <button
          key={k}
          onClick={() => onKey(k)}
          className={`bg-white text-stone-900 text-3xl md:text-4xl font-medium tracking-tight flex items-center justify-center active:bg-stone-100 transition-colors ${
            fill ? 'min-h-0' : 'py-5'
          }`}
        >
          {k === '⌫' ? <span className="text-2xl md:text-3xl text-stone-500">⌫</span> : k}
        </button>
      ))}
    </div>
  )
}

export default function PosPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const { data: menus = [], isLoading: menusLoading } = useActiveMenus()
  const { data: posSession } = useTodaySession()
  const { receipts, refresh } = useTodayReceipts(posSession?.id)
  const pendingCount = usePendingCount()

  const [qty, setQty] = usePersistedState<Record<string, number>>('kbtr_v2_pos_qty', {})
  const [manualItems, setManualItems] = usePersistedState<ManualItem[]>('kbtr_v2_pos_manual', [])
  const [step, setStep] = usePersistedState<'select' | 'pay' | 'change'>('kbtr_v2_pos_step', 'select')
  const [received, setReceived] = usePersistedState('kbtr_v2_pos_received', '')
  const [people, setPeople] = usePersistedState<number>('kbtr_v2_pos_people', 1)

  const [manualOpen, setManualOpen] = useState(false)
  const [manualVal, setManualVal] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [submittingReceipt, setSubmittingReceipt] = useState(false)

  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [locationFee, setLocationFee] = useState('5000')
  const [otherCost, setOtherCost] = useState('')
  const [reserved, setReserved] = useState('')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const kbOffset = useKeyboardOffset()

  useRegisterBack(() => {
    if (manualOpen) {
      setManualOpen(false)
      return true
    }
    if (closing) {
      setClosing(false)
      setCloseError(null)
      return true
    }
    if (step === 'change') {
      setStep('pay')
      return true
    }
    if (step === 'pay') {
      setStep('select')
      return true
    }
    return false
  })

  const activeReceipts = receipts.filter((r) => !r.voided)
  const dayTotal = activeReceipts.reduce((s, r) => s + r.total, 0)

  const setCount = (menuId: string, delta: number) => {
    setQty((prev) => ({ ...prev, [menuId]: Math.max(0, (prev[menuId] ?? 0) + delta) }))
  }

  const cart: CartItem[] = [
    ...menus
      .filter((m) => (qty[m.id] ?? 0) > 0)
      .map((m) => ({ menuId: m.id, name: m.name, price: m.price, qty: qty[m.id] })),
    ...manualItems.map((mi) => ({ menuId: null, name: MANUAL_LABEL, price: mi.price, qty: 1 })),
  ]
  const cartTotal = cart.reduce((s, it) => s + it.price * it.qty, 0)
  const cartCount = cart.reduce((s, it) => s + it.qty, 0)

  const receivedNum = Number(received) || 0
  const change = receivedNum - cartTotal

  const pressReceived = (k: string) =>
    setReceived((v) => (k === '⌫' ? v.slice(0, -1) : v + (k === '00' ? '00' : k)))
  const addReceived = (amt: number) => setReceived((v) => String((Number(v) || 0) + amt))
  const pressManual = (k: string) =>
    setManualVal((v) => (k === '⌫' ? v.slice(0, -1) : v + (k === '00' ? '00' : k)))

  const addManual = () => {
    const p = Number(manualVal) || 0
    if (p <= 0) return
    setManualItems((prev) => [...prev, { id: crypto.randomUUID(), price: p }])
    setManualOpen(false)
    setManualVal('')
  }

  const handleNextAccount = async () => {
    if (!posSession) return
    setSubmittingReceipt(true)
    try {
      await addReceipt(posSession, {
        lines: cart.map((it) => ({
          menuId: it.menuId,
          nameSnapshot: it.name,
          qty: it.qty,
          unitPrice: it.price,
        })),
        total: cartTotal,
        received: receivedNum,
        people: Math.max(1, people),
      })
      refresh()
      setQty({})
      setManualItems([])
      setReceived('')
      setPeople(1)
      setStep('select')
    } finally {
      setSubmittingReceipt(false)
    }
  }

  const handleVoid = async (id: string) => {
    const r = receipts.find((x) => x.id === id)
    if (!r) return
    await voidReceipt(r)
    refresh()
  }

  const openClosing = () => {
    setCloseError(null)
    setClosing(true)
  }

  const handleClose = async () => {
    if (!posSession) return
    setSubmitting(true)
    setCloseError(null)
    try {
      const groups = activeReceipts.length
      const totalPeople = activeReceipts.reduce((a, r) => a + (r.people ?? 1), 0)
      const result = await closeTodaySession(posSession, {
        rent: Number(locationFee) || 0,
        otherCost: Number(otherCost) || 0,
        groups,
        people: totalPeople,
        reservedPeople: Number(reserved) || 0,
        memo,
      })
      if (!result.ok) {
        if (result.reason === 'pending') {
          setCloseError(
            `未送信のデータが ${result.pendingCount} 件あります。通信状態の良い場所でもう一度お試しください。`,
          )
        } else {
          setCloseError(result.message)
        }
        return
      }
      setLocationFee('5000')
      setOtherCost('')
      setReserved('')
      setMemo('')
      setClosing(false)
      setDone(true)
      refresh()
      setTimeout(() => setDone(false), 3000)
    } finally {
      setSubmitting(false)
    }
  }

  // ── 未ログイン ──
  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <div className="text-6xl">🍛</div>
        <h1 className="text-2xl font-bold text-amber-800">コバタロカレー レジ</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-8 py-4 rounded-xl font-semibold text-lg shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  // ── 預り金入力（電卓） ──
  if (step === 'pay') {
    return (
      <div
        className="fixed inset-0 z-50 bg-[#191817] flex justify-center overflow-hidden"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
        }}
      >
        <div className="flex flex-col w-full min-h-0 px-4 max-w-md md:max-w-3xl lg:max-w-5xl">
          <div className="flex items-center mb-2 shrink-0">
            <button onClick={() => setStep('select')} className="text-stone-500 py-1 md:text-lg">
              ← 戻る
            </button>
          </div>

          <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-2 md:auto-rows-fr md:gap-8 md:items-stretch">
            <div className="flex flex-col shrink-0 md:justify-start md:gap-3 md:self-start md:w-full">
              <div className="rounded-2xl bg-[#191817] border border-stone-300 overflow-hidden mb-2 md:mb-0 shrink-0">
                <div className="flex items-baseline justify-between px-4 py-2.5 md:py-4">
                  <span className="text-stone-500 text-sm md:text-lg">お会計（{cartCount}点）</span>
                  <span className="text-2xl md:text-4xl font-bold text-stone-900">
                    ¥{cartTotal.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-baseline justify-between px-4 py-2.5 md:py-4 border-t border-stone-300">
                  <span className="text-stone-500 text-sm md:text-lg">お預かり</span>
                  <span className="text-4xl md:text-6xl font-bold text-stone-900 tracking-tight">
                    ¥{receivedNum.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-baseline justify-between px-4 py-2.5 md:py-4 border-t border-stone-300">
                  <span className="text-stone-500 text-sm md:text-lg">おつり</span>
                  <span
                    className={`text-3xl md:text-5xl font-bold tracking-tight ${
                      received === '' ? 'text-stone-300' : change < 0 ? 'text-red-500' : 'text-green-600'
                    }`}
                  >
                    {received === ''
                      ? '—'
                      : change < 0
                        ? `不足 ¥${(-change).toLocaleString()}`
                        : `¥${change.toLocaleString()}`}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-white border border-stone-200 px-4 py-2 mb-2 md:mb-0 shrink-0">
                <span className="text-stone-500 text-sm md:text-lg">人数</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPeople((p) => Math.max(1, p - 1))}
                    className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-stone-100 text-stone-700 text-2xl font-bold flex items-center justify-center active:bg-stone-200"
                  >
                    −
                  </button>
                  <span className="w-10 text-center text-2xl md:text-3xl font-bold text-stone-900">
                    {people}
                  </span>
                  <button
                    onClick={() => setPeople((p) => p + 1)}
                    className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-amber-700 text-[#faf9f5] text-2xl font-bold flex items-center justify-center active:brightness-95"
                  >
                    ＋
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 mb-2 md:mb-0 shrink-0">
                <button
                  onClick={() => setReceived(String(cartTotal))}
                  className="py-3 md:py-5 rounded-xl bg-amber-700 text-[#faf9f5] font-bold md:text-lg active:brightness-95 transition"
                >
                  ちょうど
                </button>
                {QUICK_AMOUNTS.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => addReceived(amt)}
                    className="py-3 md:py-5 rounded-xl bg-white border border-stone-200 text-stone-800 font-semibold text-sm md:text-lg active:bg-stone-100 transition"
                  >
                    ＋{amt.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <Numpad onKey={pressReceived} fill />
              <div className="flex items-center gap-3 mt-3 shrink-0">
                <button
                  onClick={() => setReceived('')}
                  className="px-5 py-4 md:py-5 rounded-2xl bg-white border border-stone-200 text-stone-500 font-semibold md:text-lg active:bg-stone-100 transition shrink-0"
                >
                  クリア
                </button>
                <button
                  onClick={() => setStep('change')}
                  disabled={received === '' || change < 0}
                  className="flex-1 bg-amber-700 text-[#faf9f5] py-4 md:py-5 rounded-2xl font-bold text-xl md:text-2xl disabled:opacity-30 active:scale-95 transition-transform"
                >
                  会計する
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── お釣り表示 ──
  if (step === 'change') {
    return (
      <div className="p-4 min-h-[80svh] flex flex-col items-center justify-center gap-6">
        <p className="text-stone-500 text-lg">お釣り</p>
        <p className="text-7xl font-bold text-green-600">¥{change.toLocaleString()}</p>
        <p className="text-stone-400">
          合計 ¥{cartTotal.toLocaleString()} / 預り ¥{receivedNum.toLocaleString()}
        </p>
        <div className="w-full max-w-sm space-y-3 mt-6">
          <button
            onClick={() => void handleNextAccount()}
            disabled={submittingReceipt}
            className="w-full bg-amber-700 text-[#faf9f5] py-5 rounded-2xl font-bold text-xl active:scale-95 transition-transform disabled:opacity-50"
          >
            {submittingReceipt ? '保存中...' : '次の会計へ →'}
          </button>
          <button onClick={() => setStep('pay')} className="w-full py-2 text-stone-400">
            ← 預り金を修正
          </button>
        </div>
      </div>
    )
  }

  // ── メニュー選択 ──
  return (
    <div className="p-4 pb-40">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-amber-800">🛒 レジ</h1>
        {pendingCount > 0 && (
          <span className="text-xs text-amber-600 border border-amber-300 rounded-full px-2 py-0.5">
            未送信 {pendingCount} 件
          </span>
        )}
      </div>

      <div className="bg-stone-50 rounded-lg px-3 py-2 mb-4 space-y-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-stone-500 flex items-center gap-1"
          >
            本日 <span className="font-bold text-stone-800">{activeReceipts.length}</span> 組 / 売上{' '}
            <span className="font-bold text-stone-800">¥{dayTotal.toLocaleString()}</span>
            {activeReceipts.length > 0 && (
              <span className="text-xs text-stone-400 ml-1">{showHistory ? '▲' : '▼'}</span>
            )}
          </button>
          <button
            onClick={openClosing}
            disabled={activeReceipts.length === 0}
            className="text-amber-700 font-semibold underline disabled:opacity-30"
          >
            締める
          </button>
        </div>
        {showHistory && activeReceipts.length > 0 && (
          <div className="border-t border-stone-200 pt-2 space-y-2">
            {activeReceipts.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-stone-400 mr-2">
                    {new Date(r.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-sm text-stone-700">
                    {r.lines.map((it) => `${it.nameSnapshot}×${it.qty}`).join('、')}
                  </span>
                  <span className="ml-2 font-semibold text-stone-800">¥{r.total.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => void handleVoid(r.id)}
                  className="text-red-400 text-lg leading-none shrink-0 active:text-red-600"
                  title="削除"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {done && (
        <div className="mb-4 bg-green-100 text-green-700 rounded-lg px-4 py-3 font-semibold text-center">
          ✓ 本日の売上を記録しました
        </div>
      )}

      {menusLoading && <Spinner />}

      {!menusLoading && menus.length === 0 && (
        <p className="text-center py-8 text-stone-500 text-sm">
          有効なメニューがありません。メニュー設定で登録してください。
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {menus.map((m) => {
          const count = qty[m.id] ?? 0
          return (
            <div
              key={m.id}
              className={`rounded-2xl border-2 flex flex-col ${
                count > 0 ? 'border-amber-500 bg-amber-50' : 'border-stone-300 bg-white'
              }`}
            >
              <button
                onClick={() => setCount(m.id, 1)}
                className="p-4 text-left flex-1 active:brightness-95 transition-all"
              >
                <p className="font-bold text-stone-900 leading-snug">{m.name}</p>
                <p className="text-amber-800 font-bold text-lg mt-1">¥{m.price.toLocaleString()}</p>
              </button>
              {count > 0 && (
                <div className="flex border-t-2 border-amber-200">
                  <button
                    onClick={() => setCount(m.id, -1)}
                    className="flex-1 py-3 text-2xl font-bold text-stone-600 active:bg-stone-100 rounded-bl-xl"
                  >
                    −
                  </button>
                  <span className="flex-1 py-3 text-center text-xl font-bold text-amber-700">{count}</span>
                  <button
                    onClick={() => setCount(m.id, 1)}
                    className="flex-1 py-3 text-2xl font-bold text-stone-600 active:bg-stone-100 rounded-br-xl"
                  >
                    ＋
                  </button>
                </div>
              )}
            </div>
          )
        })}

        <button
          onClick={() => {
            setManualOpen(true)
            setManualVal('')
          }}
          className="rounded-2xl p-4 min-h-28 flex flex-col items-center justify-center border-2 border-dashed border-amber-400 text-amber-700 font-bold active:scale-95 transition-transform"
        >
          <span className="text-3xl">＋</span>
          金額入力
        </button>
      </div>

      {manualItems.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {manualItems.map((mi) => (
            <span
              key={mi.id}
              className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 rounded-full pl-3 pr-1.5 py-1.5 font-semibold"
            >
              金額入力 ¥{mi.price.toLocaleString()}
              <button
                onClick={() => setManualItems((prev) => prev.filter((x) => x.id !== mi.id))}
                className="text-amber-500 text-lg leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {menus.length > 0 && (
        <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] left-0 right-0 md:bottom-0 md:left-52 lg:left-60 bg-white border-t border-stone-200 z-30">
          <div className="mx-auto w-full max-w-screen-sm lg:max-w-3xl px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-stone-500">合計（{cartCount}点）</span>
              <span className="text-3xl font-bold text-stone-900">¥{cartTotal.toLocaleString()}</span>
            </div>
            <button
              onClick={() => setStep('pay')}
              disabled={cartCount === 0}
              className="w-full bg-amber-700 text-[#faf9f5] py-4 rounded-2xl font-bold text-xl disabled:opacity-30 active:scale-95 transition-transform"
            >
              会計へ
            </button>
          </div>
        </div>
      )}

      {manualOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
          <div className="bg-white w-full max-w-sm rounded-t-2xl md:rounded-2xl p-5">
            <h2 className="text-lg font-bold text-stone-900 mb-2">金額を入力</h2>
            <div className="rounded-xl border-2 border-amber-400 p-4 mb-3 text-right">
              <span className="text-4xl font-bold text-stone-900">
                ¥{(Number(manualVal) || 0).toLocaleString()}
              </span>
            </div>
            <Numpad onKey={pressManual} />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setManualOpen(false)}
                className="flex-1 py-3 rounded-xl border border-stone-300 text-stone-600 font-semibold"
              >
                キャンセル
              </button>
              <button
                onClick={addManual}
                disabled={!(Number(manualVal) > 0)}
                className="flex-1 py-3 rounded-xl bg-amber-700 text-[#faf9f5] font-bold disabled:opacity-40"
              >
                追加
              </button>
            </div>
          </div>
        </div>
      )}

      {closing && (
        <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 md:p-4">
          <div
            className="bg-white w-full max-w-lg rounded-t-2xl md:rounded-2xl pt-5 px-5 space-y-4 overflow-y-auto max-h-[90svh]"
            style={{ paddingBottom: Math.max(20, kbOffset + 20) }}
          >
            <h2 className="text-lg font-bold text-stone-900">本日の締め</h2>
            <div className="flex justify-between text-stone-600">
              <span>会計組数 / 客数</span>
              <span className="font-bold">
                {activeReceipts.length} 組 / {activeReceipts.reduce((a, r) => a + (r.people ?? 1), 0)} 人
              </span>
            </div>
            <div className="flex justify-between text-stone-600">
              <span>売上合計</span>
              <span className="font-bold">¥{dayTotal.toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-stone-500 mb-1">場所代（円）</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={locationFee}
                  onChange={(e) => setLocationFee(e.target.value)}
                  placeholder="0"
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-500 mb-1">その他経費（円）</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={otherCost}
                  onChange={(e) => setOtherCost(e.target.value)}
                  placeholder="0"
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-lg"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-stone-500 mb-1">取り置き（人）</label>
              <input
                type="number"
                inputMode="numeric"
                value={reserved}
                onChange={(e) => setReserved(e.target.value)}
                placeholder="0"
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-lg"
              />
              <p className="text-xs text-stone-400 mt-1">
                ※ 原価は分析画面（管理会計）で自動集計されます。ここでは人数だけ記録します。
              </p>
            </div>
            <div>
              <label className="block text-sm text-stone-500 mb-1">メモ（任意）</label>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="天気・客層など"
                className="w-full border border-stone-300 rounded-lg px-3 py-2"
              />
            </div>
            {closeError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                {closeError}
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setClosing(false)
                  setCloseError(null)
                }}
                disabled={submitting}
                className="flex-1 py-3 rounded-xl border border-stone-300 text-stone-600 font-semibold"
              >
                キャンセル
              </button>
              <button
                onClick={() => void handleClose()}
                disabled={submitting}
                className="flex-1 py-3 rounded-xl bg-amber-700 text-[#faf9f5] font-bold disabled:opacity-50"
              >
                {submitting ? '保存中...' : '記録する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
