// レシピ取り込みの共通処理（api/ 配下で _ 始まりのファイルは Vercel の関数として公開されない）

// 全角英数・記号・スペースを半角に
export function toHalfWidth(str) {
  return String(str)
    .replace(/[Ａ-Ｚａ-ｚ０-９．／]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
export function decodeEntities(str) {
  return String(str)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
}

export function cleanText(str) {
  return decodeEntities(String(str ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim()
}

// ── 材料1行を 名前・量・単位 に分解（例：「鶏もも肉 1枚(300g)」「(A)しょうゆ 大さじ2」「塩 少々」）──
// 「大1/2」「小1」の省略形も含む（直後に数字が来る場合だけマッチするので「大根」「小松菜」は対象外）
const SPOON = "大さじ|小さじ|大匙|小匙|カップ|大|小"
function normalizeSpoon(u) { return u === "大" || u === "大匙" ? "大さじ" : u === "小" || u === "小匙" ? "小さじ" : u }
const UNITS = "kg|g|ml|mL|cc|L|l|カップ|個|本|枚|片|かけ|玉|袋|パック|缶|束|株|房|切れ|切|尾|杯|合|丁|cm|センチ|粒|さじ|つまみ|箱|尾分|個分|本分|枚分"
const NUM = "\\d+(?:\\.\\d+)?(?:\\/\\d+)?(?:と\\d+\\/\\d+)?"
const VAGUE = "少々|適量|適宜|ひとつまみ|少量|お好みで|お好み|各適量|各少々"
const QTY_RE = new RegExp(`(${SPOON})\\s*(${NUM})|(${NUM})\\s*(${UNITS})?|(${VAGUE})`)

export function parseIngredientLine(line) {
  let s = toHalfWidth(cleanText(line)).replace(/\s+/g, " ").trim()
  // 先頭の記号やグループ記号（●、☆、(A)、【B】、A など）を除去
  s = s.replace(/^[・●○◯◎☆★◆◇■□▪︎※*\-]+\s*/, "")
  s = s.replace(/^[(（【\[]\s*[A-Za-z①-⑩]\s*[)）】\]]\s*/, "").replace(/^[A-Za-z]\s+/, "")
  const m = s.match(QTY_RE)
  if (!m || m.index === 0) return { name: s, amount: "", unit: "" }
  const name = s.slice(0, m.index).replace(/[\s…:：・.、,]+$/, "").trim()
  if (!name) return { name: s, amount: "", unit: "" }
  if (m[1]) return { name, amount: m[2], unit: normalizeSpoon(m[1]) }
  if (m[3]) return { name, amount: m[3], unit: m[4] || "" }
  return { name, amount: "", unit: m[5] }
}

// ── schema.org Recipe（JSON-LD）の読み取り ──
function findRecipeNode(node) {
  if (!node || typeof node !== "object") return null
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipeNode(n); if (r) return r } return null }
  const type = node["@type"]
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) return node
  return findRecipeNode(node["@graph"]) || findRecipeNode(node.mainEntity)
}

function flattenInstructions(ins) {
  if (!ins) return []
  if (typeof ins === "string") return cleanText(ins).split("\n").map(s => s.trim()).filter(Boolean)
  if (Array.isArray(ins)) return ins.flatMap(flattenInstructions)
  if (ins.itemListElement) return flattenInstructions(ins.itemListElement)
  if (ins.text) return flattenInstructions(ins.text)
  if (ins.name) return flattenInstructions(ins.name)
  return []
}

export function extractJsonLdRecipe(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const b of blocks) {
    let data
    try { data = JSON.parse(b[1].trim()) } catch { continue }
    const r = findRecipeNode(data)
    if (!r) continue
    const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : r.recipeIngredient ? [r.recipeIngredient] : [])
      .map(parseIngredientLine).filter(i => i.name)
    const steps = flattenInstructions(r.recipeInstructions)
      .map(s => s.replace(/^\d+[.)．、]\s*/, ""))
    if (!ingredients.length && !steps.length) continue
    const yieldText = toHalfWidth([].concat(r.recipeYield || "")[0] || "")
    const servings = parseInt((yieldText.match(/\d+/) || [])[0], 10) || null
    return {
      name: cleanText(r.name || ""),
      servings,
      memo: "",
      ingredients: ingredients.map(i => ({ ...i, isSeasoning: null })),
      steps,
    }
  }
  return null
}

// 分量だけの文字列（例「中3個（200g）」「大さじ2」「ひとつまみ」）を量と単位に
export function parseQuantity(qty) {
  const s = toHalfWidth(cleanText(qty)).replace(/\s+/g, " ").trim()
  const m = s.match(QTY_RE)
  if (!m) return { amount: "", unit: s }
  if (m[1]) return { amount: m[2], unit: normalizeSpoon(m[1]) }
  if (m[3]) return { amount: m[3], unit: m[4] || "" }
  return { amount: "", unit: m[5] }
}

// ── クックパッド（JSON-LD がないため HTML から読む）──
// 未ログインでは材料・手順の一部しか表示されないことがあるので、その場合は truncated を立てる
export function extractCookpadRecipe(html) {
  const flat = html.replace(/\n/g, " ")
  const ingredients = [...flat.matchAll(/<li id="ingredient_\d+"[^>]*class="([^"]*)"[^>]*>\s*<span>([\s\S]*?)<\/span>\s*(?:<bdi[^>]*>([\s\S]*?)<\/bdi>)?/g)]
    .filter(m => !/\bheadline\b/.test(m[1].replace("not-headline", "")))
    .map(m => ({ name: cleanText(m[2]).replace(/^[・●○◯◎☆★◆◇■□※]+\s*/, ""), ...parseQuantity(m[3] || ""), isSeasoning: null }))
    .filter(i => i.name)
  const steps = [...flat.matchAll(/id="step_\d+"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map(m => cleanText(m[1])).filter(Boolean)
  if (!ingredients.length && !steps.length) return null
  const title = decodeEntities((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || "")
  const servingText = cleanText((flat.match(/id="serving_recipe_\d+"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "")
  const servings = parseInt((toHalfWidth(servingText).match(/(\d+)\s*[〜~～-]?\s*\d*\s*人/) || [])[1], 10) || null
  const truncated = /あと\d+点あります/.test(flat) || /premium-recipe-explanation-target/.test(flat) && steps.length < 3
  return { name: title.replace(/\s*by\s+.+$/, "").trim(), servings, memo: "", ingredients, steps, truncated }
}

// ページ本文をAIに渡すためのテキスト化
export function htmlToText(html, max = 15000) {
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|p|div|li|h\d|tr)[^>]*>/gi, "\n")
  return cleanText(body).slice(0, max)
}

// ── YouTube ──
export function getYouTubeId(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\.|^m\./, "")
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null
    if (host === "youtube.com" || host === "music.youtube.com") {
      if (u.searchParams.get("v")) return u.searchParams.get("v")
      const m = u.pathname.match(/^\/(shorts|live|embed)\/([^/?]+)/)
      if (m) return m[2]
    }
  } catch {}
  return null
}

// ── Gemini ──
const RECIPE_SCHEMA = {
  type: "OBJECT",
  properties: {
    found: { type: "BOOLEAN" },
    name: { type: "STRING" },
    servings: { type: "INTEGER" },
    memo: { type: "STRING" },
    ingredients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          amount: { type: "STRING" },
          unit: { type: "STRING" },
          isSeasoning: { type: "BOOLEAN" },
        },
        required: ["name", "amount", "unit", "isSeasoning"],
      },
    },
    steps: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["found", "name", "servings", "memo", "ingredients", "steps"],
}

const PROMPT = `あなたは料理レシピの整理係です。与えられた情報からレシピを1つ抽出し、日本語のJSONで返してください。
ルール:
- found: レシピ（材料と作り方）が読み取れたら true。料理と無関係・情報不足なら false にして他は空で返す。
- name: 料理名（「【簡単】」などの装飾や動画タイトルの煽り文句は除く）。
- servings: 何人分か（不明なら 2）。
- ingredients: 材料。amount は数字だけ（例 "300", "1/2", "1と1/2"）、unit は単位（g, ml, 個, 本, 枚, 大さじ, 小さじ, カップ など）。「少々」「適量」は amount を "" にして unit に入れる。
- isSeasoning: 醤油・みりん・砂糖・塩・油・だし・スパイス等の調味料なら true、食材なら false。
- steps: 作り方を手順ごとに短く分けた配列（番号は付けない）。
- memo: コツやポイントがあれば1〜2文。なければ ""。
- 書かれていない材料や分量を推測で作らないこと。`

export async function geminiExtract({ apiKey, model, text, youtubeUrl }) {
  const parts = []
  if (youtubeUrl) parts.push({ fileData: { fileUri: youtubeUrl } })
  parts.push({ text: text ? `${PROMPT}\n\n---\n${text}` : `${PROMPT}\n\n---\nこの動画の内容からレシピを抽出してください。` })
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: RECIPE_SCHEMA, temperature: 0.2 },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    if (res.status === 429) throw new Error("AIの無料枠の上限に達しました。しばらく待ってから試してください")
    if (res.status === 400 && /API key/i.test(body)) throw new Error("GEMINI_API_KEY が正しくありません")
    throw new Error(`AIの呼び出しに失敗しました（${res.status}）`)
  }
  const json = await res.json()
  const out = json.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || ""
  let data
  try { data = JSON.parse(out) } catch { throw new Error("AIの応答を読み取れませんでした") }
  if (!data.found) return null
  return {
    name: data.name || "",
    servings: data.servings || null,
    memo: data.memo || "",
    ingredients: (data.ingredients || []).filter(i => i.name).map(i => ({
      name: i.name.trim(), amount: toHalfWidth(i.amount || "").trim(), unit: (i.unit || "").trim(), isSeasoning: !!i.isSeasoning,
    })),
    steps: (data.steps || []).map(s => s.trim()).filter(Boolean),
  }
}
