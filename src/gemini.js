const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY

// AQ.から始まる新形式キーはv1エンドポイントを使用
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-lite:generateContent"

const SYSTEM_PROMPT = `あなたはレシピ解析AIです。与えられた情報からレシピを抽出し、必ず以下の純粋なJSONのみを返してください。前置きや説明文、マークダウンの\`\`\`は一切不要です。JSONだけを返してください。

{
  "recipeName": "レシピ名",
  "servingSize": 2,
  "ingredients": [
    { "name": "食材名", "amount": 1.5, "unit": "個", "type": "通常食材", "category": "野菜・果物" }
  ],
  "steps": ["手順1", "手順2"],
  "memo": "コツ（あれば）"
}

カテゴリは「野菜・果物」「肉・魚」「卵・乳製品」「加工食品・大豆製品」「乾物・麺類・パスタ」「調味料」「冷凍食品・その他」のいずれか。
調味料（醤油・砂糖・塩・みりん・酒・酢・油・味噌・片栗粉・小麦粉等）はtype="調味料"、category="調味料"。
分量は数値に変換（「1個と1/2」→1.5、「少々」→0.5、「適量」→0）。
servingSizeが不明なら2。`

async function callGemini(contextText) {
  const prompt = SYSTEM_PROMPT + "\n\n以下の情報からレシピを抽出してください:\n\n" + contextText

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
    })
  })

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}))
    throw new Error(`Gemini APIエラー(${res.status}): ${errData.error?.message || JSON.stringify(errData)}`)
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
  if (!text) throw new Error("AIから応答がありませんでした")

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error("レシピ情報を抽出できませんでした: " + text.slice(0, 200))

  return JSON.parse(jsonMatch[0])
}

// URLからページテキストを取得
async function fetchPageText(url) {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
  const res = await fetch(proxyUrl)
  if (!res.ok) throw new Error("ページの取得に失敗しました")
  const data = await res.json()
  const html = data.contents || ""
  const tmp = document.createElement("div")
  tmp.innerHTML = html
  tmp.querySelectorAll("script,style,nav,footer,header").forEach(el => el.remove())
  const text = tmp.innerText || tmp.textContent || ""
  return text.replace(/\s+/g, " ").trim().slice(0, 8000)
}

function getYouTubeId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/)
  return m ? m[1] : null
}

export async function extractRecipeFromUrl(url) {
  let contextText = ""
  const ytId = getYouTubeId(url)
  if (ytId) {
    try {
      const oRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`)
      if (oRes.ok) {
        const odata = await oRes.json()
        contextText = `YouTube動画タイトル: ${odata.title}\n投稿者: ${odata.author_name}\nこのタイトルからレシピ情報を推測してください。`
      }
    } catch (_) {}
    if (!contextText) contextText = `YouTube URL: ${url}\nこのURLの動画タイトルからレシピ情報を推測してください。`
  } else {
    try {
      contextText = await fetchPageText(url)
    } catch (_) {
      contextText = `レシピサイトURL: ${url}\nこのURLからレシピ情報を推測してください。`
    }
  }
  return await callGemini(contextText)
}

export async function extractRecipeFromText(text) {
  return await callGemini(text)
}

// 単位換算
const TO_ML = { "大さじ": 15, "小さじ": 5, "カップ": 200, "ml": 1, "cc": 1, "l": 1000 }
const TO_G  = { "kg": 1000, "g": 1 }

export function normalizeUnit(amount, unit) {
  if (TO_ML[unit]) return { amount: amount * TO_ML[unit], unit: "ml" }
  if (TO_G[unit])  return { amount: amount * TO_G[unit],  unit: "g" }
  return { amount, unit }
}

const NAME_ALIASES = {
  "豚バラ": "豚バラ肉", "豚ばら": "豚バラ肉", "ポーク": "豚肉",
  "鶏むね": "鶏むね肉", "鶏もも": "鶏もも肉", "チキン": "鶏肉",
  "牛肉（薄切り）": "牛薄切り肉", "牛こま": "牛こま肉",
  "ねぎ": "長ねぎ", "ネギ": "長ねぎ",
  "人参": "にんじん", "ニンジン": "にんじん",
  "玉葱": "玉ねぎ", "タマネギ": "玉ねぎ",
  "じゃが芋": "じゃがいも", "ジャガイモ": "じゃがいも",
  "しょうゆ": "醤油", "しょう油": "醤油",
  "味醂": "みりん", "上白糖": "砂糖",
}

export function normalizeName(name) {
  return NAME_ALIASES[name] || name
}

export function mergeIngredientsAdvanced(selections, recipes) {
  const map = {}
  selections.forEach(sel => {
    const recipe = recipes.find(r => r.id === sel.recipeId)
    if (!recipe) return
    recipe.ingredients.filter(i => i.type === "通常食材").forEach(ing => {
      const normalName = normalizeName(ing.name)
      const { amount, unit } = normalizeUnit(Number(ing.amount) * sel.portion, ing.unit)
      const key = `${normalName}__${unit}`
      if (!map[key]) map[key] = { ...ing, name: normalName, amount: 0, unit }
      map[key].amount += amount
    })
  })
  return Object.values(map).map(i => ({ ...i, amount: Math.round(i.amount * 10) / 10 }))
}
