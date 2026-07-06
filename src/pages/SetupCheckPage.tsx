import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type CheckState = { label: string; ok: boolean | null; detail?: string }

/** Phase 0 用: Supabase 接続・スキーマ・認証の疎通を確認する仮ホーム画面 */
export default function SetupCheckPage() {
  const { session, loading, loginWithGoogle, logout } = useAuth()
  const [checks, setChecks] = useState<CheckState[]>([])

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
        <h1 className="text-2xl font-bold text-stone-900">コバタロカレー v2</h1>
        <p className="text-stone-500 text-sm mt-1">セットアップ確認（Phase 0）v{__APP_VERSION__}</p>
      </header>

      <section className="bg-white rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-stone-800">1. Supabase 設定</h2>
        {isSupabaseConfigured ? (
          <p className="text-green-600">環境変数 OK</p>
        ) : (
          <p className="text-red-500 text-sm">
            .env に VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を設定してください（.env.example 参照）
          </p>
        )}
      </section>

      <section className="bg-white rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-stone-800">2. ログイン</h2>
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

      <section className="bg-white rounded-xl p-4 space-y-2">
        <h2 className="font-semibold text-stone-800">3. スキーマ疎通</h2>
        {checks.length === 0 && <p className="text-stone-500 text-sm">ログイン後に確認します</p>}
        {checks.map((c) => (
          <div key={c.label} className="flex justify-between text-sm">
            <span className="text-stone-700">{c.label}</span>
            <span className={c.ok ? 'text-green-600' : 'text-red-500'}>
              {c.ok ? c.detail : `NG: ${c.detail}`}
            </span>
          </div>
        ))}
      </section>
    </div>
  )
}
