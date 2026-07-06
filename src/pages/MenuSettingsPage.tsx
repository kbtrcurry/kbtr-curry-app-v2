import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import {
  useAllMenus,
  useAllMenuComponents,
  useRecipes,
  useAllRecipeIngredients,
  useInvalidateMasterData,
  createMenu,
  updateMenu,
  deleteMenu,
  addMenuComponent,
  updateMenuComponentServings,
  removeMenuComponent,
  perServingCost,
  groupRecipeIngredientsByRecipe,
  type Menu,
  type MenuComponentRow,
} from '../lib/masterData'

export default function MenuSettingsPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const { data: menus = [], isLoading: menusLoading } = useAllMenus()
  const { data: components = [] } = useAllMenuComponents()
  const { data: recipes = [] } = useRecipes()
  const { data: allRecipeIngredients = [] } = useAllRecipeIngredients()
  const invalidate = useInvalidateMasterData()
  const recipeIngredientsByRecipe = groupRecipeIngredientsByRecipe(allRecipeIngredients)

  const [error, setError] = useState<string | null>(null)
  const [nameVals, setNameVals] = useState<Record<string, string>>({})
  const [priceVals, setPriceVals] = useState<Record<string, string>>({})
  const [servEdit, setServEdit] = useState<Record<string, string>>({})
  const [pickerMenuId, setPickerMenuId] = useState<string | null>(null)
  const [pickerSearch, setPickerSearch] = useState('')

  const componentsByMenu = (menuId: string): MenuComponentRow[] => components.filter((c) => c.menu_id === menuId)

  const recipeCostPerServing = (recipeId: string): number => {
    const r = recipes.find((x) => x.id === recipeId)
    if (!r) return 0
    return perServingCost(r, recipeIngredientsByRecipe[recipeId] ?? [])
  }

  const menuTotalCost = (menuId: string): number =>
    componentsByMenu(menuId).reduce((s, c) => s + recipeCostPerServing(c.recipe_id) * c.servings, 0)

  const saveField = async (menu: Menu, field: 'name' | 'price', raw: string) => {
    let newVal: string | number
    if (field === 'price') {
      const n = Number(raw)
      if (raw.trim() === '' || Number.isNaN(n) || n === menu.price) return
      newVal = n
    } else {
      newVal = raw.trim()
      if (newVal === menu.name || newVal === '') return
    }
    setError(null)
    try {
      await updateMenu(menu.id, { [field]: newVal })
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  const toggleEnabled = async (menu: Menu) => {
    try {
      await updateMenu(menu.id, { active: !menu.active })
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  const addMenuNew = async () => {
    setError(null)
    try {
      await createMenu('新しいメニュー', 0)
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました')
    }
  }

  const removeMenu = async (menu: Menu) => {
    if (!confirm(`「${menu.name}」を削除しますか？`)) return
    setError(null)
    try {
      await deleteMenu(menu.id)
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました')
    }
  }

  const addRecipeToMenu = async (menuId: string, recipeId: string) => {
    setError(null)
    try {
      await addMenuComponent(menuId, recipeId, 1)
      invalidate()
      setPickerMenuId(null)
      setPickerSearch('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加に失敗しました')
    }
  }

  const setCompServings = async (comp: MenuComponentRow, raw: string) => {
    const n = Number(raw)
    if (Number.isNaN(n) || n <= 0) return
    try {
      await updateMenuComponentServings(comp.id, n)
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  const removeComp = async (comp: MenuComponentRow) => {
    try {
      await removeMenuComponent(comp.id)
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました')
    }
  }

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <div className="text-6xl">🍽️</div>
        <h1 className="text-xl font-bold text-amber-800">メニュー設定</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  const activeCount = menus.filter((m) => m.active).length

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-amber-800">🍽️ メニュー設定</h1>
      </div>
      <p className="text-xs text-stone-500 mb-3">
        <span className="font-semibold">有効(ON)</span>がレジに表示／原価は税込（{activeCount}件 有効）
      </p>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {menusLoading && <Spinner />}

      <div className="space-y-3">
        {menus.map((m) => {
          const comps = componentsByMenu(m.id)
          const cost = menuTotalCost(m.id)
          const rate = m.price > 0 ? (cost / m.price) * 100 : null
          return (
            <div key={m.id} className={`border rounded-xl p-3 ${m.active ? 'border-stone-300' : 'border-stone-200 bg-stone-50 opacity-70'}`}>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={nameVals[m.id] !== undefined ? nameVals[m.id] : m.name}
                  onChange={(e) => setNameVals((p) => ({ ...p, [m.id]: e.target.value }))}
                  onBlur={(e) => saveField(m, 'name', e.target.value)}
                  className="flex-1 min-w-0 border border-stone-300 rounded px-2 py-2 text-base font-semibold text-stone-900 outline-none focus:border-amber-400"
                />
                <button
                  onClick={() => toggleEnabled(m)}
                  className={`shrink-0 px-3 py-2 rounded-lg text-sm font-bold ${m.active ? 'bg-green-600 text-[#faf9f5]' : 'bg-stone-300 text-stone-600'}`}
                >
                  {m.active ? 'ON' : 'OFF'}
                </button>
                <button onClick={() => removeMenu(m)} className="text-stone-300 text-xl px-1 shrink-0" aria-label="削除">
                  ×
                </button>
              </div>

              <div className="space-y-1.5 mb-2">
                {comps.map((c) => {
                  const key = c.id
                  const cval = servEdit[key] !== undefined ? servEdit[key] : String(c.servings)
                  const cCost = recipeCostPerServing(c.recipe_id) * c.servings
                  return (
                    <div key={c.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 min-w-0 truncate text-stone-800">{c.recipes.name}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        value={cval}
                        onChange={(e) => setServEdit((p) => ({ ...p, [key]: e.target.value }))}
                        onBlur={(e) => setCompServings(c, e.target.value)}
                        className="w-14 border border-stone-300 rounded px-1.5 py-1 text-right"
                      />
                      <span className="text-xs text-stone-400 w-4">食</span>
                      <span className="w-16 text-right text-stone-600">¥{Math.round(cCost).toLocaleString()}</span>
                      <button onClick={() => removeComp(c)} className="text-stone-300 text-lg px-1 shrink-0" aria-label="外す">
                        ×
                      </button>
                    </div>
                  )
                })}
                <button
                  onClick={() => {
                    setPickerMenuId(pickerMenuId === m.id ? null : m.id)
                    setPickerSearch('')
                  }}
                  className="text-xs text-amber-700 font-semibold border border-dashed border-amber-300 rounded-full px-2.5 py-1"
                >
                  ＋ レシピを追加
                </button>

                {pickerMenuId === m.id && (
                  <div className="mt-1 border border-stone-200 rounded-lg p-2 bg-stone-50">
                    <input
                      type="text"
                      autoFocus
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder="レシピ名で検索…"
                      className="w-full border border-stone-300 rounded px-2 py-1.5 text-sm mb-2"
                    />
                    <div className="max-h-44 overflow-y-auto divide-y divide-stone-100 bg-white rounded border border-stone-200">
                      {recipes
                        .filter((r) => (pickerSearch ? r.name.includes(pickerSearch) : true))
                        .filter((r) => !comps.some((c) => c.recipe_id === r.id))
                        .slice(0, 30)
                        .map((r) => (
                          <button
                            key={r.id}
                            onClick={() => addRecipeToMenu(m.id, r.id)}
                            className="w-full text-left px-2 py-1.5 text-sm active:bg-amber-50 flex justify-between"
                          >
                            <span className="truncate">{r.name}</span>
                            <span className="text-amber-700 ml-2 shrink-0">＋</span>
                          </button>
                        ))}
                    </div>
                    <button onClick={() => setPickerMenuId(null)} className="w-full text-center text-xs text-stone-500 mt-2 py-1">
                      閉じる
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 border-t border-stone-100 pt-2">
                <div className="flex items-center border border-stone-300 rounded px-2 py-1.5 w-28">
                  <span className="text-sm text-stone-400 mr-1">¥</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={priceVals[m.id] !== undefined ? priceVals[m.id] : String(m.price)}
                    onChange={(e) => setPriceVals((p) => ({ ...p, [m.id]: e.target.value }))}
                    onBlur={(e) => saveField(m, 'price', e.target.value)}
                    className="w-full min-w-0 text-right text-base outline-none"
                  />
                </div>
                <span className="text-sm text-stone-600">原価 ¥{Math.round(cost).toLocaleString()}</span>
                {rate != null && (
                  <span className={`ml-auto text-sm font-bold px-2 py-0.5 rounded ${rate > 35 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    原価率 {rate.toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {!menusLoading && menus.length === 0 && (
          <p className="text-center text-stone-400 text-sm py-6">メニューがありません。下のボタンで追加してください。</p>
        )}

        <button onClick={addMenuNew} className="w-full border border-dashed border-stone-300 rounded-xl py-3 text-sm text-amber-700 font-semibold active:bg-stone-50">
          ＋ メニューを追加
        </button>
      </div>
    </div>
  )
}
