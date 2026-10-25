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
const VAGUE = "少々|適量|適宜|ひとつまみ|ひとかけ|ひと片|ひとにぎり|ひとつかみ|少量|お好みで|お好み|各適量|各少々"
// 「大1/2」「小1」の省略形は、数字のあとが行末・空白・括弧のときだけ（「小1節」「大根」「小松菜」は対象外）
const QTY_RE = new RegExp(
  `(${SPOON})\\s*(${NUM})|(大|小)(${NUM})(?=$|[\\s(（、,])|(${NUM})\\s*(${UNITS})?|(${VAGUE})`)

function qtyFromMatch(m) {
  if (m[1]) return { amount: m[2], unit: m[1] === "大匙" ? "大さじ" : m[1] === "小匙" ? "小さじ" : m[1] }
  if (m[3]) return { amount: m[4], unit: m[3] === "大" ? "大さじ" : "小さじ" }
  if (m[5]) return { amount: m[5], unit: m[6] || "" }
  return { amount: "", unit: m[7] }
}

// 表記の前処理：半角化・「約」・範囲「4〜6個」→「4個」・「大さじ1と小さじ1」→「小さじ4」・「大さじ1×2回」→「大さじ2」
function normalizeQtyText(s) {
  return toHalfWidth(cleanText(s)).replace(/\s+/g, " ").trim()
    .replace(/約\s*(?=\d)/g, "")
    .replace(/(\d+(?:\.\d+)?)\s*[×xX＊*]\s*(\d+(?:\.\d+)?)\s*回(分)?/g, (_, a, b) => String(Math.round(Number(a) * Number(b) * 100) / 100))
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

// 材料でも作り方でもない、レシピの情報の行（「調理時間：10分」「冷蔵保存：4日」「エネルギー 540kcal」など）
const META_LINE_RE = /^(調理時間|所要時間|準備時間|保存期間|冷蔵保存|冷凍保存|保存|エネルギー|カロリー|熱量|塩分|食塩相当量|野菜摂取量|たんぱく質|脂質|炭水化物|糖質|人数|費用|目安|難易度|分量)\s*[:：(（]?/

// 行末の分量（うしろのカッコ書き「(約200g)」は許す）
const QTY_AT_END_RE = new RegExp(`(?:${QTY_RE.source})${QTY_SUFFIX}\\s*(?:[(（][^)）]*[)）])?\\s*$`)

// 1行 → 材料の配列（「粉チーズ、牛乳…各大さじ1」は2件に分ける）。材料でない行は []
export function parseIngredientLines(line) {
  const raw = normalizeQtyText(line)
  if (!raw || /^※/.test(raw) || /レシピID|https?:/.test(raw)) return []
  // 〈ずんだあん〉〈タレ〉のようなグループ見出し
  if (/^[〈<＜【\[［][^〉>＞】\]］]*[〉>＞】\]］]/.test(raw)) return []
  const s = stripLineMarks(raw)
  if (!s) return []
  // 行末の分量を優先（「中華スープの素（メモ1）小1.5」のカッコ内の数字を分量と取り違えない）
  if (META_LINE_RE.test(s)) return []
  const m = s.match(QTY_AT_END_RE) || s.match(QTY_RE)
  let name, qty
  if (!m || m.index === 0) { name = s; qty = { amount: "", unit: "" } }
  else {
    name = s.slice(0, m.index)
    qty = qtyFromMatch(m)
    // 「玉ねぎ 中2個 400g」のように分量が2つ並ぶときは、前のほうを分量にする（うしろはグラム換算）
    const m2 = name.replace(/\s+$/, "").match(QTY_AT_END_RE)
    if (m2 && m2.index > 0 && /\s$/.test(name)) { qty = qtyFromMatch(m2); name = name.replace(/\s+$/, "").slice(0, m2.index) }
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
// loose: 材料の欄を読んでいる途中なら「名前…分量」の形も材料として受け入れる
function asIngredientLine(line, { loose = false } = {}) {
  const s = stripLineMarks(normalizeQtyText(line))
  if (META_LINE_RE.test(s)) return null
  if (!s || s.length > 40 || /[。]/.test(s) || /https?:/.test(s)) return null
  const m = s.match(new RegExp(`(?:${QTY_RE.source})${QTY_SUFFIX}\\s*(?:[(（][^)）]*[)）])?\\s*$`))
  if (!m || m.index === 0) {
    // 「名前…分量」の形なら、分量が見慣れない書き方でも材料として扱う（例「油…大さじ1を2回」「卵…L玉」）
    // ここで材料と判定できないと、以降の材料がすべて作り方に入ってしまうため
    const sep = loose && s.match(/^(.{1,20}?)\s*(?:…+|\.{2,}|‥+|・{2,}|:|：)\s*(.{1,20})$/)
    if (sep && !/[をにでがはへ]\S*(する|入れ|切|混ぜ)/.test(sep[1])) {
      const name = sep[1].trim()
      if (name) return [{ name, ...parseQuantity(sep[2]) }]
    }
    return null
  }
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

// 分量だけの行（「1枚」「大さじ1」「小さじ」「1/2」「適量」）
const QTY_ONLY_RE = new RegExp(`^(?:(?:${QTY_RE.source})${QTY_SUFFIX}|大さじ|小さじ|カップ|${NUM})\\s*(?:[(（][^)）]*[)）])?$`)
const QTY_END_PLAIN_RE = new RegExp(`(?:${QTY_RE.source})${QTY_SUFFIX}\\s*$`)

// 材料の欄で、名前と分量が別の行に分かれているページ（「鶏もも肉 ⏎ 1枚 ⏎ 250g」「小さじ ⏎ 1/2」）を1行にまとめる
function joinQuantityLines(raw) {
  const out = []
  let inIng = false
  for (const l of raw) {
    const hw = toHalfWidth(l)
    if (STEP_HEADER_RE.test(hw)) inIng = false
    else if (isIngHeader(hw)) inIng = true
    const prev = out.length - 1
    if (inIng && l && prev >= 0 && out[prev] && out[prev].length <= 30 && !isIngHeader(toHalfWidth(out[prev])) && QTY_ONLY_RE.test(normalizeQtyText(l))) {
      const p = out[prev]
      // 前の行がもう分量で終わっていれば（「1枚」のあとの「250g」）カッコ書きで足す
      const pEndsQty = QTY_END_PLAIN_RE.test(normalizeQtyText(p)) && !/(大さじ|小さじ|カップ)$/.test(p)
      out[prev] = pEndsQty ? `${p}(${l})` : `${p} ${l}`
      continue
    }
    out.push(l)
  }
  return out
}

// 作り方のあとに続く、レシピ以外の欄の見出し（ここで読み取りを終える）
const AFTER_STEPS_RE = /^(\[?豆知識|裏ワザ|アレンジ|バリエーション|関連|この記事|このレシピ(に|を|の作者|へ)|おすすめ|人気|ランキング|PR$|広告|シェア|コメント|こちらもおすすめ|レシピ一覧|前の|次の|タグ|カテゴリ|著者|監修|クッキングレポ|つくれぽ|お料理メモ|よくある質問|Q&A|あわせて読みたい|同じ|似ている|新着|特集|もっと見る|この商品|商品情報|使用した商品|ご購入|SNS|フォロー)/
// 作り方に混ぜない行（写真のクレジットなど）
const SKIP_LINE_RE = /^(Photo by|photo:|写真[:：]|画像[:：]|出典[:：]|\(?撮影)/i

// preferTitle: Webページ全体から読むときは、材料の直前の行よりページタイトルを料理名に使う
// allowNoSteps: 作り方が無くても材料が取れればレシピとして返す（呼び出し側で動画の概要欄などから補う）
export function parsePlainRecipe(text, title = "", { preferTitle = false, allowNoSteps = false } = {}) {
  const lines = joinQuantityLines(String(text).split(/\r?\n/).map(l => l.trim()))
  const ingredients = []
  const steps = []
  const memos = []
  let section = "none" // none | ing | afterIng | steps | done
  let firstIngIdx = -1
  let nextIsNewStep = false

  for (let i = 0; i < lines.length && section !== "done"; i++) {
    const line = lines[i]
    if (!line) continue
    const hw = toHalfWidth(line)
    if (STEP_HEADER_RE.test(hw)) { section = "steps"; continue }
    if (isIngHeader(hw)) { section = "ing"; continue }
    if (SEPARATOR_RE.test(hw)) {
      if (steps.length) section = "done"
      // 材料の直後の区切り線：次が「作り方」見出しか番号付きの手順でなければ、そこで終わり
      // （「高評価＆チャンネル登録お願いします！」などを作り方として拾わないように）
      else if (section === "ing" && ingredients.length) section = "afterIng"
      continue
    }
    if (section === "afterIng") {
      if (STEP_NUM_RE.test(hw)) section = "steps"
      else { section = "done"; continue }
    }
    // 【YouTube】【アプリリンク】など別の見出しが来たら終わり
    if (/^【[^】]*】$/.test(hw) && (steps.length || (section === "ing" && ingredients.length))) {
      if (steps.length) { section = "done"; continue }
    }
    if (/^https?:\/\//.test(hw)) { if (steps.length) section = "done"; continue }

    if (section !== "steps") {
      const ing = asIngredientLine(line, { loose: section === "ing" })
      if (ing) { if (firstIngIdx < 0) firstIngIdx = i; ingredients.push(...ing); section = "ing"; continue }
      if (section === "ing" && ingredients.length) {
        if (/^[★☆]/.test(line)) { memos.push(line.replace(/^[★☆]\s*/, "")); continue }
        if (/^※/.test(line)) continue
        // 「▼詳しい作り方は動画をご覧ください」：本文に作り方は無いのでここで終わり
        if (/^[▼▽]/.test(line)) { section = "done"; continue }
        // 少し先に「作り方」の見出しがあれば、それまでの行（「このレシピは〇〇を使っています」など）は飛ばす
        if (lines.slice(i + 1, i + 9).some(l => STEP_HEADER_RE.test(toHalfWidth(l)))) continue
        if (lines.slice(i + 1, i + 3).some(l => l && asIngredientLine(l, { loose: true }))) continue
        if (META_LINE_RE.test(hw)) continue
        if (AFTER_STEPS_RE.test(hw) || SKIP_LINE_RE.test(hw) || /^\d{1,2}$/.test(hw)) continue
        // 材料のあとに来た文は作り方として扱う
        if (line.length >= 6 || STEP_NUM_RE.test(hw)) { section = "steps" } else continue
      } else continue
    }
    if (section === "steps") {
      if (/^[★☆]/.test(line) && !STEP_NUM_RE.test(hw)) { memos.push(line.replace(/^[★☆]\s*/, "")); continue }
      if (steps.length && AFTER_STEPS_RE.test(hw)) { section = "done"; continue }
      if (/^※/.test(line) || isHeadingLine(hw) || SKIP_LINE_RE.test(hw) || META_LINE_RE.test(hw)) continue
      // 「▼詳しい作り方は動画をご覧ください」などの案内や、コメント・おすすめ欄で終わり
      if (/^[▼▽→]/.test(line)) { section = "done"; continue }
      if (steps.length && AFTER_STEPS_RE.test(hw)) { section = "done"; continue }
      // 次のレシピの材料が始まったら終わり
      if (steps.length && isIngHeader(hw)) { section = "done"; continue }
      // 手順番号だけの行（「1」「2」）は番号として扱い、次の行を新しい手順にする
      if (/^\d{1,2}$/.test(hw)) { nextIsNewStep = true; continue }
      const numbered = STEP_NUM_RE.test(hw) || nextIsNewStep
      nextIsNewStep = false
      const step = hw.replace(STEP_NUM_RE, "").trim()
      if (!step) continue
      // 改行で文の途中が切れている（前の行が「、」で終わる）ときはつなげる
      if (!numbered && steps.length && /[、,]$/.test(steps[steps.length - 1])) steps[steps.length - 1] += step
      else steps.push(step)
    }
  }
  if (steps.length > 40) steps.length = 40 // 念のため、ページの余計な文を大量に拾わないように
  if (ingredients.length < 2 || (!steps.length && !allowNoSteps)) return null

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
  const hwText = toHalfWidth(text)
  // 「材料（2人分）」を優先。「1-2人前」のような範囲は多いほうを使う
  const sm = hwText.match(/材料\s*[(（【]?\s*(\d+)\s*(?:[〜~～-]\s*(\d+))?\s*人(?:前|分)/) || hwText.match(/(\d+)\s*(?:[〜~～-]\s*(\d+))?\s*人(?:前|分)(?!の値)/)
  const servings = sm ? Number(sm[2] || sm[1]) || null : null
  return {
    name,
    servings,
    memo: memos.join(" ").slice(0, 200),
    ingredients: dropGroupLabels(ingredients).map(i => ({ ...i, isSeasoning: null })),
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
  if (!t) return []
  const txt = toHalfWidth(cleanText(t))
  // 番号が 1, 2, 3… と順に出てくる位置だけで区切る（手順の中の「[2]を並べる」のような参照では区切らない）
  const cuts = []
  let expect = 1
  for (const m of txt.matchAll(/\[(\d{1,2})\]|［(\d{1,2})］|([①-⑳])|（(\d{1,2})）/g)) {
    const n = m[3] ? m[3].charCodeAt(0) - 0x245f : Number(m[1] || m[2] || m[4])
    if (n === expect) { cuts.push({ at: m.index, len: m[0].length }); expect++ }
  }
  if (cuts.length >= 2) {
    return cuts.map((c, i) => txt.slice(c.at + c.len, i + 1 < cuts.length ? cuts[i + 1].at : undefined))
      .map(x => x.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean)
  }
  return [txt.replace(/\s*\n\s*/g, " ").trim()].filter(Boolean)
}

export function extractJsonLdRecipe(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const b of blocks) {
    let data
    try { data = JSON.parse(b[1].trim()) }
    catch {
      try { data = JSON.parse(b[1].trim().replace(/[\u0000-\u001f]+/g, " ")) } catch { continue }
    }
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
      ingredients: dropGroupLabels(ingredients).map(i => ({ ...i, isSeasoning: null })),
      steps,
    }
  }
  return null
}

// ── microdata（itemprop="recipeIngredient" など）で書かれたレシピ（ヤマサなど）──
export function extractMicrodataRecipe(html) {
  if (!/itemprop=["'](recipeIngredient|ingredients)["']/.test(html)) return null
  // 表のセルは区切りの空白を入れてから文字にする（「焼き芋」「1本」が「焼き芋1本」とつながるように）
  const textOf = h => cleanText(String(h).replace(/<\/(td|th|dt|dd)>/gi, " </$1>"))
  const items = []
  for (const m of html.matchAll(/<(tr|li|span|p|dd|div)\b[^>]*itemprop=["'](?:recipeIngredient|ingredients)["'][^>]*>([\s\S]*?)<\/\1>/gi)) {
    if (/itemprop=["'](recipeIngredient|ingredients)["']/.test(m[2])) continue // 中に材料を含む入れ物は除く
    items.push(...parseIngredientLines(textOf(m[2])))
  }
  let steps = []
  const at = html.search(/itemprop=["']recipeInstructions["']/)
  if (at >= 0) {
    const seg = html.slice(at, at + 20000)
    const list = seg.match(/<(ol|ul)\b[\s\S]*?<\/\1>/i)
    steps = list
      ? [...list[0].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m => cleanText(m[1]).replace(/\s*\n\s*/g, " ")).filter(Boolean)
      : flattenInstructions(cleanText(seg.slice(seg.indexOf(">") + 1).split(/<\/(section|div|article)>/i)[0]))
  }
  const ingredients = dropGroupLabels(items.filter(i => i.name)).map(i => ({ ...i, isSeasoning: null }))
  if (ingredients.length < 2) return null
  const name = cleanText((html.match(/itemprop=["']name["'][^>]*>([^<]{1,80})</) || [])[1] || (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || "")
  const yieldText = toHalfWidth(cleanText((html.match(/itemprop=["']recipeYield["'][^>]*?(?:content=["']([^"']*)["'][^>]*)?>([^<]{0,20})/) || []).slice(1).join(" ")))
  return { name, servings: parseInt((yieldText.match(/\d+/) || [])[0], 10) || null, memo: "", ingredients, steps: steps.slice(0, 40) }
}

// 分量のない「A」「煮汁」「具」「合わせ調味料」「トッピング」などは、材料ではなくグループの見出し
const GROUP_LABEL_RE = /^([A-Za-zＡ-Ｚ]|合わせ調味料|調味料|煮汁|具|具材|衣|ころも|.{0,4}ごろも|トッピング|下味|つけだれ|かけだれ|漬けだれ|たれ|タレ|飾り|仕上げ|生地|あん|皮|マリネ液|ピクルス液|つけあわせ|付け合わせ|薬味|メイン|その他)$/
export function dropGroupLabels(list) {
  return list.filter(i => !(!i.amount && !i.unit && GROUP_LABEL_RE.test(String(i.name).trim())))
}

// ── キユーピー：手順の本文だけを読む（コツの欄「r-point」は入れない）──
export function kewpieSteps(html) {
  return [...html.matchAll(/<p class="r-recipe-hdg--order">([\s\S]*?)<\/p>/g)]
    .map(m => cleanText(m[1]).replace(/\s*\n\s*/g, " ").trim()).filter(Boolean)
}

// ── クックパッド（JSON-LD がないため HTML から読む）──
// 未ログインでは材料・手順の一部しか表示されないことがあるので、その場合は truncated を立てる
export function extractCookpadRecipe(html) {
  const flat = html.replace(/\n/g, " ")
  const ingredients = [...flat.matchAll(/<li id="ingredient_\d+"[^>]*class="([^"]*)"[^>]*>\s*<span>([\s\S]*?)<\/span>\s*(?:<bdi[^>]*>([\s\S]*?)<\/bdi>)?/g)]
    .filter(m => !/\bheadline\b/.test(m[1].replace("not-headline", "")))
    .map(m => {
      const name = cleanText(m[2]).replace(/^[・●○◯◎☆★◆◇■□※]+\s*/, "")
      const qty = cleanText(m[3] || "")
      // 分量の欄が空で「鶏もも肉 300g」のように名前の欄にまとめて書かれているレシピもある
      if (!qty) { const one = parseIngredientLines(name)[0]; if (one) return { ...one, isSeasoning: null } }
      return { name, ...parseQuantity(qty), isSeasoning: null }
    })
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
  // 「<!-- CONTENT END -->」の途中で切ると「<!--」が残るので、コメントの開始位置で切る
  const cut = endMark > 0 ? html.lastIndexOf("<!--", endMark) : -1
  const body = html.slice(start, cut > start ? cut : endMark > 0 ? endMark : start + 60000)
    .replace(/<div class='ai-viewports[^>]*><\/div>/g, " ")
  const title = decodeEntities((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "").split(/\s+[-|｜]\s+/)[0]
  return bazurecipeFromContent(body, title)
}

// 記事本文の HTML（WordPress API の content.rendered でも可）から読む
// 本文に作り方が無い（「▼詳しい作り方は動画をご覧ください」だけ）ときは steps が空で、videoId を付けて返す
export function bazurecipeFromContent(contentHtml, title) {
  const html = String(contentHtml)
  const videoId = (html.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/) || [])[1] || null
  const body = html.replace(/<(figure|blockquote|script|button)[\s\S]*?<\/\1>/gi, " ")
  const recipe = parsePlainRecipe(htmlToText(body, 20000), title, { allowNoSteps: true })
  if (!recipe) return null
  if (title) recipe.name = title
  return { ...recipe, videoId }
}

// ページ本文をAIに渡すためのテキスト化
export function htmlToText(html, max = 15000) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ") // HTML のコメントが文字として残らないように
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
