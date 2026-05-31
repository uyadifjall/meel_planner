const GEMINI_API_KEY = "AIzaSyAQAb8RN6IQeJyeckBAGRUtnHV7mHaSLcOeVBK3MAZAReJsTfFIfg"
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`

const STORE_ORDER = ["野菜・果物","肉・魚","卵・乳製品","加工食品・大豆製品","乾物・麺類・パスタ","調味料","冷凍食品・その他"]

const SYSTEM_PROMPT = `あなたはレシピ解析AIです。与えられたテキストからレシピ情報を抽出し、必ず以下の純粋なJSONのみを返してください。説明文やマークダウンは一切不要です。

JSON形式:
{
  "recipeName": "レシピ名",
  "servingSize": 2,
  "ingredients": [
    {
      "name": "食材名",
      "amount": 1.5,
      "unit": "個",
      "type": "通常食材 または 調味料",
      "category": "野菜・果物 / 肉・魚 / 卵・乳製品 / 加工食品・大豆製品 / 乾物・麺類・パスタ / 調味料 / 冷凍食品・その他 のいずれか"
    }
  ],
  "steps": ["手順1", "手順2"],
  "memo": "ポイントやコツ（あれば）"
}

ルール:
- 分量は必ず数値に変換。「1個と1/2」→1.5、「少々」→0.5、「適量」→0
- 「大さじ」「小さじ」「ml」「g」「個」「本」「枚」「片」「袋」等の単位を正確に抽出
- 調味料（醤油・砂糖・塩・みりん・酒・酢・油・味噌等）はtype="調味料"、category="調味料"
- 野菜・肉・魚等はtype="通常食材"
- servingSizeが不明なら2とする`

export async function extractRecipeFromUrl(url) {
  // URLからテキストを取得してGeminiに渡す
  const userPrompt = `以下のURLのレシピページの内容を解析してレシピ情報をJSONで返してください。
URLにアクセスできない場合は、URLから推測できる範囲でレシピ名だけでも抽出してください。

URL: ${url}

もしYouTubeのURLの場合は動画タイトルや概要欄からレシピ情報を推測してください。`

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: SYSTEM_PROMPT + "\n\n" + userPrompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
    })
  })
  if (!res.ok) throw new Error(`Gemini API エラー: ${res.status}`)
  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
  const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  return JSON.parse(clean)
}

export async function extractRecipeFromText(text) {
  const userPrompt = `以下のレシピテキストを解析してJSONで返してください:\n\n${text}`
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: SYSTEM_PROMPT + "\n\n" + userPrompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
    })
  })
  if (!res.ok) throw new Error(`Gemini API エラー: ${res.status}`)
  const data = await res.json()
  const text2 = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
  const clean = text2.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  return JSON.parse(clean)
}

// 単位換算テーブル（mlに統一）
const TO_ML = { "大さじ": 15, "小さじ": 5, "カップ": 200, "ml": 1, "cc": 1, "l": 1000 }
const TO_G  = { "kg": 1000, "g": 1 }

export function normalizeUnit(amount, unit) {
  if (TO_ML[unit]) return { amount: amount * TO_ML[unit], unit: "ml" }
  if (TO_G[unit])  return { amount: amount * TO_G[unit],  unit: "g" }
  return { amount, unit }
}

// 食材名の表記ゆれ吸収（簡易マッピング）
const NAME_ALIASES = {
  "豚バラ": "豚バラ肉", "豚ばら": "豚バラ肉", "ポーク": "豚肉",
  "鶏むね": "鶏むね肉", "鶏もも": "鶏もも肉", "チキン": "鶏肉",
  "牛肉（薄切り）": "牛薄切り肉", "牛こま": "牛こま肉",
  "ねぎ": "長ねぎ", "ネギ": "長ねぎ",
  "人参": "にんじん", "ニンジン": "にんじん",
  "玉葱": "玉ねぎ", "タマネギ": "玉ねぎ",
  "じゃが芋": "じゃがいも", "ジャガイモ": "じゃがいも",
  "醤油": "醤油", "しょうゆ": "醤油", "しょう油": "醤油",
  "みりん": "みりん", "味醂": "みりん",
  "砂糖": "砂糖", "上白糖": "砂糖",
}

export function normalizeName(name) {
  return NAME_ALIASES[name] || name
}

// 複数レシピの食材を合算
export function mergeIngredientsAdvanced(selections, recipes) {
  const map = {}
  selections.forEach(sel => {
    const recipe = recipes.find(r => r.id === sel.recipeId)
    if (!recipe) return
    recipe.ingredients.filter(i => i.type === "通常食材").forEach(ing => {
      const normalName = normalizeName(ing.name)
      const { amount, unit } = normalizeUnit(ing.amount * sel.portion, ing.unit)
      const key = `${normalName}__${unit}`
      if (!map[key]) map[key] = { ...ing, name: normalName, amount: 0, unit }
      map[key].amount += amount
    })
  })
  // 小数点第1位に丸める
  return Object.values(map).map(i => ({ ...i, amount: Math.round(i.amount * 10) / 10 }))
}
