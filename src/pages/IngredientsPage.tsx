import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useRegisterBack } from '../lib/backHandler'
import { Spinner } from '../components/Spinner'
import {
  useIngredients,
  useInvalidateMasterData,
  ingredientPricePerG,
  isLowStock,
  createIngredient,
  updateIngredient,
  recordIngredientPurchase,
  fetchIngredientPurchases,
  type Ingredient,
  type IngredientPurchase,
} from '../lib/masterData'
import { getRecent, pushRecent, RECENT_KEYS, RECENT_LABEL } from '../lib/recent'

type FieldKey = 'pack_weight_g' | 'pack_price' | 'stock_g' | 'alert_threshold_g'

function num(s: string | undefined): number | null {
  const t = (s ?? '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isNaN(n) ? null : n
}
function fmtPerG(x: number): string {
  return parseFloat(x.toFixed(4)).toString()
}
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function IngredientsPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const { data: list = [], isLoading } = useIngredients()
  const invalidate = useInvalidateMasterData()

  const [search, setSearch] = useState('')
  const [cat, setCat] = useState<string | null>(RECENT_LABEL)
  const [recent, setRecent] = useState<string[]>(() => getRecent(RECENT_KEYS.ingredient))
  const [onlyUnset, setOnlyUnset] = useState(false)
  const [onlyAlert, setOnlyAlert] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, Partial<Record<FieldKey, string>>>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newIng, setNewIng] = useState({ name: '', category: '', unit: 'g', supplier: '' })
  const [addBusy, setAddBusy] = useState(false)
  const [purchaseId, setPurchaseId] = useState<string | null>(null)
  const [purchaseForm, setPurchaseForm] = useState({ date: todayStr(), quantity: '', totalPrice: '' })
  const [purchaseHistory, setPurchaseHistory] = useState<Record<string, IngredientPurchase[]>>({})

  useRegisterBack(() => {
    if (adding) {
      setAdding(false)
      return true
    }
    return false
  })

  const clearEdit = (id: string, field: FieldKey) => {
    setEdits((p) => {
      const rowEdits = { ...p[id] }
      delete rowEdits[field]
      const n = { ...p }
      if (Object.keys(rowEdits).length === 0) delete n[id]
      else n[id] = rowEdits
      return n
    })
  }

  const saveField = async (ing: Ingredient, field: FieldKey) => {
    const raw = edits[ing.id]?.[field]
    if (raw === undefined) return
    const newVal = num(raw)
    if (raw.trim() !== '' && newVal === null) {
      clearEdit(ing.id, field)
      return
    }
    if (newVal === ing[field]) {
      clearEdit(ing.id, field)
      return
    }
    setSavingId(ing.id)
    setError(null)
    try {
      const patch: Record<string, number | null> = { [field]: newVal }
      // 単品重量・単品価格を変更したら単価(円/g)を自動再計算
      if (field === 'pack_weight_g' || field === 'pack_price') {
        const w = field === 'pack_weight_g' ? newVal : ing.pack_weight_g
        const p = field === 'pack_price' ? newVal : ing.pack_price
        if (w && w > 0 && p !== null) {
          patch.unit_price_per_g = Math.round((p / w) * 10000) / 10000
        }
      }
      await updateIngredient(ing.id, patch)
      invalidate()
      setRecent(pushRecent(RECENT_KEYS.ingredient, ing.name))
      clearEdit(ing.id, field)
      setSavedId(ing.id)
      setTimeout(() => setSavedId(null), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSavingId(null)
    }
  }

  const addIngredient = async () => {
    const name = newIng.name.trim()
    if (!name) return
    if (list.some((x) => x.name === name)) {
      setError('同名の食材が既にあります')
      return
    }
    setAddBusy(true)
    setError(null)
    try {
      await createIngredient(newIng)
      setAdding(false)
      setNewIng({ name: '', category: '', unit: 'g', supplier: '' })
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました')
    } finally {
      setAddBusy(false)
    }
  }

  const openPurchase = async (ing: Ingredient) => {
    if (purchaseId === ing.id) {
      setPurchaseId(null)
      return
    }
    setPurchaseId(ing.id)
    setPurchaseForm({ date: todayStr(), quantity: '', totalPrice: '' })
    if (!purchaseHistory[ing.id]) {
      const hist = await fetchIngredientPurchases(ing.id)
      setPurchaseHistory((p) => ({ ...p, [ing.id]: hist }))
    }
  }

  const savePurchase = async (ing: Ingredient) => {
    const totalPrice = Number(purchaseForm.totalPrice)
    if (!purchaseForm.date || !totalPrice || totalPrice <= 0) return
    setError(null)
    try {
      await recordIngredientPurchase({
        ingredientId: ing.id,
        purchasedOn: purchaseForm.date,
        quantity: num(purchaseForm.quantity),
        totalPrice,
      })
      invalidate()
      const hist = await fetchIngredientPurchases(ing.id)
      setPurchaseHistory((p) => ({ ...p, [ing.id]: hist }))
      setPurchaseForm({ date: todayStr(), quantity: '', totalPrice: '' })
    } catch (e) {
      setError(e instanceof Error ? e.message : '仕入れ記録に失敗しました')
    }
  }

  const categories = (() => {
    const c: Record<string, number> = {}
    for (const x of list) c[x.category || 'その他'] = (c[x.category || 'その他'] ?? 0) + 1
    return Object.entries(c)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
  })()

  const byCategory =
    search || cat === null
      ? list
      : cat === RECENT_LABEL
        ? (recent.map((n) => list.find((x) => x.name === n)).filter((x): x is Ingredient => !!x))
        : list.filter((x) => (x.category || 'その他') === cat)

  const filtered = byCategory
    .filter((x) => (search ? x.name.includes(search) : true))
    .filter((x) => (onlyUnset ? ingredientPricePerG(x) === null : true))
    .filter((x) => (onlyAlert ? isLowStock(x) : true))

  const unsetCount = list.filter((x) => ingredientPricePerG(x) === null).length
  const alertCount = list.filter(isLowStock).length

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <div className="text-6xl">🥬</div>
        <h1 className="text-xl font-bold text-amber-800">食材マスタ</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  const renderField = (ing: Ingredient, field: FieldKey, label: string, suffix: string) => {
    const editVal = edits[ing.id]?.[field]
    const stored = ing[field]
    const value = editVal !== undefined ? editVal : stored === null ? '' : String(stored)
    return (
      <div>
        <label className="block text-xs text-stone-600 mb-1">{label}</label>
        <div className="flex items-center border border-stone-400 rounded-lg px-2 py-2 bg-white focus-within:border-amber-500">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={value}
            onChange={(e) => setEdits((p) => ({ ...p, [ing.id]: { ...p[ing.id], [field]: e.target.value } }))}
            onBlur={() => saveField(ing, field)}
            className="w-full min-w-0 text-right text-base text-stone-900 outline-none"
          />
          <span className="text-xs text-stone-500 ml-1 shrink-0">{suffix}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-amber-800">🥬 食材マスタ</h1>
        <button
          onClick={() => {
            setAdding((v) => !v)
            setNewIng({ name: '', category: '', unit: 'g', supplier: '' })
          }}
          className="text-sm bg-amber-700 text-[#faf9f5] px-3 py-1 rounded-lg font-semibold"
        >
          ＋新規
        </button>
      </div>
      <p className="text-xs text-stone-500 mb-3">
        単価・単品価格は<span className="font-semibold">税抜き</span>で入力
      </p>

      {adding && (
        <div className="border border-amber-200 bg-amber-50/50 rounded-xl p-3 mb-4 space-y-2">
          <p className="text-sm font-semibold text-stone-700">新しい食材を追加</p>
          <input
            type="text"
            autoFocus
            value={newIng.name}
            onChange={(e) => setNewIng((p) => ({ ...p, name: e.target.value }))}
            placeholder="食材名（必須）"
            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-base"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={newIng.category}
              onChange={(e) => setNewIng((p) => ({ ...p, category: e.target.value }))}
              placeholder="分類（例：スパイス）"
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={newIng.unit}
              onChange={(e) => setNewIng((p) => ({ ...p, unit: e.target.value }))}
              placeholder="単位（例：g）"
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <input
            type="text"
            value={newIng.supplier}
            onChange={(e) => setNewIng((p) => ({ ...p, supplier: e.target.value }))}
            placeholder="仕入先（任意）"
            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setAdding(false)}
              className="flex-1 py-2 rounded-lg border border-stone-300 text-stone-600 font-semibold text-sm"
            >
              キャンセル
            </button>
            <button
              onClick={addIngredient}
              disabled={addBusy || !newIng.name.trim()}
              className="flex-1 py-2 rounded-lg bg-amber-700 text-[#faf9f5] font-bold text-sm disabled:opacity-40"
            >
              {addBusy ? '追加中...' : '追加'}
            </button>
          </div>
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="食材名で検索…"
        className="w-full border border-stone-300 rounded-lg px-3 py-2.5 text-base mb-2"
      />

      {!search && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-1 -mx-1 px-1">
          <button
            onClick={() => setCat(RECENT_LABEL)}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold ${
              cat === RECENT_LABEL ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-200 text-stone-700'
            }`}
          >
            {RECENT_LABEL}
          </button>
          <button
            onClick={() => setCat(null)}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold ${
              cat === null ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-200 text-stone-700'
            }`}
          >
            全て
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold ${
                cat === c ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-200 text-stone-700'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mb-3 text-sm flex-wrap">
        <label className="flex items-center gap-1.5 text-stone-600">
          <input type="checkbox" checked={onlyUnset} onChange={(e) => setOnlyUnset(e.target.checked)} />
          単価未設定 ({unsetCount})
        </label>
        <label className="flex items-center gap-1.5 text-stone-600">
          <input type="checkbox" checked={onlyAlert} onChange={(e) => setOnlyAlert(e.target.checked)} />
          在庫アラート ({alertCount})
        </label>
        <span className="text-stone-400 ml-auto">全 {list.length} 件</span>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {isLoading && <Spinner />}

      <div className="grid gap-2 sm:grid-cols-2">
        {filtered.map((ing) => {
          const alert = isLowStock(ing)
          const liveW = edits[ing.id]?.pack_weight_g !== undefined ? num(edits[ing.id]!.pack_weight_g) : ing.pack_weight_g
          const liveP = edits[ing.id]?.pack_price !== undefined ? num(edits[ing.id]!.pack_price) : ing.pack_price
          const perG = liveW && liveW > 0 && liveP !== null ? liveP / liveW : ingredientPricePerG(ing)
          const history = purchaseHistory[ing.id] ?? []
          return (
            <div
              key={ing.id}
              className={`border rounded-xl px-3 py-2 ${
                alert
                  ? 'border-red-300 bg-red-50/50'
                  : ingredientPricePerG(ing) === null
                    ? 'border-amber-200 bg-amber-50/40'
                    : 'border-stone-200'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-stone-900 truncate">{ing.name}</p>
                  <p className="text-xs text-stone-500">
                    {ing.category} ・ {ing.supplier || '仕入先未設定'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {alert && <span className="text-xs bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded">⚠️在庫少</span>}
                  <span className="w-4 text-center">
                    {savingId === ing.id ? (
                      <span className="text-stone-400 text-xs">…</span>
                    ) : savedId === ing.id ? (
                      <span className="text-green-500">✓</span>
                    ) : null}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2">
                {renderField(ing, 'pack_weight_g', '単品重量', 'g')}
                {renderField(ing, 'pack_price', '単品価格（税抜）', '円')}
              </div>

              <div className="mt-2 bg-stone-100 rounded-lg px-3 py-1.5 flex items-center justify-between">
                <span className="text-sm text-stone-500">単価（税抜・自動）</span>
                <span className="text-base font-bold text-stone-900">
                  {perG !== null ? `¥${fmtPerG(perG)} / ${ing.unit || 'g'}` : '—'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2">
                {renderField(ing, 'stock_g', '在庫', 'g')}
                {renderField(ing, 'alert_threshold_g', 'アラート閾値', 'g')}
              </div>

              <button
                onClick={() => openPurchase(ing)}
                className="mt-2 w-full text-xs text-amber-700 font-semibold border border-dashed border-amber-300 rounded-lg py-1.5"
              >
                {purchaseId === ing.id ? '仕入れ記録を閉じる' : '📦 仕入れ記録を追加'}
              </button>

              {purchaseId === ing.id && (
                <div className="mt-2 border border-stone-200 rounded-lg p-2 bg-stone-50 space-y-2">
                  <div className="grid grid-cols-3 gap-1.5">
                    <input
                      type="date"
                      value={purchaseForm.date}
                      onChange={(e) => setPurchaseForm((p) => ({ ...p, date: e.target.value }))}
                      className="col-span-1 border border-stone-300 rounded px-1.5 py-1.5 text-xs bg-white"
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="数量g"
                      value={purchaseForm.quantity}
                      onChange={(e) => setPurchaseForm((p) => ({ ...p, quantity: e.target.value }))}
                      className="border border-stone-300 rounded px-1.5 py-1.5 text-xs text-right bg-white"
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="金額"
                      value={purchaseForm.totalPrice}
                      onChange={(e) => setPurchaseForm((p) => ({ ...p, totalPrice: e.target.value }))}
                      className="border border-stone-300 rounded px-1.5 py-1.5 text-xs text-right bg-white"
                    />
                  </div>
                  <button
                    onClick={() => savePurchase(ing)}
                    className="w-full py-1.5 rounded bg-amber-700 text-[#faf9f5] text-xs font-bold"
                  >
                    記録する
                  </button>
                  {history.length > 0 && (
                    <div className="text-xs text-stone-500 space-y-0.5 pt-1 border-t border-stone-200">
                      <p className="text-stone-400">仕入れ履歴（単価推移）</p>
                      {history.map((h) => (
                        <div key={h.id} className="flex justify-between">
                          <span>{h.purchased_on}</span>
                          <span>
                            ¥{h.total_price.toLocaleString()}
                            {h.quantity ? ` / ${h.quantity}g（¥${fmtPerG(h.total_price / h.quantity)}/g）` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && !isLoading && (
        <p className="text-center text-stone-400 text-sm py-8">条件に一致する食材がありません</p>
      )}
    </div>
  )
}
