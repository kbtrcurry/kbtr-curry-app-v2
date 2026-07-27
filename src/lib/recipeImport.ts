// メモアプリからコピペしたレシピのテキストを解析して、レシピ登録用の構造に変換する。
// 手書きメモが元なので完全な自動化は狙わず、「だいたい解析して画面で直せる」ことを優先する。

export type ParsedIngredient = {
  name: string
  quantity: number | null
  unit: string
  memo: string
}

export type ParsedRecipe = {
  name: string
  dishType: string
  yieldG: number | null
  ingredients: ParsedIngredient[]
}

// 見出し行（◆材料◆ など）
const SECTION_RE = /^[◆■◇□【]/
// 仕上がり量・出来上がり量などの行はレシピの総重量として扱う
const YIELD_KEYWORDS = ['仕上がり量', '仕上り量', '出来上がり量', '出来上り量', '完成量', '総重量']
// 数量として認識する単位
const UNITS = ['kg', 'g', 'ml', 'L', 'l', 'cc', 'cm', '個', '粒', '本', '枚', '片', '束', '缶', 'かけ', 'つまみ']

const NUM = '[0-9]+(?:\\.[0-9]+)?'

function normalize(line: string): string {
  return line
    // 全角英数字・記号を半角へ
    .replace(/[Ａ-Ｚａ-ｚ０-９．（）]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[⇒➡︎➡→]/g, '→')
    .replace(/->/g, '→')
    .trim()
}

const UNIT_ALT = UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')

// 「カルダモン4粒0.5g」のように名前側に数量が残る場合、末尾の「数字＋単位」を落とす。
// 「塩 0.5%になるように足す」のような指示文も食材名から切り離す。
function stripTrailingQuantity(name: string): string {
  const withoutNote = name.replace(new RegExp(`\\s*${NUM}\\s*%.*$`), '').trim()
  const base = withoutNote || name
  const stripped = base.replace(new RegExp(`\\s*${NUM}\\s*(?:${UNIT_ALT})\\s*$`), '').trim()
  return stripped || base
}

// 「〜100g」のように行末の数量＋単位を取り出す
function parseQuantity(text: string): { name: string; quantity: number | null; unit: string } {
  const withUnit = text.match(new RegExp(`^(.*?)\\s*(${NUM})\\s*(${UNIT_ALT})\\s*$`))
  if (withUnit) {
    return { name: stripTrailingQuantity(withUnit[1].trim()), quantity: Number(withUnit[2]), unit: withUnit[3] }
  }
  // 単位なしの数字（例: gg80、矢印の後ろの「70」だけ）はグラム扱い
  const bare = text.match(new RegExp(`^(.*?)\\s*(${NUM})\\s*$`))
  if (bare) {
    return { name: stripTrailingQuantity(bare[1].trim()), quantity: Number(bare[2]), unit: 'g' }
  }
  return { name: stripTrailingQuantity(text.trim()), quantity: null, unit: 'g' }
}

// 括弧の中身を抜き出して本文と分離する
function splitParen(text: string): { body: string; paren: string } {
  const parens: string[] = []
  const body = text.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    parens.push(inner.trim())
    return ''
  })
  return { body: body.trim(), paren: parens.join(' / ') }
}

function parseIngredientLine(rawLine: string): ParsedIngredient | null {
  // 箇条書き記号・装飾記号を除去
  let line = rawLine.replace(/^[・\-*＊•]\s*/, '').replace(/[○◯●✔✓]/g, '').trim()
  if (!line) return null

  const { body, paren } = splitParen(line)
  line = body || line

  // 「100→90→70」のような推移は最後の値を採用しつつ、名前は先頭から取る
  const steps = line.split('→').map((s) => s.trim()).filter(Boolean)
  const head = parseQuantity(steps[0] ?? line)
  let quantity = head.quantity
  let unit = head.unit
  if (steps.length > 1) {
    for (let i = steps.length - 1; i >= 1; i--) {
      const tail = parseQuantity(steps[i])
      // 末尾セグメントは「70」「0g」のように数量だけのことが多い
      if (tail.quantity != null && !tail.name) {
        quantity = tail.quantity
        unit = tail.unit
        break
      }
      if (tail.quantity != null) {
        quantity = tail.quantity
        unit = tail.unit
        break
      }
    }
  }

  // 括弧内がグラム数のときは、本文がグラム以外（cm・粒など）ならそちらを優先する
  const parenGram = paren.match(new RegExp(`^(${NUM})\\s*g`))
  if (parenGram && unit !== 'g') {
    quantity = Number(parenGram[1])
    unit = 'g'
  } else if (parenGram && quantity == null) {
    quantity = Number(parenGram[1])
    unit = 'g'
  }

  // 「塩 0.5%になるように足す」のように数量が取れない場合、括弧内の目安量を使う
  if (quantity == null) {
    const hint = paren.match(new RegExp(`(${NUM})\\s*g`))
    if (hint) {
      quantity = Number(hint[1])
      unit = 'g'
    }
  }

  const name = head.name || line
  if (!name) return null
  return { name, quantity, unit, memo: paren }
}

const DISH_TYPE_HINTS: [string, string][] = [
  ['ビリヤニ', 'ビリヤニ'],
  ['キーマ', 'キーマ'],
  ['ダル', 'ダル'],
  ['アチャール', 'アチャール'],
  ['チャトニ', 'チャトニ'],
  ['ライタ', 'ライタ'],
  ['サブジ', 'サブジ・野菜'],
  ['ラッサム', 'その他'],
  ['カレー', 'カレー'],
]

export function guessDishType(name: string): string {
  for (const [hint, type] of DISH_TYPE_HINTS) {
    if (name.includes(hint)) return type
  }
  return 'その他'
}

/** メモのテキスト全体を解析する。1行目をレシピ名として扱う。 */
export function parseRecipeText(text: string): ParsedRecipe {
  const lines = text.split(/\r?\n/).map(normalize)
  const nonEmpty = lines.filter((l) => l !== '')
  const name = nonEmpty[0] ?? ''

  let yieldG: number | null = null
  const ingredients: ParsedIngredient[] = []

  for (const line of nonEmpty.slice(1)) {
    if (SECTION_RE.test(line)) continue

    const yieldKeyword = YIELD_KEYWORDS.find((k) => line.startsWith(k))
    if (yieldKeyword) {
      const parsed = parseQuantity(splitParen(line).body || line)
      if (parsed.quantity != null) yieldG = parsed.quantity
      continue
    }

    const parsed = parseIngredientLine(line)
    if (parsed) ingredients.push(parsed)
  }

  return { name, dishType: guessDishType(name), yieldG, ingredients }
}
