import { useCallback, useState } from 'react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import {
  useRecipes,
  useAllRecipeIngredients,
  groupRecipeIngredientsByRecipe,
  RECIPE_TYPES,
} from '../lib/masterData'
import { useIngredients } from '../lib/masterData'

type PrepItem = { recipeId: string; mult: string }
const PREP_KEY = 'kbtr_v2_prep'
const RECENT_LABEL = 'すべて'

function fmt(x: number): string {
  return (Math.round(x * 10) / 10).toLocaleString()
}

export default function PrepPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const { data: recipes = [], isLoading: recipesLoading } = useRecipes()
  const { data: allRecipeIngredients = [] } = useAllRecipeIngredients()
  const { data: ingredients = [] } = useIngredients()
  const recipeIngredientsByRecipe = groupRecipeIngredientsByRecipe(allRecipeIngredients)
  const stockByName: Record<string, number | null> = {}
  for (const i of ingredients) stockByName[i.name] = i.stock_g

  const [search, setSearch] = useState('')
  const [cat, setCat] = useState<string>(RECENT_LABEL)
  const [subTab, setSubTab] = useState<'shopping' | 'recipes'>('shopping')
  const [selected, setSelected] = useState<PrepItem[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PREP_KEY) ?? '[]')
    } catch {
      return []
    }
  })

  const persist = useCallback((next: PrepItem[]) => {
    setSelected(next)
    localStorage.setItem(PREP_KEY, JSON.stringify(next))
  }, [])

  const addRecipe = (recipeId: string) => {
    if (selected.some((s) => s.recipeId === recipeId)) return
    persist([...selected, { recipeId, mult: '1' }])
    setSearch('')
  }
  const removeRecipe = (recipeId: string) => {
    persist(selected.filter((s) => s.recipeId !== recipeId))
  }
  const setMult = (recipeId: string, mult: string) => {
    persist(selected.map((s) => (s.recipeId === recipeId ? { ...s, mult } : s)))
  }

  const recipeById = (id: string) => recipes.find((r) => r.id === id)

  // 買い出し集計
  const agg: Record<string, { qty: number; unit: string }> = {}
  for (const s of selected) {
    const m = Number(s.mult) || 0
    for (const it of recipeIngredientsByRecipe[s.recipeId] ?? []) {
      const name = it.ingredients.name
      if (!agg[name]) agg[name] = { qty: 0, unit: it.unit }
      agg[name].qty += it.quantity * m
    }
  }
  const shoppingRows = Object.entries(agg)
    .map(([name, v]) => {
      const stock = stockByName[name] ?? null
      const short = v.qty - (stock ?? 0)
      return { name, need: v.qty, unit: v.unit, stock, short }
    })
    .sort((a, b) => b.short - a.short)

  const types = [...new Set(recipes.map((r) => r.dish_type || 'その他'))]
  const ordered = RECIPE_TYPES.filter((t) => types.includes(t))
  const extra = types.filter((t) => !RECIPE_TYPES.includes(t)).sort()
  const typeTabs = [...ordered, ...extra]

  const selectedIds = new Set(selected.map((s) => s.recipeId))
  const listed = (
    search
      ? recipes.filter((r) => r.name.includes(search)).slice(0, 50)
      : cat === RECENT_LABEL
        ? recipes
        : recipes.filter((r) => (r.dish_type || 'その他') === cat)
  ).filter((r) => !selectedIds.has(r.id))

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <div className="text-6xl">🍳</div>
        <h1 className="text-xl font-bold text-amber-800">仕込み計画</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold text-amber-800">🍳 仕込み計画</h1>
      </div>

      {recipesLoading && <Spinner />}

      {selected.length > 0 && (
        <div className="space-y-1.5 mb-4">
          <p className="text-xs text-stone-400">本日の仕込み（{selected.length}品）</p>
          {selected.map((s) => {
            const r = recipeById(s.recipeId)
            if (!r) return null
            return (
              <div key={s.recipeId} className="flex items-center gap-2 border border-stone-200 rounded-lg px-3 py-2">
                <span className="flex-1 min-w-0 truncate text-sm text-stone-800">{r.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    value={s.mult}
                    onChange={(e) => setMult(s.recipeId, e.target.value)}
                    className="w-14 border border-stone-300 rounded px-2 py-1 text-right text-sm"
                  />
                  <span className="text-xs text-stone-400">倍</span>
                </div>
                <button onClick={() => removeRecipe(s.recipeId)} className="text-stone-300 text-lg shrink-0 px-1">
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex border border-stone-200 rounded-lg overflow-hidden mb-3">
          <button
            onClick={() => setSubTab('shopping')}
            className={`flex-1 py-2 text-sm font-semibold ${subTab === 'shopping' ? 'bg-amber-700 text-[#faf9f5]' : 'text-stone-500'}`}
          >
            🛒 買い出し
          </button>
          <button
            onClick={() => setSubTab('recipes')}
            className={`flex-1 py-2 text-sm font-semibold ${subTab === 'recipes' ? 'bg-amber-700 text-[#faf9f5]' : 'text-stone-500'}`}
          >
            🍳 仕込みレシピ
          </button>
        </div>
      )}

      {selected.length > 0 && subTab === 'shopping' && (
        <div className="border border-stone-200 rounded-lg overflow-hidden mb-5">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-stone-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">食材</th>
                <th className="text-right px-2 py-2 font-medium">必要量</th>
                <th className="text-right px-2 py-2 font-medium">在庫</th>
                <th className="text-right px-3 py-2 font-medium">買う量</th>
              </tr>
            </thead>
            <tbody>
              {shoppingRows.map((r) => (
                <tr key={r.name} className={`border-t border-stone-100 ${r.short > 0 ? '' : 'text-stone-400'}`}>
                  <td className="px-3 py-2 text-stone-800">{r.name}</td>
                  <td className="px-2 py-2 text-right">
                    {fmt(r.need)}
                    {r.unit}
                  </td>
                  <td className="px-2 py-2 text-right text-stone-400">{r.stock === null ? 'N/A' : fmt(r.stock)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${r.short > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {r.short > 0 ? `${fmt(r.short)}${r.unit}` : '足りる'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected.length > 0 && subTab === 'recipes' && (
        <div className="space-y-4 mb-5">
          {selected.map((s) => {
            const r = recipeById(s.recipeId)
            if (!r) return null
            const m = Number(s.mult) || 0
            const items = recipeIngredientsByRecipe[s.recipeId] ?? []
            return (
              <div key={s.recipeId}>
                <h3 className="font-semibold text-stone-800 mb-1">
                  {r.name} <span className="text-sm text-amber-700">×{s.mult}</span>
                </h3>
                <div className="border border-stone-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} className="border-t border-stone-100 first:border-t-0">
                          <td className="px-3 py-1.5 text-stone-700">{it.ingredients.name}</td>
                          <td className="px-3 py-1.5 text-right font-medium text-stone-800">
                            {fmt(it.quantity * m)}
                            {it.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!recipesLoading && (
        <div className="border-t border-stone-200 pt-3">
          <p className="text-xs text-stone-400 mb-2">レシピを追加</p>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="レシピを検索…"
            className="w-full border border-stone-300 rounded-lg px-3 py-2 mb-2"
          />
          {!search && (
            <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
              {[RECENT_LABEL, ...typeTabs].map((t) => (
                <button
                  key={t}
                  onClick={() => setCat(t)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold ${cat === t ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          <div className="border border-stone-200 rounded-lg divide-y divide-stone-100 max-h-64 overflow-y-auto">
            {listed.map((r) => (
              <button key={r.id} onClick={() => addRecipe(r.id)} className="w-full text-left px-3 py-2 text-sm active:bg-stone-50 flex justify-between">
                <span className="truncate">{r.name}</span>
                <span className="text-amber-700 ml-2 shrink-0">＋追加</span>
              </button>
            ))}
            {listed.length === 0 && <p className="text-center text-stone-400 text-sm py-6">該当するレシピがありません</p>}
          </div>
        </div>
      )}
    </div>
  )
}
