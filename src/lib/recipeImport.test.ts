import { describe, it, expect } from 'vitest'
import { parseRecipeText, guessDishType } from './recipeImport'

// 実際にメモアプリからコピペしたテキスト
const SAMPLE = `すだち青唐チキンビリヤニ202608

◆材料◆
テンパリング用サラダ油100→90→70○
マスタードシード4g
シナモン3cm(0.7g)
カルダモン4粒0.5g
クローブ6粒(0.5g)
玉ねぎ200g(炒めすぎない)
gg80
グリーンチリ8g(辛さを見て調整)
コリアンダーパウダー3g
チリパウダー0g
ターメリックパウダー1g→0g
クミンパウダー4g
トマトペースト0g(gg増やしてソリッド)
ヨーグルト(ナチュレ恵)100g
ビリヤニマサラ(ホールをミルで挽く)
・カルダモン2g→1g
・フェンネル2g
・ブラックペッパー1g
・クローブ0.5g
皮なし鶏もも肉700g(皮ありでOK)
すだち青唐辛子アチャール80
塩 0.5%になるように足す(2gくらい)
酢20g
砂糖5
レモン汁0

グレイヴィ1030(限界まで煮詰めた)

湯取り用水2000g
シナモン3cm
カルダモン5粒
塩50g(水の2.5%)
バスマティライス(DAAWAT CLASSIC)500g

サフラン0.2g
湯30g

仕上がり量2060g`

describe('parseRecipeText', () => {
  const parsed = parseRecipeText(SAMPLE)
  const find = (name: string) => parsed.ingredients.find((i) => i.name === name)

  it('1行目をレシピ名として取り出す', () => {
    expect(parsed.name).toBe('すだち青唐チキンビリヤニ202608')
  })

  it('レシピ名から料理タイプを推定する', () => {
    expect(parsed.dishType).toBe('ビリヤニ')
  })

  it('「仕上がり量」を総重量として取り出す', () => {
    expect(parsed.yieldG).toBe(2060)
  })

  it('◆材料◆のような見出し行は取り込まない', () => {
    expect(parsed.ingredients.some((i) => i.name.includes('◆'))).toBe(false)
  })

  it('単位なしの数字はグラム扱いにする', () => {
    expect(find('gg')).toMatchObject({ quantity: 80, unit: 'g' })
    expect(find('砂糖')).toMatchObject({ quantity: 5, unit: 'g' })
  })

  it('矢印の推移は最後の値を採用し、名前は先頭から取る', () => {
    expect(find('テンパリング用サラダ油')).toMatchObject({ quantity: 70, unit: 'g' })
    expect(find('ターメリックパウダー')).toMatchObject({ quantity: 0, unit: 'g' })
  })

  it('箇条書き（・）の行も食材として取り込む', () => {
    expect(find('フェンネル')).toMatchObject({ quantity: 2, unit: 'g' })
    expect(find('ブラックペッパー')).toMatchObject({ quantity: 1, unit: 'g' })
  })

  it('括弧内にグラム数があり本文がグラム以外なら括弧を優先する', () => {
    expect(find('シナモン')).toMatchObject({ quantity: 0.7, unit: 'g' })
    expect(find('クローブ')).toMatchObject({ quantity: 0.5, unit: 'g' })
  })

  it('括弧が名前の途中にあっても数量を取り出しメモに残す', () => {
    expect(find('バスマティライス')).toMatchObject({ quantity: 500, unit: 'g', memo: 'DAAWAT CLASSIC' })
    expect(find('ヨーグルト')).toMatchObject({ quantity: 100, unit: 'g', memo: 'ナチュレ恵' })
  })

  it('括弧内の注記をメモとして保持する', () => {
    expect(find('玉ねぎ')).toMatchObject({ quantity: 200, unit: 'g', memo: '炒めすぎない' })
  })

  it('「塩 0.5%になるように足す」は指示文を落とし、括弧内の目安量を数量にする', () => {
    const salts = parsed.ingredients.filter((i) => i.name === '塩')
    expect(salts[0]).toMatchObject({ quantity: 2, unit: 'g' })
    expect(salts[1]).toMatchObject({ quantity: 50, unit: 'g' })
  })

  it('0gの食材も取りこぼさない', () => {
    expect(find('チリパウダー')).toMatchObject({ quantity: 0 })
    expect(find('レモン汁')).toMatchObject({ quantity: 0 })
  })

  it('数量が書かれていない見出し的な行は数量nullで残す（画面で削除できる）', () => {
    expect(find('ビリヤニマサラ')).toMatchObject({ quantity: null })
  })

  it('同じ食材が複数回出てきてもそれぞれ1行として取り込む', () => {
    // 「カルダモン4粒0.5g」「・カルダモン2g→1g」「カルダモン5粒」の3行
    const cardamoms = parsed.ingredients.filter((i) => i.name === 'カルダモン')
    expect(cardamoms).toHaveLength(3)
    expect(cardamoms[0]).toMatchObject({ quantity: 0.5, unit: 'g' })
    expect(cardamoms[1]).toMatchObject({ quantity: 1, unit: 'g' })
  })

  it('グラム以外の単位はそのまま保持する', () => {
    const cardamoms = parsed.ingredients.filter((i) => i.name === 'カルダモン')
    expect(cardamoms[2]).toMatchObject({ quantity: 5, unit: '粒' })
  })
})

describe('guessDishType', () => {
  it('レシピ名のキーワードから種別を推定する', () => {
    expect(guessDishType('マトンビリヤニ')).toBe('ビリヤニ')
    expect(guessDishType('チキンカレー')).toBe('カレー')
    expect(guessDishType('鹿キーマ')).toBe('キーマ')
    expect(guessDishType('謎の料理')).toBe('その他')
  })
})
