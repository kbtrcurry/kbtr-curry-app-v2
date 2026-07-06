import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { useRegisterBack } from '../lib/backHandler'
import { Spinner } from '../components/Spinner'
import { useIngredients } from '../lib/masterData'
import {
  useRecipes,
  useRecipeIngredients,
  useInvalidateMasterData,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  addRecipeIngredient,
  updateRecipeIngredient,
  deleteRecipeIngredient,
  recipeTotalCost,
  effectiveServings,
  perServingCost,
  ingredientPricePerG,
  RECIPE_TYPES,
  TAX,
  type Recipe,
  type RecipeIngredientRow,
} from '../lib/masterData'

const RECENT_LABEL = 'すべて'

function str(v: number | null | undefined): string {
  return v != null ? String(v) : ''
}
function num(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isNaN(n) ? null : n
}

export default function RecipesPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const { data: recipes = [], isLoading: recipesLoading } = useRecipes()
  const { data: allIngredients = [] } = useIngredients()
  const invalidate = useInvalidateMasterData()

  const [search, setSearch] = useState('')
  const [cat, setCat] = useState<string>(RECENT_LABEL)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: items = [], isLoading: itemsLoading } = useRecipeIngredients(selectedId)

  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('カレー')
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')

  const [salePrice, setSalePrice] = useState('')
  const [totalWeight, setTotalWeight] = useState('')
  const [servingWeight, setServingWeight] = useState('')
  const [servings, setServings] = useState('')
  const [qtyVals, setQtyVals] = useState<Record<string, string>>({})

  useRegisterBack(() => {
    if (renaming) {
      setRenaming(false)
      return true
    }
    if (selectedId) {
      setSelectedId(null)
      return true
    }
    return false
  })

  const selected = recipes.find((r) => r.id === selectedId) ?? null

  const openRecipe = (r: Recipe) => {
    setSelectedId(r.id)
    setSalePrice(str(r.sale_price))
    setTotalWeight(str(r.yield_g))
    setServingWeight(str(r.serving_weight_g))
    setServings(str(r.servings))
    setSearch('')
  }

  const createNew = async () => {
    const nm = newName.trim()
    if (!nm) return
    if (recipes.some((r) => r.name === nm)) {
      setError('同名のレシピが既にあります')
      return
    }
    setError(null)
    try {
      const id = await createRecipe(nm, newType)
      setCreating(false)
      setNewName('')
      invalidate()
      setSelectedId(id)
      setSalePrice('')
      setTotalWeight('')
      setServingWeight('')
      setServings('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました')
    }
  }

  const saveNumField = async (field: 'yield_g' | 'serving_weight_g' | 'servings' | 'sale_price', raw: string) => {
    if (!selected) return
    const v = num(raw)
    if (v === (selected[field] ?? null)) return
    setError(null)
    try {
      await updateRecipe(selected.id, { [field]: v })
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  const saveType = async (t: string) => {
    if (!selected || t === selected.dish_type) return
    try {
      await updateRecipe(selected.id, { dish_type: t })
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  const renameRecipe = async () => {
    if (!selected) return
    const nm = renameVal.trim()
    if (!nm || nm === selected.name) {
      setRenaming(false)
      return
    }
    if (recipes.some((r) => r.name === nm)) {
      setError('同名のレシピが既にあります')
      return
    }
    try {
      await updateRecipe(selected.id, { name: nm })
      invalidate()
      setRenaming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  const removeRecipe = async () => {
    if (!selected) return
    if (!confirm(`「${selected.name}」を削除しますか？\n食材明細も削除されます。元に戻せません。`)) return
    setDeleting(true)
    setError(null)
    try {
      await deleteRecipe(selected.id)
      invalidate()
      setSelectedId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  const saveQty = async (item: RecipeIngredientRow, raw: string) => {
    const n = Number(raw)
    if (raw.trim() === '' || Number.isNaN(n) || n === item.quantity) return
    try {
      await updateRecipeIngredient(item.id, { quantity: n })
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  const removeItem = async (item: RecipeIngredientRow) => {
    if (!confirm(`「${item.ingredients.name}」を削除しますか？`)) return
    try {
      await deleteRecipeIngredient(item.id)
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました')
    }
  }

  const pickIngredient = async (ingredientId: string, unit: string) => {
    if (!selected) return
    try {
      await addRecipeIngredient(selected.id, ingredientId, 100, unit)
      invalidate()
      setPicking(false)
      setPickerSearch('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました')
    }
  }

  const types = [...new Set(recipes.map((r) => r.dish_type || 'その他'))]
  const ordered = RECIPE_TYPES.filter((t) => types.includes(t))
  const extra = types.filter((t) => !RECIPE_TYPES.includes(t)).sort()
  const typeTabs = [...ordered, ...extra]

  const listed = search
    ? recipes.filter((r) => r.name.includes(search)).slice(0, 50)
    : cat === RECENT_LABEL
      ? recipes
      : recipes.filter((r) => (r.dish_type || 'その他') === cat)

  const rows = items.map((it) => {
    const per = ingredientPricePerG(it.ingredients) ?? 0
    return { ...it, price: per, cost: it.quantity * per * TAX }
  })
  const totalCost = selected ? recipeTotalCost(items) : 0
  const unknownCount = rows.filter((r) => r.price === 0).length
  const eff = selected ? effectiveServings(selected) : null
  const perCost = selected ? perServingCost(selected, items) : 0
  const sale = Number(salePrice) || 0
  const costRate = sale > 0 ? (perCost / sale) * 100 : 0
  const profit = sale - perCost

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <div className="text-6xl">📖</div>
        <h1 className="text-xl font-bold text-amber-800">レシピ</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  const numField = (
    label: string,
    value: string,
    setValue: (s: string) => void,
    field: 'yield_g' | 'serving_weight_g' | 'servings' | 'sale_price',
    suffix: string,
    placeholder = '',
  ) => (
    <div>
      <label className="block text-xs text-stone-600 mb-1">{label}</label>
      <div className="flex items-center border border-stone-400 rounded-lg px-2 py-2 bg-white focus-within:border-amber-500">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => saveNumField(field, value)}
          className="w-full min-w-0 text-right text-base text-stone-900 outline-none"
        />
        <span className="text-xs text-stone-500 ml-1 shrink-0">{suffix}</span>
      </div>
    </div>
  )

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-amber-800">📖 レシピ</h1>
      </div>
      <p className="text-xs text-stone-500 mb-3">
        金額はすべて<span className="font-semibold">税込み（8%）</span>表示
      </p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {(recipesLoading || (selectedId && itemsLoading)) && <Spinner />}

      {!selectedId && !recipesLoading && (
        <>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="レシピ名で検索…"
              className="flex-1 border border-stone-300 rounded-lg px-3 py-2.5 text-base"
            />
            <button
              onClick={() => {
                setCreating((c) => !c)
                setNewName('')
              }}
              className="shrink-0 bg-amber-700 text-[#faf9f5] rounded-lg px-3 font-semibold text-sm"
            >
              ＋新規
            </button>
          </div>

          {creating && (
            <div className="border border-amber-200 bg-amber-50/50 rounded-lg p-3 mb-3 space-y-2">
              <p className="text-sm font-semibold text-stone-700">新しいレシピを作成</p>
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="レシピ名"
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-base"
              />
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-base bg-white"
              >
                {RECIPE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={() => setCreating(false)}
                  className="flex-1 py-2 rounded-lg border border-stone-300 text-stone-600 font-semibold text-sm"
                >
                  キャンセル
                </button>
                <button
                  onClick={createNew}
                  disabled={!newName.trim()}
                  className="flex-1 py-2 rounded-lg bg-amber-700 text-[#faf9f5] font-bold text-sm disabled:opacity-40"
                >
                  作成して開く
                </button>
              </div>
            </div>
          )}

          {!search && (
            <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
              {[RECENT_LABEL, ...typeTabs].map((t) => (
                <button
                  key={t}
                  onClick={() => setCat(t)}
                  className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold ${
                    cat === t ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-200 text-stone-700'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          <p className="text-sm text-stone-500 mb-2">
            {search ? `「${search}」の検索結果` : cat} ・ {listed.length} 件
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {listed.map((r) => (
              <button
                key={r.id}
                onClick={() => openRecipe(r)}
                className="w-full text-left border border-stone-300 rounded-xl px-3 py-3 active:bg-stone-50"
              >
                <p className="text-base font-semibold text-stone-900 truncate">{r.name}</p>
                <div className="mt-1.5 flex gap-3 flex-wrap text-sm">
                  <span className="text-stone-600">
                    売価{' '}
                    <span className="font-semibold text-stone-900">
                      {r.sale_price != null ? `¥${r.sale_price.toLocaleString()}` : '—'}
                    </span>
                  </span>
                </div>
              </button>
            ))}
            {listed.length === 0 && <p className="text-center text-stone-400 text-sm py-8">該当するレシピがありません</p>}
          </div>
        </>
      )}

      {selected && (
        <>
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setSelectedId(null)} className="text-stone-500 text-sm">
              ← 一覧へ
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setRenaming(true)
                  setRenameVal(selected.name)
                }}
                className="text-xs border border-stone-300 rounded-lg px-2 py-1 text-stone-600"
              >
                ✏️ 名前変更
              </button>
              <button
                onClick={removeRecipe}
                disabled={deleting}
                className="text-xs border border-red-200 rounded-lg px-2 py-1 text-red-500 disabled:opacity-40"
              >
                🗑️ 削除
              </button>
            </div>
          </div>

          {renaming ? (
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                autoFocus
                value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') renameRecipe()
                  if (e.key === 'Escape') setRenaming(false)
                }}
                className="flex-1 border border-amber-400 rounded-lg px-3 py-2 text-base font-semibold"
              />
              <button onClick={renameRecipe} className="bg-amber-700 text-[#faf9f5] px-3 rounded-lg font-semibold text-sm">
                保存
              </button>
              <button onClick={() => setRenaming(false)} className="border border-stone-300 px-3 rounded-lg text-stone-600 text-sm">
                ×
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-bold text-stone-900 min-w-0 truncate">{selected.name}</h2>
              <select
                value={selected.dish_type || 'その他'}
                onChange={(e) => saveType(e.target.value)}
                className="shrink-0 border border-stone-300 rounded-lg px-2 py-1 text-sm text-amber-700 bg-white"
              >
                {RECIPE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2 mb-3">
            {rows.map((r) => (
              <div
                key={r.id}
                className={`border rounded-lg p-2.5 ${r.price === 0 ? 'border-amber-200 bg-amber-50/40' : 'border-stone-200'}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="flex-1 min-w-0 truncate text-base font-medium text-stone-900">{r.ingredients.name}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={qtyVals[r.id] !== undefined ? qtyVals[r.id] : String(r.quantity)}
                    onChange={(e) => setQtyVals((p) => ({ ...p, [r.id]: e.target.value }))}
                    onBlur={(e) => saveQty(r, e.target.value)}
                    className="w-16 border border-stone-300 rounded px-1.5 py-1.5 text-right text-base outline-none focus:border-amber-400"
                  />
                  <span className="w-10 text-center text-sm text-stone-500">{r.unit}</span>
                  <button onClick={() => removeItem(r)} className="text-stone-300 text-xl px-1 shrink-0" aria-label="削除">
                    ×
                  </button>
                </div>
                <div className="flex items-center justify-end mt-1">
                  <span className="text-xs text-stone-500 shrink-0">
                    原価 ¥{Math.round(r.cost).toLocaleString()}
                    {r.price === 0 && <span className="text-amber-600">(単価未設定)</span>}
                  </span>
                </div>
              </div>
            ))}
            {rows.length === 0 && <p className="text-center text-stone-400 text-sm py-4">食材明細がありません</p>}

            <button
              onClick={() => {
                setPicking((v) => !v)
                setPickerSearch('')
              }}
              className="w-full border border-dashed border-stone-300 rounded-lg py-2 text-sm text-amber-700 font-semibold active:bg-stone-50"
            >
              ＋ 食材を追加
            </button>

            {picking && (
              <div className="border border-stone-200 rounded-lg p-2 bg-stone-50">
                <input
                  type="text"
                  autoFocus
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="食材名で検索…"
                  className="w-full border border-stone-300 rounded px-2 py-1.5 text-sm mb-2 bg-white"
                />
                <div className="max-h-44 overflow-y-auto divide-y divide-stone-100 bg-white rounded border border-stone-200">
                  {allIngredients
                    .filter((i) => (pickerSearch ? i.name.includes(pickerSearch) : true))
                    .filter((i) => !items.some((it) => it.ingredient_id === i.id))
                    .slice(0, 30)
                    .map((i) => (
                      <button
                        key={i.id}
                        onClick={() => pickIngredient(i.id, i.unit)}
                        className="w-full text-left px-2 py-1.5 text-sm active:bg-amber-50 flex justify-between"
                      >
                        <span className="truncate">{i.name}</span>
                        <span className="text-amber-700 ml-2 shrink-0">＋</span>
                      </button>
                    ))}
                </div>
                <button onClick={() => setPicking(false)} className="w-full text-center text-xs text-stone-500 mt-2 py-1">
                  閉じる
                </button>
              </div>
            )}
          </div>

          {unknownCount > 0 && (
            <p className="text-xs text-amber-600 mb-3">
              ※ {unknownCount} 件の食材が単価未設定です。「食材」タブで設定すると正確になります。
            </p>
          )}

          <div className="grid grid-cols-3 gap-2 mb-3">
            {numField('総重量', totalWeight, setTotalWeight, 'yield_g', 'g')}
            {numField('一食重量', servingWeight, setServingWeight, 'serving_weight_g', 'g')}
            {numField('食数', servings, setServings, 'servings', '食', eff ? String(Math.round(eff * 10) / 10) : '')}
          </div>

          <div className="bg-stone-50 rounded-xl p-4 space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">合計原価（税込・全体）</span>
              <span className="font-semibold text-stone-800">¥{Math.round(totalCost).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-stone-500">食数</span>
              <span className="font-semibold text-stone-800">{eff ? `${Math.round(eff * 10) / 10} 食` : '未設定'}</span>
            </div>
            <div className="flex justify-between items-center border-t border-stone-200 pt-2">
              <span className="text-stone-600">一食あたり原価（税込）</span>
              <span className="text-xl font-bold text-stone-900">¥{Math.round(perCost).toLocaleString()}</span>
            </div>
            <div className="pt-1">
              <label className="flex justify-between text-sm text-stone-500 mb-1">
                <span>販売価格（税込・一食）</span>
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                onBlur={() => saveNumField('sale_price', salePrice)}
                placeholder="例: 1500"
                className="w-full border border-stone-300 rounded-lg px-3 py-2.5 text-lg"
              />
            </div>
            {sale > 0 && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-xs text-stone-400">原価率（一食）</p>
                  <p className={`text-xl font-bold ${costRate > 35 ? 'text-red-500' : 'text-green-600'}`}>{costRate.toFixed(1)}%</p>
                </div>
                <div className="bg-white rounded-lg p-3 text-center">
                  <p className="text-xs text-stone-400">粗利（一食）</p>
                  <p className="text-xl font-bold text-stone-800">¥{Math.round(profit).toLocaleString()}</p>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
