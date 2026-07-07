import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Carrot, BookOpen, UtensilsCrossed, Receipt, ChevronRight, Settings, ChefHat } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { usePersistedState } from '../lib/persistState'
import {
  useRecipes,
  useAllRecipeIngredients,
  groupRecipeIngredientsByRecipe,
  perServingCost,
} from '../lib/masterData'

type CheckState = { label: string; ok: boolean | null; detail?: string }

const HUB_LINKS = [
  { to: '/ingredients', label: '食材', icon: Carrot },
  { to: '/recipes', label: 'レシピ', icon: BookOpen },
  { to: '/menus', label: 'メニュー', icon: UtensilsCrossed },
  { to: '/prep', label: '仕込み', icon: ChefHat },
  { to: '/tax', label: '申告', icon: Receipt },
]

export default function SetupCheckPage() {
  const { session, loading, loginWithGoogle, logout } = useAuth()
  const [checks, setChecks] = useState<CheckState[]>([])

  const { data: recipes = [] } = useRecipes()
  const { data: allRecipeIngredients = [] } = useAllRecipeIngredients()
  const recipeIngredientsByRecipe = groupRecipeIngredientsByRecipe(allRecipeIngredients)
  const [toriokiRecipeId, setToriokiRecipeId] = usePersistedState('kbtr_v2_torioki_recipe', '')
  const toriokiRecipe = recipes.find((r) => r.id === toriokiRecipeId)
  const toriokiCostPerServing = toriokiRecipe
    ? perServingCost(toriokiRecipe, recipeIngredientsByRecipe[toriokiRecipeId] ?? [])
    : 0

  useEffect(() => {
    if (!isSupabaseConfigured || !session) return
    const run = async () => {
      // 初回ログインユーザーを所有者として登録（登録済みなら何もしない）
      await supabase.rpc('claim_ownership')
      const results: CheckState[] = []
      const tables = ['segments', 'accounts', 'menus', 'sales_sessions'] as const
      for (const t of tables) {
        const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true })
        results.push({
          label: `テーブル ${t}`,
          ok: !error,
          detail: error ? error.message : `${count ?? 0} 件`,
        })
      }
      setChecks(results)
    }
    void run()
  }, [session])

  return (
    <div className="mx-auto max-w-md p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-stone-900 flex items-center gap-2">
          <Settings className="w-6 h-6" /> 設定
        </h1>
        <p className="text-stone-500 text-sm mt-1">v{__APP_VERSION__}.{__BUILD_DATE__}</p>
      </header>

      <section className="bg-white rounded-xl overflow-hidden divide-y divide-stone-100">
        {HUB_LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="flex items-center gap-3 px-4 py-3.5 active:bg-stone-50 transition-colors"
          >
            <link.icon className="w-5 h-5 text-amber-700 shrink-0" strokeWidth={2} />
            <span className="flex-1 text-stone-800 font-medium">{link.label}</span>
            <ChevronRight className="w-4 h-4 text-stone-300 shrink-0" />
          </Link>
        ))}
      </section>

      <section className="bg-white rounded-xl p-4 space-y-2">
        <h2 className="font-semibold text-stone-800">取り置き特典</h2>
        <p className="text-xs text-stone-500">
          レジ締め時に入力する取り置き人数×このレシピの一食原価を、分析タブの推定利益から自動で差し引きます。
        </p>
        <select
          value={toriokiRecipeId}
          onChange={(e) => setToriokiRecipeId(e.target.value)}
          className="w-full border border-stone-300 rounded-lg px-2 py-2 text-sm bg-white"
        >
          <option value="">未設定</option>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {toriokiRecipeId && toriokiCostPerServing > 0 && (
          <p className="text-xs text-stone-400">一食原価 ¥{Math.round(toriokiCostPerServing).toLocaleString()}</p>
        )}
      </section>

      <section className="bg-white rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-stone-800">ログイン</h2>
        {loading ? (
          <p className="text-stone-500">確認中…</p>
        ) : session ? (
          <div className="flex items-center justify-between">
            <p className="text-green-600 text-sm">{session.user.email}</p>
            <button
              onClick={() => void logout()}
              className="text-sm text-stone-500 border border-stone-300 rounded-lg px-3 py-1"
            >
              ログアウト
            </button>
          </div>
        ) : (
          <button
            onClick={() => void loginWithGoogle()}
            disabled={!isSupabaseConfigured}
            className="w-full bg-amber-500 text-stone-900 font-semibold rounded-lg py-3 disabled:opacity-40"
          >
            Google でログイン
          </button>
        )}
      </section>

      <details className="bg-white rounded-xl p-4">
        <summary className="font-semibold text-stone-800 cursor-pointer">接続診断</summary>
        <div className="space-y-2 mt-3">
          {isSupabaseConfigured ? (
            <p className="text-green-600 text-sm">環境変数 OK</p>
          ) : (
            <p className="text-red-500 text-sm">
              .env に VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を設定してください（.env.example 参照）
            </p>
          )}
          {checks.length === 0 && <p className="text-stone-500 text-sm">ログイン後に確認します</p>}
          {checks.map((c) => (
            <div key={c.label} className="flex justify-between text-sm">
              <span className="text-stone-700">{c.label}</span>
              <span className={c.ok ? 'text-green-600' : 'text-red-500'}>
                {c.ok ? c.detail : `NG: ${c.detail}`}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
