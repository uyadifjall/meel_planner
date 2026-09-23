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
const SPOON = "大さじ|小さじ|大匙|小匙|カップ"
const UNITS = "kg|g|ml|mL|cc|L|l|カップ|個|コ|本|枚|片|かけ|玉|袋|パック|缶|束|株|房|切れ|切|尾|杯|合|丁|cm|センチ|粒|さじ|つまみ|箱|節|さく|柵|膳|振り|振|尾分|個分|本分|枚分"
// 分量のうしろに付く言葉（「大さじ3強」「320gほど」）
const QTY_SUFFIX = "(?:強|弱|ほど|程度|くらい|ぐらい|分)?"
const NUM = "\\d+(?:\\.\\d+)?(?:\\/\\d+)?(?:と\\d+\\/\\d+)?"
const VAGUE = "少々|適量|適宜|ひとつまみ|少量|お好みで|お好み|各適量|各少々"
// 「大1/2」「小1」の省略形は、数字のあとが行末・空白・括弧のときだけ（「小1節」「大根」「小松菜」は対象外）
const QTY_RE = new RegExp(
  `(${SPOON})\\s*(${NUM})|(大|小)(${NUM})(?=$|[\\s(（、,])|(${NUM})\\s*(${UNITS})?|(${VAGUE})`)

function qtyFromMatch(m) {
  if (m[1]) return { amount: m[2], unit: m[1] === "大匙" ? "大さじ" : m[1] === "小匙" ? "小さじ" : m[1] }
  if (m[3]) return { amount: m[4], unit: m[3] === "大" ? "大さじ" : "小さじ" }
  if (m[5]) return { amount: m[5], unit: m[6] || "" }
  return { amount: "", unit: m[7] }
}

// 表記の前処理：半角化・「約」・範囲「4〜6個」→「4個」・「大さじ1と小さじ1」→「小さじ4」
function normalizeQtyText(s) {
  return toHalfWidth(cleanText(s)).replace(/\s+/g, " ").trim()
    .replace(/約\s*(?=\d)/g, "")
    .replace(/(\d+(?:\.\d+)?(?:\/\d+)?)\s*[〜~～]\s*\d+(?:\.\d+)?(?:\/\d+)?/g, "$1")
    .replace(/大さじ(\d+)\s*と\s*小さじ(\d+)/g, (_, a, b) => `小さじ${Number(a) * 3 + Number(b)}`)
}

// 行頭の記号・グループ記号（●、☆、(A)、【B】、A、Aみりん、〈タレ〉、（お好みで）など）を除く
function stripLineMarks(s) {
  return s
    .replace(/^[・●○◯◎☆★◆◇■□▪︎*\-]+\s*/, "")
    .replace(/^[(（【\[]\s*[A-Za-z①-⑩]\s*[)）】\]]\s*/, "")
    .replace(/^[A-Z](?:\s+|(?=[^\x00-\x7F]))/, "")
    .replace(/^[(（](お好みで|あれば|好みで)[)）]\s*/, "")
    .replace(/※/g, "")
    .trim()
}

// 1行 → 材料の配列（「粉チーズ、牛乳…各大さじ1」は2件に分ける）。材料でない行は []
export function parseIngredientLines(line) {
  const raw = normalizeQtyText(line)
  if (!raw || /^※/.test(raw)) return []
  // 〈ずんだあん〉〈タレ〉のようなグループ見出し
  if (/^[〈<＜【\[［][^〉>＞】\]］]*[〉>＞】\]］]/.test(raw)) return []
  const s = stripLineMarks(raw)
  if (!s) return []
  const m = s.match(QTY_RE)
  let name, qty
  if (!m || m.index === 0) { name = s; qty = { amount: "", unit: "" } }
  else {
    name = s.slice(0, m.index)
    qty = qtyFromMatch(m)
  }
  const each = /各\s*$/.test(name) || (m && /^各/.test(m[0]))
  name = name.replace(/各\s*$/, "").replace(/[\s…:：・.、,]+$/, "")
    .replace(/[\s…:：]+(約|小|中|大)$/, "").replace(/\s*(約|各)$/, "").trim()
  if (!name) return []
  const names = each || !qty.unit ? name.split(/\s*[、,]\s*/).filter(Boolean) : [name]
  return names.map(n => ({ name: n, ...qty }))
}

export function parseIngredientLine(line) {
  return parseIngredientLines(line)[0] || { name: "", amount: "", unit: "" }
}

// 分量だけの文字列（例「中3個（200g）」「大さじ2」「ひとつまみ」）を量と単位に
export function parseQuantity(qty) {
  const s = normalizeQtyText(qty)
  const m = s.match(QTY_RE)
  return m ? qtyFromMatch(m) : { amount: "", unit: s }
}

// ── 文章からレシピを読む（AIなし）──
// YouTube 概要欄や貼り付けテキストの「材料…分量」「作り方①…」の形に対応。読めなければ null（→ AI へ）
const STEP_NUM_RE = /^\s*(?:[①-⑳]|STEP\s*\d+|手順\s*\d+|作り方\s*\d+|\(?\d{1,2}[.)．、）]|（\d{1,2}）)\s*/i
const ING_HEADER_RE = /^[【\[■◆●<＜〈(（]?\s*(材料|具材|用意するもの)/
const STEP_HEADER_RE = /^[【\[■◆●<＜〈(（]?\s*(作り方|作りかた|手順|レシピ手順|調理手順)/
const SEPARATOR_RE = /^[ー―─━=＝\-~〜～]{3,}$/

// 行の最後が分量で終わっていれば材料行とみなす（「胸肉320gを薄切りにし…」のような文は除外）
function asIngredientLine(line) {
  const s = stripLineMarks(normalizeQtyText(line))
  if (!s || s.length > 40 || /[。]/.test(s) || /https?:/.test(s)) return null
  const m = s.match(new RegExp(`(?:${QTY_RE.source})${QTY_SUFFIX}\\s*(?:[(（][^)）]*[)）])?\\s*$`))
  if (!m || m.index === 0) return null
  const before = s.slice(0, m.index)
  if (!before.replace(/[\s…:：・.、,各約]/g, "") || before.length > 25) return null
  if (/[をにでがはへ]\S*(する|入れ|切|混ぜ)/.test(before)) return null
  const items = parseIngredientLines(line)
  return items.length ? items : null
}

// 「材料」見出し（「栗ごはんの材料 (2合分)」のような形も含む）
function isIngHeader(l) { return ING_HEADER_RE.test(l) || (l.length <= 25 && /の材料|材料\s*[(（]/.test(l)) }
// 作り方の途中に出てくる小見出しや広告表記（句読点がない短い行）
function isHeadingLine(l) {
  return l.length < 25 && !/[。、！!]/.test(l) && /(\/|作り方|レシピ|下ごしらえ|のコツ|ポイント|スポンサー|広告|^PR$)/.test(l)
}

// preferTitle: Webページ全体から読むときは、材料の直前の行よりページタイトルを料理名に使う
export function parsePlainRecipe(text, title = "", { preferTitle = false } = {}) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim())
  const ingredients = []
  const steps = []
  const memos = []
  let section = "none" // none | ing | steps | done
  let firstIngIdx = -1

  for (let i = 0; i < lines.length && section !== "done"; i++) {
    const line = lines[i]
    if (!line) continue
    const hw = toHalfWidth(line)
    if (STEP_HEADER_RE.test(hw)) { section = "steps"; continue }
    if (isIngHeader(hw)) { section = "ing"; continue }
    if (SEPARATOR_RE.test(hw)) { if (steps.length) section = "done"; continue }
    // 【YouTube】【アプリリンク】など別の見出しが来たら終わり
    if (/^【[^】]*】$/.test(hw) && (steps.length || (section === "ing" && ingredients.length))) {
      if (steps.length) { section = "done"; continue }
    }
    if (/^https?:\/\//.test(hw)) { if (steps.length) section = "done"; continue }

    if (section !== "steps") {
      const ing = asIngredientLine(line)
      if (ing) { if (firstIngIdx < 0) firstIngIdx = i; ingredients.push(...ing); section = "ing"; continue }
      if (section === "ing" && ingredients.length) {
        if (/^[★☆]/.test(line)) { memos.push(line.replace(/^[★☆]\s*/, "")); continue }
        if (/^※/.test(line)) continue
        // 材料のあとに来た文は作り方として扱う
        if (line.length >= 6 || STEP_NUM_RE.test(hw)) { section = "steps" } else continue
      } else continue
    }
    if (section === "steps") {
      if (/^[★☆]/.test(line) && !STEP_NUM_RE.test(hw)) { memos.push(line.replace(/^[★☆]\s*/, "")); continue }
      if (/^※/.test(line) || isHeadingLine(hw)) continue
      // 「▼詳しい作り方は動画をご覧ください」などの案内で終わり
      if (/^[▼▽→]/.test(line)) { if (steps.length) section = "done"; continue }
      const numbered = STEP_NUM_RE.test(hw)
      const step = hw.replace(STEP_NUM_RE, "").trim()
      if (!step) continue
      // 改行で文の途中が切れている（前の行が「、」で終わる）ときはつなげる
      if (!numbered && steps.length && /[、,]$/.test(steps[steps.length - 1])) steps[steps.length - 1] += step
      else steps.push(step)
    }
  }
  if (ingredients.length < 2 || !steps.length) return null

  // 料理名：材料の直前にある見出し（【鶏胸肉のレモン漬け】など）→ タイトルの【】→ タイトル
  let name = ""
  for (let i = firstIngIdx - 1; i >= 0 && !name && !(preferTitle && title); i--) {
    const l = toHalfWidth(lines[i])
    if (!l || isIngHeader(l) || SEPARATOR_RE.test(l) || /レシピはこちら|↓/.test(l)) continue
    if (/^https?:/.test(l) || l.length > 30) break
    name = l.replace(/^[【\[★☆■◆●]+|[】\]]+$/g, "").trim()
  }
  if (!name && title) {
    name = ((title.match(/【([^】]+)】\s*$/) || [])[1] || title)
      .replace(/\s*[\/／:：|｜].*$/, "").replace(/の?(レシピ|作り方)$/, "").trim()
  }
  const servings = parseInt((toHalfWidth(text).match(/(\d+)\s*人(?:前|分)/) || [])[1], 10) || null
  return {
    name,
    servings,
    memo: memos.join(" ").slice(0, 200),
    ingredients: ingredients.map(i => ({ ...i, isSeasoning: null })),
    steps,
  }
}

// ── schema.org Recipe（JSON-LD）の読み取り ──
function findRecipeNode(node) {
  if (!node || typeof node !== "object") return null
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipeNode(n); if (r) return r } return null }
  const type = node["@type"]
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) return node
  return findRecipeNode(node["@graph"]) || findRecipeNode(node.mainEntity)
}

// 作り方：文字列1本で来た場合は改行や「作り方1.」「2.」で分割、HowToStep は1手順＝1要素にまとめる
function flattenInstructions(ins) {
  if (!ins) return []
  if (typeof ins === "string") {
    return cleanText(ins)
      .split(/\n|\s+(?=(?:下準備|作り方)\s*\d+\s*[.．]|\d{1,2}\s*[.．]\s)/)
      .map(s => s.replace(/^(?:下準備|作り方)?\s*\d{1,2}\s*[.．)）、]\s*/, "").trim())
      .filter(Boolean)
  }
  if (Array.isArray(ins)) return ins.flatMap(flattenInstructions)
  if (ins.itemListElement) return flattenInstructions(ins.itemListElement)
  const t = ins.text || ins.name
  return t ? [cleanText(t).replace(/\s*\n\s*/g, " ").trim()].filter(Boolean) : []
}

export function extractJsonLdRecipe(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const b of blocks) {
    let data
    try { data = JSON.parse(b[1].trim()) } catch { continue }
    const r = findRecipeNode(data)
    if (!r) continue
    const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : r.recipeIngredient ? [r.recipeIngredient] : [])
      .flatMap(parseIngredientLines).filter(i => i.name)
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

// ── リュウジのバズレシピ.com（WordPress。本文に【材料】【作り方】がテキストで書かれている）──
export function extractBazurecipe(html) {
  const start = html.indexOf('<section class="content">')
  if (start < 0) return null
  const endMark = html.indexOf("CONTENT END", start)
  const body = html.slice(start, endMark > 0 ? endMark : start + 60000)
    .replace(/<(figure|blockquote|script|button)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<div class='ai-viewports[^>]*><\/div>/g, " ")
  const title = decodeEntities((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "").split(/\s+[-|｜]\s+/)[0]
  const recipe = parsePlainRecipe(htmlToText(body, 20000), title)
  if (recipe && title) recipe.name = title
  return recipe
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

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
let resolvedModel = null // 関数インスタンスが生きている間はキャッシュ

// 指定モデルが無い（廃止・改名）ときは、このキーで使える最新の Flash 系モデルを探す
async function pickAvailableModel(apiKey) {
  const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey } })
  if (!res.ok) return null
  const { models = [] } = await res.json()
  const names = models
    .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map(m => m.name.replace(/^models\//, ""))
    .filter(n => /^gemini-[\d.]+-flash(-latest)?$/.test(n) || n === "gemini-flash-latest")
  const version = n => parseFloat((n.match(/gemini-([\d.]+)/) || [])[1] || "0")
  names.sort((a, b) => (b === "gemini-flash-latest") - (a === "gemini-flash-latest") || version(b) - version(a))
  return names[0] || null
}

// 無料枠は混雑で 503 / 500 が返ることがあるので、少し待って最大2回やり直す
async function callGemini(apiKey, model, payload) {
  let res
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 2000 * attempt))
    res = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(payload),
    })
    if (res.status !== 503 && res.status !== 500) break
  }
  return res
}

export async function geminiExtract({ apiKey, model, text, youtubeUrl }) {
  const parts = []
  if (youtubeUrl) parts.push({ fileData: { fileUri: youtubeUrl } })
  parts.push({ text: text ? `${PROMPT}\n\n---\n${text}` : `${PROMPT}\n\n---\nこの動画の内容からレシピを抽出してください。` })
  const payload = {
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: RECIPE_SCHEMA, temperature: 0.2 },
  }
  let res = await callGemini(apiKey, resolvedModel || model, payload)
  if (res.status === 404) {
    const fallback = await pickAvailableModel(apiKey)
    if (fallback) { resolvedModel = fallback; res = await callGemini(apiKey, fallback, payload) }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    const detail = (() => { try { return JSON.parse(body).error?.message || "" } catch { return "" } })()
    console.error("Gemini error", res.status, detail)
    if (res.status === 429) throw new Error("AIの無料枠の上限に達しました。しばらく待ってから試してください")
    if (res.status === 503 || res.status === 500) throw new Error("AIが混み合っています。1〜2分おいてもう一度試してください")
    if (/API key/i.test(detail)) throw new Error("GEMINI_API_KEY が正しくありません。Vercel の設定を確認してください")
    throw new Error(`AIの呼び出しに失敗しました（${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}）`)
  }
  const json = await res.json()
  // 思考過程（thought）のパートは除き、```json で囲まれていても読めるようにする
  const out = (json.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("")
    .replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "")
  let data
  try { data = JSON.parse(out) } catch {
    console.error("Gemini unparsable", json.candidates?.[0]?.finishReason, out.slice(0, 500))
    throw new Error("AIの応答を読み取れませんでした。もう一度試してください")
  }
  const recipe = {
    name: data.name || "",
    servings: data.servings || null,
    memo: data.memo || "",
    ingredients: (data.ingredients || []).filter(i => i && i.name).map(i => ({
      name: String(i.name).trim(), amount: toHalfWidth(i.amount ?? "").trim(), unit: String(i.unit || "").trim(), isSeasoning: !!i.isSeasoning,
    })),
    steps: (data.steps || []).map(s => String(s).trim()).filter(Boolean),
  }
  // found フラグだけに頼らず、材料か手順が取れていればレシピとして扱う
  if (!recipe.ingredients.length && !recipe.steps.length) {
    console.error("Gemini found no recipe", JSON.stringify(data).slice(0, 500))
    // 一時的な診断情報（原因がわかったら消す）
    geminiExtract.lastDebug = { model: resolvedModel || model, finishReason: json.candidates?.[0]?.finishReason, out: out.slice(0, 300) }
    return null
  }
  return recipe
}
