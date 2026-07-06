// マスタデータ（食材・レシピ・メニュー）のドメインロジック。
// 食材単価は税抜で保存し、原価計算時にのみ TAX を掛けて税込に換算する（v1と同じ規約）。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fetchAllPages } from './supabasePaging'

export const TAX = 1.08 // 軽減税率8%

// ---------- 食材 ----------

export type Ingredient = {
  id: string
  name: string
  category: string
  unit: string
  unit_price_per_g: number | null
  pack_weight_g: number | null
  pack_price: number | null
  stock_g: number
  alert_threshold_g: number | null
  supplier: string
  memo: string
  created_at: string
}

export function ingredientPricePerG(ing: Pick<Ingredient, 'unit_price_per_g' | 'pack_weight_g' | 'pack_price'>): number | null {
  if (ing.unit_price_per_g != null && ing.unit_price_per_g > 0) return ing.unit_price_per_g
  if (ing.pack_weight_g && ing.pack_weight_g > 0 && ing.pack_price != null) {
    return ing.pack_price / ing.pack_weight_g
  }
  return null
}

export function isLowStock(ing: Pick<Ingredient, 'stock_g' | 'alert_threshold_g'>): boolean {
  return ing.alert_threshold_g !== null && ing.alert_threshold_g !== undefined && ing.stock_g < ing.alert_threshold_g
}

export async function fetchIngredients(): Promise<Ingredient[]> {
  const { data, error } = await supabase
    .from('ingredients')
    .select('id, name, category, unit, unit_price_per_g, pack_weight_g, pack_price, stock_g, alert_threshold_g, supplier, memo, created_at')
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}
export function useIngredients() {
  return useQuery({ queryKey: ['ingredients'], queryFn: fetchIngredients, staleTime: 60_000 })
}

export type NewIngredient = { name: string; category?: string; unit?: string; supplier?: string }
export async function createIngredient(input: NewIngredient): Promise<string> {
  const { data, error } = await supabase
    .from('ingredients')
    .insert({
      name: input.name,
      category: input.category ?? '',
      unit: input.unit || 'g',
      supplier: input.supplier ?? '',
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export type IngredientPatch = Partial<
  Pick<Ingredient, 'name' | 'category' | 'unit' | 'unit_price_per_g' | 'pack_weight_g' | 'pack_price' | 'stock_g' | 'alert_threshold_g' | 'supplier' | 'memo'>
>
export async function updateIngredient(id: string, patch: IngredientPatch): Promise<void> {
  const { error } = await supabase.from('ingredients').update(patch).eq('id', id)
  if (error) throw error
}

// ---------- 仕入れ履歴 ----------

export type IngredientPurchase = {
  id: string
  ingredient_id: string
  purchased_on: string
  quantity: number | null
  total_price: number
  memo: string
}

export async function fetchIngredientPurchases(ingredientId: string): Promise<IngredientPurchase[]> {
  const { data, error } = await supabase
    .from('ingredient_purchases')
    .select('id, ingredient_id, purchased_on, quantity, total_price, memo')
    .eq('ingredient_id', ingredientId)
    .order('purchased_on', { ascending: false })
    .limit(10)
  if (error) throw error
  return data ?? []
}

export type RecordPurchaseParams = {
  ingredientId: string
  purchasedOn: string
  quantity: number | null
  totalPrice: number
  memo?: string
}
// 仕入れを記録し、数量が分かれば単価(円/g)も自動更新する
export async function recordIngredientPurchase(params: RecordPurchaseParams): Promise<void> {
  const { error } = await supabase.from('ingredient_purchases').insert({
    ingredient_id: params.ingredientId,
    purchased_on: params.purchasedOn,
    quantity: params.quantity,
    total_price: params.totalPrice,
    memo: params.memo ?? '',
  })
  if (error) throw error
  if (params.quantity && params.quantity > 0) {
    const perG = Math.round((params.totalPrice / params.quantity) * 10000) / 10000
    await updateIngredient(params.ingredientId, { unit_price_per_g: perG })
  }
}

// ---------- レシピ ----------

export type Recipe = {
  id: string
  name: string
  dish_type: string
  yield_g: number | null
  serving_weight_g: number | null
  servings: number | null
  sale_price: number | null
  memo: string
  created_at: string
}

export type RecipeIngredientRow = {
  id: string
  recipe_id: string
  ingredient_id: string
  quantity: number
  unit: string
  memo: string
  ingredients: Pick<Ingredient, 'name' | 'unit_price_per_g' | 'pack_weight_g' | 'pack_price'>
}

export const RECIPE_TYPES = [
  'カレー', 'ビリヤニ', 'キーマ', 'ダル', 'サブジ・野菜', 'アチャール',
  'チャトニ', 'ライタ', '揚げ物', 'ご飯もの', 'パン・麺', 'ドリンク', 'その他',
]

export async function fetchRecipes(): Promise<Recipe[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, name, dish_type, yield_g, serving_weight_g, servings, sale_price, memo, created_at')
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}
export function useRecipes() {
  return useQuery({ queryKey: ['recipes'], queryFn: fetchRecipes, staleTime: 60_000 })
}

const RECIPE_INGREDIENTS_SELECT =
  'id, recipe_id, ingredient_id, quantity, unit, memo, ingredients(name, unit_price_per_g, pack_weight_g, pack_price)'

export async function fetchRecipeIngredients(recipeId: string): Promise<RecipeIngredientRow[]> {
  const { data, error } = await supabase
    .from('recipe_ingredients')
    .select(RECIPE_INGREDIENTS_SELECT)
    .eq('recipe_id', recipeId)
  if (error) throw error
  return (data ?? []) as unknown as RecipeIngredientRow[]
}
export function useRecipeIngredients(recipeId: string | null) {
  return useQuery({
    queryKey: ['recipe_ingredients', recipeId],
    queryFn: () => fetchRecipeIngredients(recipeId as string),
    enabled: !!recipeId,
    staleTime: 30_000,
  })
}

// 全レシピ分の食材明細を一括取得（メニュー設定・仕込み計画での原価計算に使う）
// 4000行超あるため range() でページング取得しないと後半のレシピが無言で欠落する
export async function fetchAllRecipeIngredients(): Promise<RecipeIngredientRow[]> {
  return fetchAllPages<RecipeIngredientRow>(
    (from, to) =>
      supabase.from('recipe_ingredients').select(RECIPE_INGREDIENTS_SELECT).range(from, to) as unknown as PromiseLike<{
        data: RecipeIngredientRow[] | null
        error: { message: string } | null
      }>,
  )
}
export function useAllRecipeIngredients() {
  return useQuery({ queryKey: ['recipe_ingredients', 'all'], queryFn: fetchAllRecipeIngredients, staleTime: 30_000 })
}

// recipe_id ごとにグループ化（原価計算のルックアップ用）
export function groupRecipeIngredientsByRecipe(all: RecipeIngredientRow[]): Record<string, RecipeIngredientRow[]> {
  const map: Record<string, RecipeIngredientRow[]> = {}
  for (const it of all) {
    if (!map[it.recipe_id]) map[it.recipe_id] = []
    map[it.recipe_id].push(it)
  }
  return map
}

export async function createRecipe(name: string, dishType: string): Promise<string> {
  const { data, error } = await supabase.from('recipes').insert({ name, dish_type: dishType }).select('id').single()
  if (error) throw error
  return data.id
}

export type RecipePatch = Partial<
  Pick<Recipe, 'name' | 'dish_type' | 'yield_g' | 'serving_weight_g' | 'servings' | 'sale_price' | 'memo'>
>
export async function updateRecipe(id: string, patch: RecipePatch): Promise<void> {
  const { error } = await supabase.from('recipes').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteRecipe(id: string): Promise<void> {
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw error
}

export async function addRecipeIngredient(
  recipeId: string,
  ingredientId: string,
  quantity: number,
  unit: string,
): Promise<void> {
  const { error } = await supabase
    .from('recipe_ingredients')
    .insert({ recipe_id: recipeId, ingredient_id: ingredientId, quantity, unit })
  if (error) throw error
}

export async function updateRecipeIngredient(
  id: string,
  patch: Partial<Pick<RecipeIngredientRow, 'quantity' | 'unit' | 'memo'>>,
): Promise<void> {
  const { error } = await supabase.from('recipe_ingredients').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteRecipeIngredient(id: string): Promise<void> {
  const { error } = await supabase.from('recipe_ingredients').delete().eq('id', id)
  if (error) throw error
}

// ---------- 原価計算 ----------

// レシピ全体の原価（税込）
export function recipeTotalCost(items: RecipeIngredientRow[]): number {
  return items.reduce((s, it) => {
    const per = ingredientPricePerG(it.ingredients) ?? 0
    return s + it.quantity * per * TAX
  }, 0)
}

// 食数の実効値（食数入力 → 総重量/一食重量 → なし）
export function effectiveServings(recipe: Pick<Recipe, 'servings' | 'yield_g' | 'serving_weight_g'>): number | null {
  if (recipe.servings && recipe.servings > 0) return recipe.servings
  if (recipe.yield_g && recipe.serving_weight_g && recipe.serving_weight_g > 0) {
    return recipe.yield_g / recipe.serving_weight_g
  }
  return null
}

// レシピの一食あたり原価（税込）
export function perServingCost(recipe: Pick<Recipe, 'servings' | 'yield_g' | 'serving_weight_g'>, items: RecipeIngredientRow[]): number {
  const total = recipeTotalCost(items)
  const eff = effectiveServings(recipe)
  return eff ? total / eff : total
}

// ---------- メニュー ----------

export type Menu = { id: string; name: string; price: number; active: boolean; sort_order: number }

export type MenuComponentRow = {
  id: string
  menu_id: string
  recipe_id: string
  servings: number
  recipes: Pick<Recipe, 'name' | 'servings' | 'yield_g' | 'serving_weight_g'>
}

export async function fetchAllMenus(): Promise<Menu[]> {
  const { data, error } = await supabase
    .from('menus')
    .select('id, name, price, active, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}
export function useAllMenus() {
  return useQuery({ queryKey: ['menus', 'all'], queryFn: fetchAllMenus, staleTime: 30_000 })
}

const MENU_COMPONENTS_SELECT =
  'id, menu_id, recipe_id, servings, recipes(name, servings, yield_g, serving_weight_g)'

export async function fetchAllMenuComponents(): Promise<MenuComponentRow[]> {
  const { data, error } = await supabase.from('menu_components').select(MENU_COMPONENTS_SELECT)
  if (error) throw error
  return (data ?? []) as unknown as MenuComponentRow[]
}
export function useAllMenuComponents() {
  return useQuery({ queryKey: ['menu_components', 'all'], queryFn: fetchAllMenuComponents, staleTime: 30_000 })
}

export async function createMenu(name: string, price: number): Promise<string> {
  const { data, error } = await supabase.from('menus').insert({ name, price }).select('id').single()
  if (error) throw error
  return data.id
}

export async function updateMenu(id: string, patch: Partial<Pick<Menu, 'name' | 'price' | 'active' | 'sort_order'>>): Promise<void> {
  const { error } = await supabase.from('menus').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteMenu(id: string): Promise<void> {
  const { error } = await supabase.from('menus').delete().eq('id', id)
  if (error) throw error
}

export async function addMenuComponent(menuId: string, recipeId: string, servings: number): Promise<void> {
  const { error } = await supabase.from('menu_components').insert({ menu_id: menuId, recipe_id: recipeId, servings })
  if (error) throw error
}

export async function updateMenuComponentServings(id: string, servings: number): Promise<void> {
  const { error } = await supabase.from('menu_components').update({ servings }).eq('id', id)
  if (error) throw error
}

export async function removeMenuComponent(id: string): Promise<void> {
  const { error } = await supabase.from('menu_components').delete().eq('id', id)
  if (error) throw error
}

// メニュー1食分の原価（税込）= Σ 構成レシピの一食原価 × 食分
export function menuCost(
  components: MenuComponentRow[],
  recipeIngredientsByRecipeId: Record<string, RecipeIngredientRow[]>,
): number {
  return components.reduce((s, c) => {
    const items = recipeIngredientsByRecipeId[c.recipe_id] ?? []
    return s + perServingCost(c.recipes, items) * c.servings
  }, 0)
}

export function useInvalidateMasterData() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['ingredients'] })
    void qc.invalidateQueries({ queryKey: ['recipes'] })
    void qc.invalidateQueries({ queryKey: ['recipe_ingredients'] })
    void qc.invalidateQueries({ queryKey: ['menus'] })
    void qc.invalidateQueries({ queryKey: ['menu_components'] })
  }
}
