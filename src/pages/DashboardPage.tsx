import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { useClosedSessions, useReceiptLines, salesBySession, daysAgoStr, monthOf, type ClosedSession } from '../lib/analytics'
import {
  useAllRecipeIngredients,
  useAllMenuComponents,
  groupRecipeIngredientsByRecipe,
  menuCost,
} from '../lib/masterData'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`
type DashTab = 'summary' | 'products' | 'prep'

type SumPeriod = 'month' | '4w' | '3m' | '6m' | '1y'
const SUM_PERIODS: { key: SumPeriod; label: string; days: number | null }[] = [
  { key: 'month', label: '今月', days: null },
  { key: '4w', label: '過去4週', days: 28 },
  { key: '3m', label: '過去3ヶ月', days: 90 },
  { key: '6m', label: '過去半年', days: 180 },
  { key: '1y', label: '過去1年', days: 365 },
]
const thisMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type Period = 'all' | 'last4' | 'last8'

type Rank = 'star' | 'plow' | 'puzzle' | 'dog'
const RANK_META: Record<Rank, { label: string; cls: string }> = {
  star: { label: '看板', cls: 'bg-green-100 text-green-700' },
  plow: { label: '集客', cls: 'bg-amber-100 text-amber-800' },
  puzzle: { label: '隠れ', cls: 'bg-stone-200 text-stone-700' },
  dog: { label: '見直し', cls: 'bg-red-100 text-red-600' },
}

const peopleOf = (s: ClosedSession) => (s.people > 0 ? s.people : s.groups)

export default function DashboardPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const { data: sessions = [], isLoading: sessionsLoading } = useClosedSessions()
  const { data: lines = [], isLoading: linesLoading } = useReceiptLines()
  const { data: allRecipeIngredients = [] } = useAllRecipeIngredients()
  const { data: menuComponents = [] } = useAllMenuComponents()

  const [dashTab, setDashTab] = useState<DashTab>('summary')
  const [sumPeriod, setSumPeriod] = useState<SumPeriod>('month')
  const [period, setPeriod] = useState<Period>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [targetInput, setTargetInput] = useState('')

  const recipeIngredientsByRecipe = groupRecipeIngredientsByRecipe(allRecipeIngredients)

  // メニューID → 一食原価（税込・理論値）
  const costByMenuId = useMemo(() => {
    const map: Record<string, number> = {}
    const byMenu: Record<string, typeof menuComponents> = {}
    for (const c of menuComponents) {
      if (!byMenu[c.menu_id]) byMenu[c.menu_id] = []
      byMenu[c.menu_id].push(c)
    }
    for (const [menuId, comps] of Object.entries(byMenu)) {
      map[menuId] = menuCost(comps, recipeIngredientsByRecipe)
    }
    return map
  }, [menuComponents, recipeIngredientsByRecipe])

  const salesMap = useMemo(() => salesBySession(lines), [lines])
  const foodCostBySession = useMemo(() => {
    const map: Record<string, number> = {}
    for (const l of lines) {
      const cost = l.menu_id ? (costByMenuId[l.menu_id] ?? 0) * l.qty : 0
      map[l.session_id] = (map[l.session_id] ?? 0) + cost
    }
    return map
  }, [lines, costByMenuId])

  const tm = thisMonth()
  const periodMeta = SUM_PERIODS.find((p) => p.key === sumPeriod) ?? SUM_PERIODS[0]
  const cutoff = periodMeta.days != null ? daysAgoStr(periodMeta.days) : null
  const inPeriod = (date: string) => (cutoff != null ? date >= cutoff : monthOf(date) === tm)

  const pSessions = sessions.filter((s) => inPeriod(s.session_date))
  const pSales = pSessions.reduce((a, s) => a + (salesMap[s.id] ?? 0), 0)
  const pFoodCost = pSessions.reduce((a, s) => a + (foodCostBySession[s.id] ?? 0), 0)
  const pFee = pSessions.reduce((a, s) => a + s.rent, 0)
  const pOther = pSessions.reduce((a, s) => a + s.other_cost, 0)
  const pPeople = pSessions.reduce((a, s) => a + peopleOf(s), 0)
  const pProfit = pSales - pFoodCost - pFee - pOther
  const pRate = pSales > 0 ? (pFoodCost / pSales) * 100 : null
  const avgTicket = pPeople > 0 ? pSales / pPeople : null
  const totalSales = sessions.reduce((a, s) => a + (salesMap[s.id] ?? 0), 0)

  const sortedSessions = [...sessions].sort((a, b) => b.session_date.localeCompare(a.session_date))
  const recentMax = Math.max(1, ...sortedSessions.map((s) => salesMap[s.id] ?? 0))
  const last8 = sortedSessions.slice(0, 8).reverse()

  const linesBySession = useMemo(() => {
    const map: Record<string, typeof lines> = {}
    for (const l of lines) {
      if (!map[l.session_id]) map[l.session_id] = []
      map[l.session_id].push(l)
    }
    return map
  }, [lines])

  // ── 商品別 ──
  const eventDates = [...new Set(sortedSessions.map((s) => s.session_date))]
  const periodSessionIds = (() => {
    if (period === 'all') return new Set(sessions.map((s) => s.id))
    const n = period === 'last4' ? 4 : 8
    return new Set(sortedSessions.slice(0, n).map((s) => s.id))
  })()
  const periodLines = lines.filter((l) => periodSessionIds.has(l.session_id))

  const productRanked = useMemo(() => {
    const map: Record<string, { name: string; qty: number; amount: number; menuId: string | null }> = {}
    for (const l of periodLines) {
      if (!map[l.name_snapshot]) map[l.name_snapshot] = { name: l.name_snapshot, qty: 0, amount: 0, menuId: l.menu_id }
      map[l.name_snapshot].qty += l.qty
      map[l.name_snapshot].amount += l.qty * l.unit_price
    }
    const items = Object.values(map).map((p) => {
      const price = p.qty > 0 ? p.amount / p.qty : 0
      const cost = p.menuId ? (costByMenuId[p.menuId] ?? 0) : 0
      const margin = price > 0 ? (price - cost) / price : 0
      const costRate = p.menuId && price > 0 ? (cost / price) * 100 : null
      return { ...p, price, cost, margin, costRate }
    })
    const avgQty = items.length ? items.reduce((s, x) => s + x.qty, 0) / items.length : 0
    const avgMargin = items.length ? items.reduce((s, x) => s + x.margin, 0) / items.length : 0
    return items
      .map((x) => {
        const pop = x.qty >= avgQty
        const prof = x.margin >= avgMargin
        const rank: Rank = pop && prof ? 'star' : pop && !prof ? 'plow' : !pop && prof ? 'puzzle' : 'dog'
        return { ...x, rank }
      })
      .sort((a, b) => b.amount - a.amount)
  }, [periodLines, costByMenuId])
  const totalAmount = productRanked.reduce((s, p) => s + p.amount, 0)
  const totalQty = productRanked.reduce((s, p) => s + p.qty, 0)
  const hasCostData = productRanked.some((p) => p.costRate != null)

  // ── 仕込み予測 ──
  const target = Math.max(0, parseInt(targetInput) || 0)
  const prepCalc = useMemo(() => {
    if (eventDates.length === 0) return null
    const evts = eventDates.map((date) => {
      const s = sessions.find((x) => x.session_date === date)
      const dayLines = lines.filter((l) => s && l.session_id === s.id)
      const menuQty: Record<string, number> = {}
      for (const l of dayLines) menuQty[l.name_snapshot] = (menuQty[l.name_snapshot] ?? 0) + l.qty
      return { date, groups: s?.groups ?? 0, menuQty }
    })
    const withGroups = evts.filter((e) => e.groups > 0)
    const usePerGroup = withGroups.length >= 3
    const allMenuNames = [...new Set(lines.map((l) => l.name_snapshot))]
    const sufficient = evts.length >= 3
    if (usePerGroup) {
      const totalGroups = withGroups.reduce((s, e) => s + e.groups, 0)
      return {
        unit: '人',
        sufficient,
        items: allMenuNames
          .map((name) => ({
            name,
            avg: totalGroups > 0 ? withGroups.reduce((s, e) => s + (e.menuQty[name] ?? 0), 0) / totalGroups : 0,
          }))
          .filter((x) => x.avg > 0)
          .sort((a, b) => b.avg - a.avg),
      }
    }
    const n = evts.length
    return {
      unit: '回平均',
      sufficient,
      items: allMenuNames
        .map((name) => ({ name, avg: n > 0 ? evts.reduce((s, e) => s + (e.menuQty[name] ?? 0), 0) / n : 0 }))
        .filter((x) => x.avg > 0)
        .sort((a, b) => b.avg - a.avg),
    }
  }, [eventDates, sessions, lines])

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <div className="text-6xl">📊</div>
        <h1 className="text-xl font-bold text-amber-800">ダッシュボード</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  const loading = sessionsLoading || linesLoading
  const hasData = sessions.length > 0

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold text-amber-800">📊 ダッシュボード</h1>
      </div>

      {loading && <Spinner />}

      {!loading && !hasData && (
        <div className="text-center text-stone-500 text-sm py-12">
          <p>営業データがありません。</p>
          <p className="mt-2">レジで会計・締めをすると、ここに売上が表示されます。</p>
        </div>
      )}

      {hasData && (
        <>
          <div className="flex border-b border-stone-200 mb-4">
            {(['summary', 'products', 'prep'] as DashTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setDashTab(t)}
                className={`flex-1 py-2 text-xs sm:text-sm font-semibold transition-colors ${
                  dashTab === t ? 'border-b-2 border-amber-600 text-amber-700' : 'text-stone-500'
                }`}
              >
                {t === 'summary' ? 'サマリー' : t === 'products' ? '商品別' : '仕込み'}
              </button>
            ))}
          </div>

          {dashTab === 'summary' && (
            <>
              <div className="flex gap-1.5 mb-3 overflow-x-auto">
                {SUM_PERIODS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setSumPeriod(p.key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
                      sumPeriod === p.key ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-5 mb-4">
                <p className="text-xs text-stone-500 mb-0.5">{periodMeta.label}の推定利益（理論原価ベース）</p>
                <p className={`text-4xl font-extrabold leading-tight ${pProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                  {yen(pProfit)}
                </p>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <HeroStat label="売上" value={yen(pSales)} />
                  <HeroStat label="原価率(理論)" value={pRate != null ? `${pRate.toFixed(1)}%` : '—'} accent />
                  <HeroStat label="客単価" value={avgTicket != null ? yen(avgTicket) : '—'} />
                </div>
                <p className="text-xs text-stone-400 mt-3">累計売上 {yen(totalSales)}</p>
                <p className="text-xs text-stone-400 mt-1">※実費ベースの実際の利益は「会計」タブのP&amp;Lを参照</p>
              </div>

              {last8.length > 0 && (
                <Section title="売上・推定利益の推移（直近8回）">
                  <LineChart
                    data={last8.map((s) => ({
                      label: s.session_date.slice(5).replace('-', '/'),
                      sales: salesMap[s.id] ?? 0,
                      profit: (salesMap[s.id] ?? 0) - (foodCostBySession[s.id] ?? 0) - s.rent - s.other_cost,
                    }))}
                  />
                  <div className="flex gap-4 justify-center text-xs mt-1">
                    <span className="text-stone-500">
                      <span style={{ color: '#d9824f' }}>●</span> 売上
                    </span>
                    <span className="text-stone-500">
                      <span style={{ color: '#6bcf8c' }}>●</span> 推定利益
                    </span>
                  </div>
                </Section>
              )}

              <Section title="営業履歴">
                <div className="space-y-2">
                  {sortedSessions.map((s) => {
                    const open = openId === s.id
                    const sales = salesMap[s.id] ?? 0
                    const foodCost = foodCostBySession[s.id] ?? 0
                    const profit = sales - foodCost - s.rent - s.other_cost
                    const rate = sales > 0 ? (foodCost / sales) * 100 : null
                    const ppl = peopleOf(s)
                    const dayLines = linesBySession[s.id] ?? []
                    const menuAgg: Record<string, { qty: number; amount: number }> = {}
                    for (const l of dayLines) {
                      if (!menuAgg[l.name_snapshot]) menuAgg[l.name_snapshot] = { qty: 0, amount: 0 }
                      menuAgg[l.name_snapshot].qty += l.qty
                      menuAgg[l.name_snapshot].amount += l.qty * l.unit_price
                    }
                    const menuList = Object.entries(menuAgg).sort((a, b) => b[1].amount - a[1].amount)
                    return (
                      <div key={s.id} className="border border-stone-200 rounded-xl overflow-hidden bg-white">
                        <button onClick={() => setOpenId(open ? null : s.id)} className="w-full text-left px-3.5 py-3">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-stone-800 w-16 shrink-0">
                              {s.session_date.slice(5).replace('-', '/')}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between text-xs text-stone-500 mb-1">
                                <span>
                                  売上 <b className="text-stone-900">{yen(sales)}</b>
                                </span>
                                <span>
                                  推定利益 <b className="text-green-700">{yen(profit)}</b>
                                </span>
                              </div>
                              <div className="h-1.5 bg-stone-100 rounded overflow-hidden">
                                <div className="h-full bg-amber-500" style={{ width: `${(sales / recentMax) * 100}%` }} />
                              </div>
                            </div>
                            <span className="text-stone-400 shrink-0">{open ? '▾' : '▸'}</span>
                          </div>
                        </button>

                        {open && (
                          <div className="px-3 pb-3 pt-1 border-t border-stone-100 text-sm">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 my-2">
                              <Row label="売上" value={yen(sales)} />
                              <Row label="食材原価（理論）" value={yen(foodCost)} />
                              <Row label="場所代" value={yen(s.rent)} />
                              {s.other_cost > 0 && <Row label="その他経費" value={yen(s.other_cost)} />}
                              <Row label="推定利益" value={yen(profit)} accent />
                              <Row label="原価率（理論）" value={rate != null ? `${rate.toFixed(1)}%` : '—'} />
                              {s.groups > 0 && <Row label="組数 / 客数" value={`${s.groups}組 / ${ppl}人`} />}
                              {ppl > 0 && <Row label="客単価" value={yen(sales / ppl)} />}
                              <Row label="事業区分" value={s.segments?.name ?? '—'} />
                            </div>
                            {s.memo && <p className="text-stone-500 mb-2">メモ: {s.memo}</p>}
                            {menuList.length > 0 && (
                              <div className="bg-stone-50 rounded-lg p-2">
                                <p className="text-xs text-stone-400 mb-1">メニュー別</p>
                                {menuList.map(([mn, v]) => (
                                  <div key={mn} className="flex justify-between py-0.5 text-stone-700">
                                    <span className="truncate">
                                      {mn} <span className="text-stone-400">×{v.qty}</span>
                                    </span>
                                    <span className="font-medium text-stone-800 shrink-0 ml-2">{yen(v.amount)}</span>
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
              </Section>
            </>
          )}

          {dashTab === 'products' && (
            <div>
              <div className="flex gap-1.5 mb-4">
                {(['all', 'last4', 'last8'] as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1.5 rounded-full text-sm font-semibold ${
                      period === p ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'
                    }`}
                  >
                    {p === 'all' ? '全期間' : p === 'last4' ? '直近4回' : '直近8回'}
                  </button>
                ))}
              </div>

              {productRanked.length === 0 ? (
                <p className="text-center text-stone-400 text-sm py-8">データがありません</p>
              ) : (
                <>
                  {hasCostData && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {(['star', 'plow', 'puzzle', 'dog'] as Rank[]).map((r) => (
                        <span key={r} className={`text-xs px-2 py-0.5 rounded-full font-semibold ${RANK_META[r].cls}`}>
                          {RANK_META[r].label}
                        </span>
                      ))}
                      <span className="text-xs text-stone-400 self-center ml-1">売れ筋×利益で分類</span>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-stone-200 text-stone-500 text-xs">
                          <th className="text-left pb-2">商品名</th>
                          <th className="text-right pb-2 pr-2">販売数</th>
                          <th className="text-right pb-2 pr-2">売上</th>
                          {hasCostData && <th className="text-right pb-2 pr-2">原価率</th>}
                          <th className="text-right pb-2">構成比</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productRanked.map((p) => (
                          <tr key={p.name} className="border-b border-stone-100">
                            <td className="py-2 pr-2 font-medium text-stone-800">
                              <div className="flex items-center gap-1.5">
                                {hasCostData && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${RANK_META[p.rank].cls}`}>
                                    {RANK_META[p.rank].label}
                                  </span>
                                )}
                                <span className="truncate">{p.name}</span>
                              </div>
                            </td>
                            <td className="py-2 pr-2 text-right text-stone-700">{p.qty}</td>
                            <td className="py-2 pr-2 text-right text-stone-700">{yen(p.amount)}</td>
                            {hasCostData && (
                              <td className="py-2 pr-2 text-right text-stone-600">
                                {p.costRate != null ? `${p.costRate.toFixed(0)}%` : '—'}
                              </td>
                            )}
                            <td className="py-2 text-right">
                              <span className="text-stone-500">{totalAmount > 0 ? Math.round((p.amount / totalAmount) * 100) : 0}%</span>
                              <div className="h-1.5 bg-stone-100 rounded mt-0.5">
                                <div
                                  className="h-full bg-amber-500 rounded"
                                  style={{ width: `${totalAmount > 0 ? (p.amount / totalAmount) * 100 : 0}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-stone-300 font-semibold text-stone-800">
                          <td className="pt-2">合計</td>
                          <td className="pt-2 text-right pr-2">{totalQty}</td>
                          <td className="pt-2 text-right pr-2">{yen(totalAmount)}</td>
                          {hasCostData && <td />}
                          <td className="pt-2 text-right">100%</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {dashTab === 'prep' && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <label className="text-sm text-stone-700 shrink-0">目標人数</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  placeholder="20"
                  className="w-24 border border-stone-300 rounded-lg px-3 py-2 text-lg text-right"
                />
                <span className="text-stone-500">人</span>
              </div>

              {prepCalc == null ? (
                <p className="text-center text-stone-400 text-sm py-8">営業データがありません</p>
              ) : (
                <>
                  {!prepCalc.sufficient && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                      ※ データが少ないため参考値です（3回以上の営業データが必要）
                    </p>
                  )}
                  <p className="text-xs text-stone-500 mb-2">過去 {eventDates.length} 回の 1{prepCalc.unit} あたり平均より推定</p>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-stone-200 text-stone-500 text-xs">
                          <th className="text-left pb-2">商品名</th>
                          <th className="text-right pb-2 pr-2">平均（1{prepCalc.unit}）</th>
                          {target > 0 && <th className="text-right pb-2">目標 {target} 人分</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {prepCalc.items.map((item) => (
                          <tr key={item.name} className="border-b border-stone-100">
                            <td className="py-2 pr-2 font-medium text-stone-800 truncate max-w-36">{item.name}</td>
                            <td className="py-2 pr-2 text-right text-stone-600">{item.avg.toFixed(2)} 食</td>
                            {target > 0 && (
                              <td className="py-2 text-right font-bold text-amber-800 text-base">{Math.ceil(item.avg * target)} 食</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {target === 0 && <p className="text-xs text-stone-400 mt-3 text-center">目標人数を入力すると推定量を表示します</p>}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function HeroStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`text-lg font-bold ${accent ? 'text-amber-800' : 'text-stone-900'}`}>{value}</p>
    </div>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-stone-500">{label}</span>
      <span className={`font-semibold ${accent ? 'text-green-700' : 'text-stone-800'}`}>{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-stone-700">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function LineChart({ data }: { data: { label: string; sales: number; profit: number }[] }) {
  const W = 320
  const H = 170
  const padL = 10
  const padR = 10
  const padT = 14
  const padB = 26
  const n = data.length
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const sales = data.map((d) => d.sales)
  const profit = data.map((d) => d.profit)
  const maxV = Math.max(1, ...sales, ...profit, 0)
  const minV = Math.min(0, ...profit)
  const range = maxV - minV || 1
  const x = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i * plotW) / (n - 1))
  const y = (v: number) => padT + (1 - (v - minV) / range) * plotH
  const poly = (arr: number[]) => arr.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const zeroY = y(0)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="#3a3733" strokeWidth="1" />
      <polyline fill="none" stroke="#d9824f" strokeWidth="2" points={poly(sales)} />
      <polyline fill="none" stroke="#6bcf8c" strokeWidth="2" points={poly(profit)} />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.sales)} r="2.5" fill="#d9824f" />
          <circle cx={x(i)} cy={y(d.profit)} r="2.5" fill="#6bcf8c" />
          <text x={x(i)} y={H - 8} fontSize="10" textAnchor="middle" fill="#918b81">
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
