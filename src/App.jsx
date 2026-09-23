import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import {
  hashPassword, getUser, createUser, saveData, saveShoppingChecks,
  subscribeUserRow, getUserSyncState, uploadRecipePhoto, deleteRecipePhoto, getRecipePhotoUrl,
} from "./supabase.js"

// ── 定数 ──
// ── タグ（設定画面で追加・編集できる。レシピには複数つけられる） ──
const TAG_COLORS = {
  orange: { bg: "#fde9df", fg: "#c4532a" },
  green:  { bg: "#e3efe6", fg: "#2e6b4f" },
  teal:   { bg: "#dff1ef", fg: "#1f746b" },
  blue:   { bg: "#e2edf6", fg: "#2f6690" },
  purple: { bg: "#ece8f8", fg: "#5a3fa8" },
  pink:   { bg: "#fbe6ef", fg: "#b03a6d" },
  red:    { bg: "#fbe3e1", fg: "#b8322a" },
  yellow: { bg: "#fbf1d2", fg: "#8a6400" },
  brown:  { bg: "#f1e7dc", fg: "#7a5230" },
  gray:   { bg: "#ecefed", fg: "#56635b" },
}
const DEFAULT_TAG_DEFS = [
  { name: "主菜", color: "orange" }, { name: "副菜", color: "green" }, { name: "汁物", color: "teal" }, { name: "お弁当", color: "purple" },
  { name: "肉", color: "red" }, { name: "魚", color: "blue" }, { name: "野菜", color: "green" }, { name: "卵", color: "yellow" },
  { name: "麺", color: "brown" }, { name: "ご飯もの", color: "gray" },
]
const BENTO_TAG = "お弁当" // 献立の「お弁当作り置き」で先頭に出すタグ

// 旧データは tag（1つ）、新データは tags（配列）。保存時は互換のため両方書く
function getTags(r) { return Array.isArray(r?.tags) ? r.tags : (r?.tag ? [r.tag] : []) }
function withTags(r, tags) { return { ...r, tags, tag: tags[0] || "" } }

// 保存済みのタグ定義に、レシピにだけ残っているタグを足す（データを取りこぼさない）
function resolveTagDefs(saved, recipes) {
  const defs = (Array.isArray(saved) && saved.length ? saved : DEFAULT_TAG_DEFS).map(d => ({ ...d }))
  const names = new Set(defs.map(d => d.name))
  ;(recipes || []).forEach(r => getTags(r).forEach(t => {
    if (t && !names.has(t)) { names.add(t); defs.push({ name: t, color: "gray" }) }
  }))
  return defs
}

function TagChip({ name, defs, small }) {
  const c = TAG_COLORS[defs?.find(d => d.name === name)?.color] || TAG_COLORS.gray
  return <span className="tag" style={{ background: c.bg, color: c.fg, ...(small ? { fontSize: 10, padding: "2px 8px" } : {}) }}>{name}</span>
}

// キーの順番に関係なく同じ内容なら同じ文字列になる JSON 化（DB の jsonb はキー順が変わるため）
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]"
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}"
  return JSON.stringify(v ?? null)
}

// 検索用：カタカナ→ひらがな・小文字にそろえる
function searchKey(s) { return String(s || "").toLowerCase().replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)) }
const STORE_ORDER = ["野菜・果物","肉・魚","卵・乳製品","加工食品・大豆製品","乾物・麺類・パスタ","調味料","冷凍食品・その他"]
// URL取り込みで、AIを使わずに読めることを確認したサイト（2026-09 時点）
const SUPPORTED_SITES = ["クラシル", "デリッシュキッチン", "Nadia", "レタスクラブ", "味の素パーク", "みんなのきょうの料理", "E・レシピ", "楽天レシピ", "macaroni", "白ごはん.com", "リュウジのバズレシピ.com"]

// ── 分数・数値変換 ──
function parseAmount(val) {
  if (val === null || val === undefined || val === "") return 0
  if (typeof val === "number") return isNaN(val) ? 0 : val
  const str = String(val).trim()
  const fracOnly = str.match(/^(\d+)\/(\d+)$/)
  if (fracOnly) return parseInt(fracOnly[1]) / parseInt(fracOnly[2])
  const mixed = str.match(/^(\d+)[\s　と]+(\d+)\/(\d+)$/)
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3])
  const num = parseFloat(str)
  return isNaN(num) ? 0 : num
}

const TO_ML = { "大さじ": 15, "小さじ": 5, "カップ": 200, "ml": 1, "cc": 1, "l": 1000 }
const TO_G  = { "kg": 1000, "g": 1 }

function normalizeUnit(amount, unit) {
  if (TO_ML[unit]) return { amount: amount * TO_ML[unit], unit: "ml" }
  if (TO_G[unit])  return { amount: amount * TO_G[unit], unit: "g" }
  return { amount, unit }
}

// ── 表記ゆれ吸収（ひらがな・カタカナ統一＋よくある別名辞書） ──
// カタカナ→ひらがな変換
function katakanaToHiragana(str) {
  return str.replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
}

// よくある食材名の表記ゆれ辞書（読みが同じでも漢字/別名が異なるもの）
const INGREDIENT_ALIASES = {
  "ねぎ": "長ねぎ", "ネギ": "長ねぎ", "葱": "長ねぎ", "白ねぎ": "長ねぎ",
  "人参": "にんじん", "ニンジン": "にんじん",
  "玉葱": "玉ねぎ", "タマネギ": "玉ねぎ", "たまねぎ": "玉ねぎ",
  "じゃが芋": "じゃがいも", "ジャガイモ": "じゃがいも", "馬鈴薯": "じゃがいも",
  "豚バラ": "豚バラ肉", "豚ばら": "豚バラ肉", "ぶたばら": "豚バラ肉",
  "鶏むね": "鶏むね肉", "鶏もも": "鶏もも肉", "とりもも": "鶏もも肉", "とりむね": "鶏むね肉",
  "牛こま": "牛こま肉", "牛肉（薄切り）": "牛薄切り肉", "牛バラ": "牛バラ肉",
  "しょうゆ": "醤油", "しょう油": "醤油", "正油": "醤油",
  "味醂": "みりん", "上白糖": "砂糖", "グラニュー糖": "砂糖",
  "片栗粉": "片栗粉", "コーンスターチ": "片栗粉",
  "椎茸": "しいたけ", "しいたけ": "しいたけ", "シイタケ": "しいたけ",
  "大蒜": "にんにく", "ニンニク": "にんにく", "ガーリック": "にんにく",
  "生姜": "しょうが", "ショウガ": "しょうが", "ジンジャー": "しょうが",
  "胡瓜": "きゅうり", "キュウリ": "きゅうり",
  "茄子": "なす", "ナス": "なす",
  "南瓜": "かぼちゃ", "カボチャ": "かぼちゃ",
  "大根": "大根", "だいこん": "大根",
  "白菜": "白菜", "はくさい": "白菜",
  "豆腐": "豆腐", "とうふ": "豆腐",
  "卵": "卵", "玉子": "卵", "たまご": "卵",
}

// 食材名を正規化（表記ゆれを統一）
function normalizeIngredientName(name) {
  if (!name) return name
  const trimmed = name.trim()
  // 1. 辞書に直接マッチ
  if (INGREDIENT_ALIASES[trimmed]) return INGREDIENT_ALIASES[trimmed]
  // 2. カタカナをひらがなに変換してから辞書を再チェック
  const hiraVersion = katakanaToHiragana(trimmed)
  if (INGREDIENT_ALIASES[hiraVersion]) return INGREDIENT_ALIASES[hiraVersion]
  // 3. 辞書の値（正規化後の名前）をひらがな化したものと比較し、一致すれば統一
  for (const [key, val] of Object.entries(INGREDIENT_ALIASES)) {
    if (katakanaToHiragana(key) === hiraVersion) return val
  }
  return trimmed
}

// 同名食材は1行にまとめる。同じ単位は合算し、単位が異なる場合は parts に内訳を持たせる
function mergeIngredientsAdvanced(selections, recipes) {
  const map = {}
  selections.forEach(sel => {
    const recipe = recipes.find(r => r.id === sel.recipeId)
    if (!recipe) return
    recipe.ingredients.filter(i => i.type === "通常食材").forEach(ing => {
      const parsed = parseAmount(ing.amount)
      const { amount, unit } = normalizeUnit(parsed * sel.portion, ing.unit)
      const normalizedName = normalizeIngredientName(ing.name)
      if (!map[normalizedName]) map[normalizedName] = { ...ing, name: normalizedName, parts: {} }
      const parts = map[normalizedName].parts
      if (!parts[unit]) parts[unit] = { unit, amount: 0, recipes: [] }
      parts[unit].amount += amount
      if (!parts[unit].recipes.includes(recipe.name)) parts[unit].recipes.push(recipe.name)
    })
  })
  return Object.values(map).map(i => {
    const parts = Object.values(i.parts).map(p => ({ ...p, amount: Math.round(p.amount * 10) / 10 }))
    return { ...i, parts, mixed: parts.length > 1, amount: parts[0].amount, unit: parts[0].unit }
  })
}

// 買い物リストの数量調整キー（単一単位は従来通り食材名、内訳行は「名前__単位」）
function adjustKey(name, unit, mixed) { return mixed ? `${name}__${unit}` : name }

// ── 売り場カテゴリの自動推論 ──
// キーワードを足すだけで拡張できる。prefixes は「冷凍〇〇」のように先頭に付くと優先されるもの
const CATEGORY_RULES = [
  { category: "野菜・果物", keywords: ["にんじん", "玉ねぎ", "じゃがいも", "なす", "トマト", "きゅうり", "キャベツ", "白菜", "大根", "ほうれん草", "ピーマン", "ねぎ", "ブロッコリー", "ごぼう", "レタス", "りんご", "バナナ", "みかん", "にんにく", "しょうが", "しいたけ", "しめじ", "えのき", "まいたけ", "かぼちゃ", "もやし", "小松菜", "水菜", "アボカド", "レモン", "大葉", "さつまいも", "里芋", "オクラ", "ズッキーニ", "パプリカ", "セロリ", "アスパラ", "ニラ", "豆苗", "れんこん"] },
  { category: "肉・魚", keywords: ["鶏", "豚", "牛", "ひき肉", "ベーコン", "ソーセージ", "ハム", "鮭", "さば", "えび", "あさり", "ツナ", "ちくわ", "かまぼこ", "たら", "ぶり", "いか", "たこ", "しらす", "明太子", "たらこ", "ささみ", "手羽"] },
  { category: "卵・乳製品", keywords: ["卵", "牛乳", "チーズ", "バター", "生クリーム", "ヨーグルト"] },
  { category: "加工食品・大豆製品", keywords: ["豆腐", "納豆", "油揚げ", "厚揚げ", "こんにゃく", "しらたき", "はんぺん", "缶", "トマト缶", "ツナ缶", "キムチ"] },
  { category: "乾物・麺類・パスタ", keywords: ["パスタ", "スパゲッティ", "うどん", "そば", "そうめん", "ラーメン", "中華麺", "米", "もち", "わかめ", "のり", "かつお節", "ひじき", "春雨", "パン粉", "ごま"] },
  { category: "調味料", keywords: ["醤油", "しょうゆ", "しょう油", "味噌", "みそ", "みりん", "酒", "砂糖", "塩", "酢", "油", "ごま油", "オイル", "ケチャップ", "マヨネーズ", "片栗粉", "小麦粉", "薄力粉", "こしょう", "コショウ", "胡椒", "コンソメ", "だし", "鶏ガラ", "ソース", "ポン酢", "つゆ", "めんつゆ", "オイスターソース", "豆板醤", "コチュジャン", "テンメンジャン", "カレー粉", "カレールウ", "ルウ", "味の素", "ナツメグ", "スパイス", "シナモン", "ラー油", "タバスコ", "わさび", "からし", "マスタード", "はちみつ", "ナンプラー", "ドレッシング", "チューブ", "調味料"] },
  { category: "冷凍食品・その他", keywords: ["冷凍", "アイス"], prefixes: ["冷凍"] },
]

// 部分一致で判定。複数ヒットしたら「長いキーワード」→「語尾に近いもの」を優先
// （例：牛乳→卵・乳製品、油揚げ→加工食品、米酢→調味料）
function inferCategory(name) {
  if (!name || !name.trim()) return null
  const raw = name.trim()
  const candidates = [...new Set([raw, normalizeIngredientName(raw), katakanaToHiragana(raw)])]
  for (const rule of CATEGORY_RULES) {
    if (rule.prefixes && candidates.some(c => rule.prefixes.some(p => c.startsWith(p)))) return rule.category
  }
  let best = null
  for (const text of candidates) {
    for (const rule of CATEGORY_RULES) {
      for (const kw of rule.keywords) {
        const variants = kw === katakanaToHiragana(kw) ? [kw] : [kw, katakanaToHiragana(kw)]
        for (const v of variants) {
          const pos = text.lastIndexOf(v)
          if (pos < 0) continue
          const end = pos + v.length
          if (!best || v.length > best.len || (v.length === best.len && end > best.end)) {
            best = { category: rule.category, len: v.length, end }
          }
        }
      }
    }
  }
  return best ? best.category : null
}

function mergeSeasonings(selections, recipes) {
  const map = {}
  selections.forEach(sel => {
    const r = recipes.find(r => r.id === sel.recipeId)
    if (!r) return
    r.ingredients.filter(i => i.type === "調味料").forEach(ing => {
      const normalizedName = normalizeIngredientName(ing.name)
      if (!map[normalizedName]) map[normalizedName] = { ...ing, name: normalizedName, totalAmount: 0, recipes: [] }
      map[normalizedName].totalAmount += (parseAmount(ing.amount) || 0) * sel.portion
      if (!map[normalizedName].recipes.includes(r.name)) map[normalizedName].recipes.push(r.name)
    })
  })
  return Object.values(map)
}

// ── ユーティリティ ──
function formatDateLabel(dateStr) {
  if (!dateStr) return ""
  const d = new Date(dateStr)
  const days = ["日","月","火","水","木","金","土"]
  return `${d.getMonth()+1}/${d.getDate()}（${days[d.getDay()]}）`
}

function formatPeriodLabel(entries) {
  const dates = entries.map(e => e.date).filter(Boolean).sort()
  if (!dates.length) return "期間未設定"
  const first = new Date(dates[0]), last = new Date(dates[dates.length-1])
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}`
  return `${first.getFullYear()}年${fmt(first)}〜${fmt(last)}`
}

// "YYYY-MM-DD" ⇔ ローカル日付（toISOString は UTC になるため使わない）
function toYMD(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }
function parseYMD(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d) }
function addDays(ymd, n) { const d = parseYMD(ymd); d.setDate(d.getDate() + n); return toYMD(d) }

// 履歴1件から献立・お弁当エントリを復元する
// 日付は曜日を保ったまま週単位でずらし、最初の日が今日以降になるようにする
function buildEntriesFromHistory(week, recipes) {
  const findRecipe = m => (m.recipeId && recipes.find(r => r.id === m.recipeId)) || recipes.find(r => r.name === m.name) || null
  const planMenus = week.menus.filter(m => !m.isBento)
  const bentoMenus = week.menus.filter(m => m.isBento)
  const today = toYMD(new Date())
  const dated = planMenus.map(m => m.date).filter(Boolean).sort()
  let shift = 0
  if (dated.length) {
    const diff = Math.round((parseYMD(today) - parseYMD(dated[0])) / 86400000)
    if (diff > 0) shift = Math.ceil(diff / 7) * 7
  }
  // 日付なしのエントリは、日付ありの最終日の翌日（なければ今日）から順に割り当てる
  let cursor = dated.length ? addDays(dated[dated.length - 1], shift) : addDays(today, -1)
  const baseId = Date.now()
  const missing = []
  const planEntries = planMenus.map((m, i) => {
    let date
    if (m.date) date = addDays(m.date, shift)
    else { cursor = addDays(cursor, 1); date = cursor }
    const r = m.skip ? null : findRecipe(m)
    if (!m.skip && !r && m.name && m.name !== "未設定") missing.push(m.name)
    return { id: baseId + i, date, recipeId: r ? r.id : null, portion: m.portion || 1, skip: !!m.skip }
  })
  const bentoEntries = []
  bentoMenus.forEach((m, i) => {
    const r = findRecipe(m)
    if (!r) { if (m.name && m.name !== "不明") missing.push(m.name); return }
    bentoEntries.push({ id: baseId + planMenus.length + i, recipeId: r.id, portion: m.portion || 1, note: m.note || "" })
  })
  return { planEntries, bentoEntries, missing: [...new Set(missing)] }
}

// 写真を長辺1280pxのJPEGに縮小（失敗したら元ファイルをそのまま使う）
function compressImage(file, maxSize = 1280, quality = 0.82) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(blob => { URL.revokeObjectURL(url); resolve(blob || file) }, "image/jpeg", quality)
      } catch { URL.revokeObjectURL(url); resolve(file) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

// 買い物リスト：チェックしたら下へ移動するか（端末ごとの設定）
const LS_MOVE_CHECKED = "kondate_move_checked"
function getMoveChecked() { try { return localStorage.getItem(LS_MOVE_CHECKED) !== "0" } catch { return true } }
function saveMoveChecked(v) { try { localStorage.setItem(LS_MOVE_CHECKED, v ? "1" : "0") } catch {} }

const LS_KEY = "kondate_uid"
function getSavedUid() { try { return localStorage.getItem(LS_KEY) || null } catch { return null } }
function saveUid(uid) { try { localStorage.setItem(LS_KEY, uid) } catch {} }
function clearUid() { try { localStorage.removeItem(LS_KEY) } catch {} }

// ── サンプルレシピ ──
const SAMPLE_RECIPES = [
  { id: 1, name: "肉じゃが", tag: "主菜", tags: ["主菜", "肉"], favorite: true, memo: "じゃがいもはほくほくになるまで煮る。", url: "", steps: ["牛肉を炒める。","野菜を加えて炒める。","調味料と水を加えて15分煮る。"],
    ingredients: [
      { name: "牛薄切り肉", amount: 150, unit: "g", type: "通常食材", category: "肉・魚" },
      { name: "じゃがいも", amount: 2, unit: "個", type: "通常食材", category: "野菜・果物" },
      { name: "玉ねぎ", amount: 1, unit: "個", type: "通常食材", category: "野菜・果物" },
      { name: "にんじん", amount: 0.5, unit: "本", type: "通常食材", category: "野菜・果物" },
      { name: "醤油", amount: 3, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "みりん", amount: 2, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "砂糖", amount: 1, unit: "大さじ", type: "調味料", category: "調味料" },
    ]},
  { id: 2, name: "鶏の唐揚げ", tag: "主菜", tags: ["主菜", "肉", "お弁当"], favorite: true, memo: "二度揚げでカリッと。", url: "", steps: ["鶏肉を下味に漬ける。","片栗粉をまぶして揚げる。","二度揚げで完成。"],
    ingredients: [
      { name: "鶏もも肉", amount: 300, unit: "g", type: "通常食材", category: "肉・魚" },
      { name: "醤油", amount: 2, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "酒", amount: 1, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "にんにく", amount: 1, unit: "片", type: "通常食材", category: "野菜・果物" },
      { name: "片栗粉", amount: 4, unit: "大さじ", type: "調味料", category: "乾物・麺類・パスタ" },
    ]},
  { id: 3, name: "卵焼き", tag: "お弁当", tags: ["お弁当", "卵"], favorite: true, memo: "甘めに仕上げる。", url: "", steps: ["卵を溶いて調味料を混ぜる。","卵焼き器で巻く。"],
    ingredients: [
      { name: "卵", amount: 3, unit: "個", type: "通常食材", category: "卵・乳製品" },
      { name: "砂糖", amount: 1, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "醤油", amount: 0.5, unit: "大さじ", type: "調味料", category: "調味料" },
    ]},
]

// ── CSS ──
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@300;400;500;700;900&family=Zen+Maru+Gothic:wght@500;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#f6f2e9;}
::-webkit-scrollbar{width:4px;}
::-webkit-scrollbar-thumb{background:#d3cfc2;border-radius:2px;}
.screen{flex:1;overflow-y:auto;padding-bottom:88px;}
.card{background:#fff;border-radius:16px;box-shadow:0 1px 8px rgba(30,50,40,0.07);}
.btn{border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:500;transition:all .15s;display:inline-flex;align-items:center;justify-content:center;gap:6px;}
.btn-primary{background:#2e5d4e;color:#fff;padding:11px 20px;font-size:14px;}
.btn-primary:hover{background:#234a3d;}
.btn-primary:disabled{background:#9aaba2;cursor:not-allowed;}
.btn-outline{background:#fff;color:#2e5d4e;border:1.5px solid #d3cfc2;padding:9px 16px;font-size:13px;}
.btn-outline:hover{background:#e9f0ea;}
.btn-ghost{background:transparent;color:#66776d;border:none;padding:6px 10px;font-size:13px;cursor:pointer;}
.btn-sm{padding:6px 12px;font-size:12px;border-radius:8px;}
.btn-icon{background:none;border:none;cursor:pointer;padding:4px 8px;font-size:16px;color:#66776d;border-radius:6px;}
.btn-icon:hover{background:#ebe7dc;}
.tag{display:inline-flex;align-items:center;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;letter-spacing:0.05em;}
input,select,textarea{font-family:inherit;border:1.5px solid #dcd7ca;border-radius:10px;padding:10px 13px;font-size:14px;width:100%;background:#fbf9f4;color:#1f2a24;outline:none;transition:border .15s;}
input:focus,select:focus,textarea:focus{border-color:#2e5d4e;box-shadow:0 0 0 3px rgba(46,93,78,0.12);}
input[type=date]{cursor:pointer;}
.overlay{position:fixed;inset:0;background:rgba(20,32,26,.55);z-index:200;display:flex;align-items:flex-end;justify-content:center;}
.sheet{background:#fbf9f4;border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:92vh;overflow-y:auto;padding:24px 20px 40px;animation:slideUp .25s;}
.detail-sheet{background:#fbf9f4;border-radius:20px 20px 0 0;width:100%;max-width:480px;height:88vh;overflow-y:auto;animation:slideUp .25s;}
@keyframes slideUp{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
.pill-btn{border:1.5px solid #d3cfc2;border-radius:20px;background:#fff;color:#3d5046;padding:6px 14px;font-family:inherit;font-size:12px;cursor:pointer;transition:all .15s;font-weight:500;}
.pill-btn.active{background:#2e5d4e;color:#fff;border-color:#2e5d4e;}
.section-head{font-size:11px;font-weight:700;color:#8f9d94;letter-spacing:.1em;padding:0 4px;margin-bottom:6px;}
.item-row{display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid #ebe7dc;gap:10px;background:#fff;}
.item-row:last-child{border-bottom:none;}
.num-ctrl{display:inline-flex;align-items:center;gap:4px;}
.num-btn{width:28px;height:28px;border:1.5px solid #d3cfc2;border-radius:8px;background:#fff;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;color:#2e5d4e;font-weight:700;}
.num-btn:hover{background:#e9f0ea;}
.check-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #ebe7dc;cursor:pointer;}
.check-row:last-child{border-bottom:none;}
.custom-check{width:22px;height:22px;border:2px solid #d3cfc2;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
.custom-check.checked{background:#2e5d4e;border-color:#2e5d4e;color:#fff;}
.fav-btn{background:none;border:none;cursor:pointer;font-size:18px;padding:2px;line-height:1;color:#ed7342;}
.history-week{border-radius:12px;overflow:hidden;border:1.5px solid #e2ddd0;}
.empty-state{text-align:center;padding:60px 20px;color:#8f9d94;}
.portion-select{width:auto;flex-shrink:0;border:1.5px solid #d3cfc2;border-radius:8px;background:#fff;color:#2e5d4e;padding:5px 8px;font-size:12px;font-family:inherit;cursor:pointer;}
.toast{position:fixed;top:68px;left:50%;transform:translateX(-50%);background:#2e5d4e;color:#fff;border-radius:20px;padding:8px 20px;font-size:12px;z-index:400;animation:fadeIn .2s;white-space:nowrap;pointer-events:none;}
.toast.error{background:#c0391b;}
.toast.warn{background:#8a6000;}
.error-msg{color:#c0391b;font-size:12px;margin-top:6px;padding:8px 12px;background:#fff0ee;border-radius:8px;}
.login-wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f6f2e9;padding:24px;}
.login-card{background:#fff;border-radius:20px;padding:36px 28px;width:100%;max-width:360px;box-shadow:0 4px 24px rgba(30,50,40,0.10);}
.tab-toggle{display:flex;border-radius:10px;background:#ebe7dc;padding:3px;gap:3px;margin-bottom:24px;}
.tab-toggle button{flex:1;border:none;border-radius:8px;padding:9px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;}
.tab-toggle button.active{background:#2e5d4e;color:#fff;}
.tab-toggle button:not(.active){background:transparent;color:#66776d;}
.step-row{display:flex;gap:12px;margin-bottom:14px;align-items:flex-start;}
.step-num{width:28px;height:28px;border-radius:50%;background:#2e5d4e;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;}
.step-text{flex:1;line-height:1.7;font-size:14px;color:#26332c;}
.ing-chip{display:inline-flex;align-items:center;background:#eef3ec;border:1px solid #dfe6dc;border-radius:8px;padding:6px 12px;font-size:13px;gap:6px;}
.ing-amount{font-weight:700;color:#c4532a;}
.detail-header{background:#2e5d4e;color:#f6f2e9;padding:16px 20px 20px;}
.url-btn{display:flex;align-items:center;gap:8px;background:#fdf0e9;border:1.5px solid #f3c3a8;border-radius:12px;padding:12px 16px;color:#b8542a;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;width:100%;text-decoration:none;}
.spinner{width:36px;height:36px;border:3px solid #e2ddd0;border-top-color:#2e5d4e;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px;}
.date-entry{background:#fff;border-radius:12px;border:1.5px solid #e2ddd0;margin-bottom:8px;overflow:hidden;}
.date-entry-header{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#fbf9f4;border-bottom:1px solid #ebe7dc;}
.bento-section{background:#f0ebfa;border:1.5px solid #c8b8f0;border-radius:12px;margin-bottom:12px;overflow:hidden;}
.sync-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;margin-right:4px;}
.sync-dot.off{background:#dcd7ca;}
.sync-dot.poll{background:#e8a000;}
.recipe-thumb{width:52px;height:52px;border-radius:10px;object-fit:cover;flex-shrink:0;background:#e9f0ea;}
.recipe-thumb-ph{width:52px;height:52px;border-radius:10px;flex-shrink:0;background:#e9f0ea;display:flex;align-items:center;justify-content:center;font-size:22px;color:#b5c9bd;}
.detail-photo{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#e9f0ea;}
.photo-box{width:100%;aspect-ratio:16/9;max-height:200px;border-radius:12px;border:1.5px dashed #d3cfc2;background:#f3f1ea;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#8f9d94;font-size:12px;overflow:hidden;position:relative;}
.photo-box img{width:100%;height:100%;object-fit:cover;}
.switch{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#66776d;cursor:pointer;user-select:none;}
.switch-track{width:32px;height:18px;border-radius:9px;background:#dcd7ca;position:relative;transition:background .15s;flex-shrink:0;}
.switch-track::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.2);}
.switch-track.on{background:#2e5d4e;}
.switch-track.on::after{left:16px;}
.part-row{display:flex;align-items:center;gap:8px;margin-top:6px;}
.part-label{flex:1;font-size:11px;color:#7f8e85;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.num-btn.sm{width:24px;height:24px;font-size:14px;}
.chip-row{display:flex;gap:6px;overflow-x:auto;padding:2px 16px 6px;margin:0 -16px;scrollbar-width:none;}
.chip-row::-webkit-scrollbar{display:none;}
.chip-row .pill-btn{white-space:nowrap;flex-shrink:0;}
.search-box{position:relative;margin-bottom:10px;}
.search-box input{padding-left:36px;background:#fff;border-radius:12px;}
.search-box .icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:15px;opacity:.55;pointer-events:none;}
.search-box .clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:none;font-size:15px;color:#8f9d94;cursor:pointer;padding:6px 8px;}
.fab{position:fixed;bottom:calc(84px + env(safe-area-inset-bottom));right:max(16px, calc(50% - 224px));width:56px;height:56px;border-radius:50%;border:none;background:#ed7342;color:#fff;font-size:30px;line-height:1;box-shadow:0 6px 18px rgba(237,115,66,.4);cursor:pointer;z-index:90;display:flex;align-items:center;justify-content:center;transition:transform .15s;}
.fab:active{transform:scale(.94);}
.recipe-card{background:#fff;border-radius:14px;box-shadow:0 1px 6px rgba(30,50,40,0.06);padding:12px 12px 12px 8px;display:flex;align-items:center;gap:10px;cursor:pointer;transition:transform .1s;}
.recipe-card:active{transform:scale(.99);}
.settings-section{background:#fff;border-radius:14px;box-shadow:0 1px 6px rgba(30,50,40,0.06);margin-bottom:16px;overflow:hidden;}
.settings-title{font-size:12px;font-weight:700;color:#66776d;margin:0 4px 8px;letter-spacing:.05em;}
.settings-row{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #ebe7dc;}
.settings-row:last-child{border-bottom:none;}
.color-dot{width:26px;height:26px;border-radius:50%;border:2px solid transparent;cursor:pointer;flex-shrink:0;}
.color-dot.active{border-color:#1f2a24;}
.icon-btn{border:none;background:none;cursor:pointer;color:#8f9d94;font-size:14px;padding:6px;border-radius:8px;line-height:1;}
.icon-btn:disabled{opacity:.3;cursor:default;}
.icon-btn:not(:disabled):hover{background:#e9f0ea;}
`

// ── ログイン ──
function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const handle = async () => {
    setError("")
    if (!username.trim() || !password.trim()) { setError("ユーザー名とパスワードを入力してください"); return }
    if (username.trim().length < 2) { setError("ユーザー名は2文字以上"); return }
    if (password.length < 4) { setError("パスワードは4文字以上"); return }
    setLoading(true)
    try {
      const uid = username.trim().toLowerCase(), hash = await hashPassword(password)
      if (mode === "register") {
        const existing = await getUser(uid)
        if (existing) { setError("そのユーザー名は使われています"); setLoading(false); return }
        const initData = { recipes: SAMPLE_RECIPES, tagDefs: DEFAULT_TAG_DEFS, planEntries: [], bentoEntries: [], seasoningChecks: {}, shoppingAdjust: {}, deletedItems: [], manualItems: [], drugItems: [], history: [] }
        await createUser(uid, hash, initData); saveUid(uid); onLogin(uid, initData)
      } else {
        const user = await getUser(uid)
        if (!user) { setError("ユーザー名が見つかりません"); setLoading(false); return }
        if (user.password_hash !== hash) { setError("パスワードが違います"); setLoading(false); return }
        saveUid(uid)
        onLogin(uid, user.data || { recipes: SAMPLE_RECIPES, planEntries: [], bentoEntries: [], seasoningChecks: {}, shoppingAdjust: {}, deletedItems: [], manualItems: [], drugItems: [], history: [] })
      }
    } catch (e) { setError("エラー: " + e.message) }
    setLoading(false)
  }
  return (
    <div className="login-wrap">
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <img src="/icon-512.png" alt="CookFlow" style={{ width: 104, height: 104, borderRadius: 26, marginBottom: 12, boxShadow: "0 6px 24px rgba(46,93,78,0.18)" }} />
        <div style={{ fontFamily: "'Zen Maru Gothic',sans-serif", fontSize: 28, fontWeight: 700, color: "#2e5d4e" }}>CookFlow</div>
        <div style={{ fontSize: 12, color: "#66776d", marginTop: 6 }}>献立から買い物まで、ひとつの流れで</div>
      </div>
      <div className="login-card">
        <div className="tab-toggle">
          <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError("") }}>ログイン</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError("") }}>新規登録</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <div><label style={{ fontSize: 11, fontWeight: 700, color: "#66776d", display: "block", marginBottom: 4 }}>ユーザー名</label><input placeholder="例: hanako" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} autoCapitalize="none" autoCorrect="off" /></div>
          <div><label style={{ fontSize: 11, fontWeight: 700, color: "#66776d", display: "block", marginBottom: 4 }}>パスワード</label><input type="password" placeholder="4文字以上" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} /></div>
          {error && <div className="error-msg">⚠️ {error}</div>}
          <button className="btn btn-primary" style={{ width: "100%", padding: "13px", marginTop: 4 }} onClick={handle} disabled={loading}>{loading ? "処理中..." : mode === "login" ? "ログイン" : "アカウントを作成"}</button>
        </div>
      </div>
    </div>
  )
}

// ── レシピ詳細シート ──
function RecipeDetailSheet({ recipe, tagDefs, onClose, onEdit, onDelete }) {
  const [activeTab, setActiveTab] = useState("steps")

  // 作り方タブを開いている間は画面の自動消灯を防ぐ（非対応ブラウザは何もしない）
  useEffect(() => {
    if (!recipe || activeTab !== "steps" || !("wakeLock" in navigator)) return
    let lock = null
    let released = false
    const acquire = async () => {
      if (released || document.visibilityState !== "visible") return
      try {
        lock = await navigator.wakeLock.request("screen")
        if (released) { lock.release().catch(() => {}); lock = null }
      } catch { /* 省電力モード等で拒否された場合は無視 */ }
    }
    // タブが非表示になるとブラウザが自動解放するので、戻ってきたら取り直す
    const onVisibility = () => { if (document.visibilityState === "visible") acquire() }
    acquire()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      released = true
      document.removeEventListener("visibilitychange", onVisibility)
      if (lock) lock.release().catch(() => {})
    }
  }, [recipe, activeTab])

  if (!recipe) return null
  const photoUrl = getRecipePhotoUrl(recipe.photoPath)
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="detail-sheet">
        <div className="detail-header">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8, color: "#f6f2e9", padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>← 戻る</button>
            <div style={{ display: "flex", gap: 6 }}>
              {onEdit && <button onClick={onEdit} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8, color: "#f6f2e9", padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>✏️ 編集</button>}
              {onDelete && <button onClick={onDelete} aria-label="削除" style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8, color: "#f6f2e9", padding: "6px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>🗑</button>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
            {getTags(recipe).map(t => <TagChip key={t} name={t} defs={tagDefs} />)}
            {recipe.favorite && <span style={{ fontSize: 18, color: "#ed7342" }}>★</span>}
          </div>
          <h2 style={{ fontFamily: "'Zen Maru Gothic',sans-serif", fontSize: 24, fontWeight: 700, marginBottom: 6 }}>{recipe.name}</h2>
          {recipe.memo && <p style={{ fontSize: 13, color: "#cfe0d6", lineHeight: 1.6 }}>💬 {recipe.memo}</p>}
        </div>
        {photoUrl && <img src={photoUrl} alt={recipe.name} className="detail-photo" />}
        {recipe.url && <div style={{ padding: "14px 16px", borderBottom: "1px solid #ebe7dc" }}><a href={recipe.url} target="_blank" rel="noopener noreferrer" className="url-btn"><span style={{ fontSize: 18 }}>▶️</span><span>参考動画・レシピを見る</span><span style={{ marginLeft: "auto", fontSize: 11, color: "#8f9d94" }}>外部リンク →</span></a></div>}
        <div style={{ display: "flex", borderBottom: "2px solid #ebe7dc", background: "#fff" }}>
          {[{ id: "steps", label: "👨‍🍳 作り方" }, { id: "ingredients", label: "🥬 材料" }].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex: 1, border: "none", background: "none", padding: "13px", cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 600, color: activeTab === t.id ? "#2e5d4e" : "#8f9d94", borderBottom: activeTab === t.id ? "2px solid #2e5d4e" : "2px solid transparent", marginBottom: -2, transition: "all .15s" }}>{t.label}</button>
          ))}
        </div>
        {activeTab === "steps" && <div style={{ padding: "20px 16px" }}>
          {(!recipe.steps || !recipe.steps.length) ? <div style={{ textAlign: "center", padding: "40px 20px", color: "#8f9d94" }}><div style={{ fontSize: 36, marginBottom: 10 }}>📝</div><div>作り方が登録されていません</div></div>
            : recipe.steps.map((step, i) => <div key={i} className="step-row"><div className="step-num">{i + 1}</div><div className="step-text">{step}</div></div>)}
        </div>}
        {activeTab === "ingredients" && <div style={{ padding: "20px 16px" }}>
          <div style={{ fontSize: 12, color: "#8f9d94", marginBottom: 14 }}>基本 {recipe.servings || 2}人前</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {recipe.ingredients.filter(i => i.type === "通常食材").map((ing, i) => <div key={i} className="ing-chip"><span>{ing.name}</span><span className="ing-amount">{ing.amount}{ing.unit}</span></div>)}
          </div>
          {recipe.ingredients.some(i => i.type === "調味料") && <>
            <div style={{ fontSize: 12, color: "#8f9d94", marginBottom: 10, fontWeight: 700 }}>調味料</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {recipe.ingredients.filter(i => i.type === "調味料").map((ing, i) => <div key={i} className="ing-chip" style={{ background: "#f5f0fa", borderColor: "#d8cce8" }}><span>{ing.name}</span><span className="ing-amount" style={{ color: "#6a3fa0" }}>{ing.amount}{ing.unit}</span></div>)}
            </div>
          </>}
        </div>}
      </div>
    </div>
  )
}

// ── メインアプリ ──
export default function App() {
  const [userId, setUserId] = useState(null)
  const [autoLogging, setAutoLogging] = useState(true)
  const [screen, setScreen] = useState("catalog")
  const [recipes, setRecipes] = useState([])
  const [planEntries, setPlanEntries] = useState([])      // 通常献立
  const [bentoEntries, setBentoEntries] = useState([])    // お弁当作り置き
  const [seasoningChecks, setSeasoningChecks] = useState({})
  const [shoppingAdjust, setShoppingAdjust] = useState({})
  const [deletedItems, setDeletedItems] = useState(new Set())
  const [manualItems, setManualItems] = useState([])       // 手動追加アイテム（スーパー用）
  const [drugItems, setDrugItems] = useState([])           // ドラッグストア用リスト
  const [shoppingTab, setShoppingTab] = useState("super")  // super | drug
  const [checkedItems, setCheckedItems] = useState([])     // チェック済み（同期）
  const [history, setHistory] = useState([])
  const [filterTags, setFilterTags] = useState([])       // 選択中のタグ（すべて満たすものを表示）
  const [search, setSearch] = useState("")
  const [tagDefs, setTagDefs] = useState(DEFAULT_TAG_DEFS)
  const [filterFav, setFilterFav] = useState(false)
  const [editRecipe, setEditRecipe] = useState(null)
  const [showRegister, setShowRegister] = useState(false)
  const [detailRecipe, setDetailRecipe] = useState(null)
  const [expandedHistory, setExpandedHistory] = useState(null)
  const [editingHistory, setEditingHistory] = useState(null)
  const [showConfirmPlan, setShowConfirmPlan] = useState(false)
  const [addManualInput, setAddManualInput] = useState("")
  const [toast, setToast] = useState(null)
  const [copyResult, setCopyResult] = useState(null)       // 献立コピー後の確認モーダル
  const [moveChecked, setMoveChecked] = useState(getMoveChecked)
  const [syncStatus, setSyncStatus] = useState("connecting") // live | polling | connecting | paused
  const saveTimer = useRef(null)
  const isSaving = useRef(false)
  const lastLocalCheckWrite = useRef(0)

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500) }

  // ── 保存データを画面に反映（起動時・ログイン時・他の端末での変更） ──
  const applyData = useCallback(d => {
    d = d || {}
    const recs = d.recipes || SAMPLE_RECIPES
    setRecipes(recs)
    setTagDefs(resolveTagDefs(d.tagDefs, recs))
    setPlanEntries(d.planEntries || [])
    setBentoEntries(d.bentoEntries || [])
    setSeasoningChecks(d.seasoningChecks || {})
    setShoppingAdjust(d.shoppingAdjust || {})
    setDeletedItems(new Set(d.deletedItems || []))
    setManualItems(d.manualItems || [])
    setDrugItems(d.drugItems || [])
    setHistory(d.history || [])
    // 開いているレシピ詳細も最新にする（他の端末で削除されていたら閉じる）
    setDetailRecipe(cur => cur ? (recs.find(r => r.id === cur.id) || null) : cur)
  }, [])

  // 最後にサーバーと一致していたデータ（キー順を無視した文字列）。自分の保存の反響を見分けるのに使う
  const lastSyncedData = useRef("")
  // 自分の変更がまだ保存されていない間は、他の端末のデータで上書きしない
  const unsavedChanges = useRef(false)
  const saveSeq = useRef(0)

  // ── 起動時に自動ログイン ──
  useEffect(() => {
    const uid = getSavedUid()
    if (!uid) { setAutoLogging(false); return }
    getUser(uid).then(user => {
      if (user) {
        setUserId(uid)
        applyData(user.data)
        lastSyncedData.current = stableStringify(user.data || {})
      } else { clearUid() }
      setAutoLogging(false)
    }).catch(() => { clearUid(); setAutoLogging(false) })
  }, [applyData])

  // ── 他の端末との同期（Realtime、切断時は30秒ポーリングにフォールバック） ──
  // チェック状態に加えて、レシピ・写真・献立などのデータも反映する
  useEffect(() => {
    if (!userId) return
    let unsubscribe = null
    let pollTimer = null
    let reconcileTimer = null
    let refetchTimer = null
    let disposed = false
    let gen = 0 // 古いチャンネルからのステータス通知を無視するための世代番号

    const applyChecks = checks => {
      if (disposed) return
      // 自分の書き込み直後に届く古いイベントで表示が巻き戻らないよう、少し待ってから取り直す
      const sinceLocal = Date.now() - lastLocalCheckWrite.current
      if (sinceLocal < 1500) {
        clearTimeout(reconcileTimer)
        reconcileTimer = setTimeout(fetchAll, 1500 - sinceLocal)
        return
      }
      const next = checks || []
      setCheckedItems(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    const applyRemoteData = data => {
      if (disposed || !data || unsavedChanges.current) return
      const key = stableStringify(data)
      if (key === lastSyncedData.current) return // 自分の保存の反響、または変化なし
      lastSyncedData.current = key
      applyData(data)
      showToast("他の端末の変更を反映しました")
    }
    const fetchAll = () => getUserSyncState(userId).then(row => {
      if (!row) return
      applyChecks(row.shopping_checks)
      applyRemoteData(row.data)
    }).catch(() => {})
    // イベントが続いたときにまとめて1回だけ取り直す
    const refetchSoon = () => { clearTimeout(refetchTimer); refetchTimer = setTimeout(fetchAll, 300) }

    const onRow = row => {
      if (Array.isArray(row.shopping_checks)) applyChecks(row.shopping_checks)
      // 行が大きいと data が省略されて届くので、その場合は取り直す
      if (row.data && typeof row.data === "object") applyRemoteData(row.data)
      else refetchSoon()
    }

    const startPolling = () => {
      if (pollTimer) return
      pollTimer = setInterval(fetchAll, 30000)
    }
    const stopPolling = () => { clearInterval(pollTimer); pollTimer = null }

    const connect = () => {
      if (unsubscribe) return
      const myGen = ++gen
      setSyncStatus("connecting")
      unsubscribe = subscribeUserRow(userId, onRow, status => {
        if (disposed || myGen !== gen) return
        if (status === "SUBSCRIBED") {
          stopPolling(); setSyncStatus("live")
          fetchAll() // 未接続の間に起きた変更を取り込む
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (document.visibilityState === "hidden") return
          startPolling(); setSyncStatus("polling")
        }
      })
    }
    const disconnect = () => {
      gen++
      if (unsubscribe) { const u = unsubscribe; unsubscribe = null; u() }
      stopPolling()
    }

    // バックグラウンドでは購読を止め、戻ったら再接続＋最新を取得
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { disconnect(); setSyncStatus("paused") }
      else { fetchAll(); connect() }
    }

    fetchAll()
    if (document.visibilityState !== "hidden") connect()
    else setSyncStatus("paused")
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      disposed = true
      document.removeEventListener("visibilitychange", onVisibility)
      clearTimeout(reconcileTimer)
      clearTimeout(refetchTimer)
      disconnect()
    }
  }, [userId, applyData])

  const handleLogin = (uid, data) => {
    setUserId(uid)
    applyData(data)
    lastSyncedData.current = stableStringify(data || {})
    unsavedChanges.current = false
    setScreen("catalog")
  }

  // ── 信頼性の高い保存（isSaving フラグ付き） ──
  const triggerSave = useCallback((newData) => {
    if (!userId) return
    unsavedChanges.current = true
    const seq = ++saveSeq.current
    // 保存できたら「サーバーと一致」の印を更新（あとから別の変更が入っていれば未保存のまま）
    const markSaved = () => {
      if (seq !== saveSeq.current) return
      unsavedChanges.current = false
      lastSyncedData.current = stableStringify(newData)
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      if (isSaving.current) {
        // 保存中なら少し待ってリトライ
        setTimeout(() => triggerSave(newData), 500)
        return
      }
      isSaving.current = true
      try {
        await saveData(userId, newData)
        markSaved()
        showToast("保存しました ✓")
      } catch (e) {
        showToast("保存失敗、再試行します...", "warn")
        // 5秒後にリトライ
        setTimeout(async () => {
          try { await saveData(userId, newData); markSaved(); showToast("保存しました ✓") }
          catch { showToast("保存に失敗しました", "error") }
        }, 5000)
      } finally { isSaving.current = false }
    }, 800) // デバウンスを短くして確実に保存
  }, [userId])

  const buildSave = useCallback((overrides = {}) => ({
    recipes, tagDefs, planEntries, bentoEntries, seasoningChecks,
    shoppingAdjust, deletedItems: [...deletedItems], manualItems, drugItems, history, ...overrides,
  }), [recipes, tagDefs, planEntries, bentoEntries, seasoningChecks, shoppingAdjust, deletedItems, manualItems, drugItems, history])

  // ── タグ操作（設定画面・レシピ登録画面から） ──
  const tagUsage = useMemo(() => {
    const count = {}
    recipes.forEach(r => getTags(r).forEach(t => { count[t] = (count[t] || 0) + 1 }))
    return count
  }, [recipes])

  const addTag = (rawName, color = "gray") => {
    const name = rawName.trim()
    if (!name) return false
    if (tagDefs.some(d => d.name === name)) { showToast("同じ名前のタグがあります", "warn"); return false }
    const next = [...tagDefs, { name, color }]
    setTagDefs(next); triggerSave(buildSave({ tagDefs: next }))
    return true
  }
  const renameTag = (oldName, rawName) => {
    const name = rawName.trim()
    if (!name || name === oldName) return false
    if (tagDefs.some(d => d.name === name)) { showToast("同じ名前のタグがあります", "warn"); return false }
    const nextDefs = tagDefs.map(d => d.name === oldName ? { ...d, name } : d)
    const nextRecipes = recipes.map(r => getTags(r).includes(oldName) ? withTags(r, getTags(r).map(t => t === oldName ? name : t)) : r)
    setTagDefs(nextDefs); setRecipes(nextRecipes)
    setFilterTags(f => f.map(t => t === oldName ? name : t))
    triggerSave(buildSave({ tagDefs: nextDefs, recipes: nextRecipes }))
    return true
  }
  const setTagColor = (name, color) => {
    const next = tagDefs.map(d => d.name === name ? { ...d, color } : d)
    setTagDefs(next); triggerSave(buildSave({ tagDefs: next }))
  }
  const moveTag = (name, dir) => {
    const i = tagDefs.findIndex(d => d.name === name), j = i + dir
    if (i < 0 || j < 0 || j >= tagDefs.length) return
    const next = [...tagDefs];[next[i], next[j]] = [next[j], next[i]]
    setTagDefs(next); triggerSave(buildSave({ tagDefs: next }))
  }
  const deleteTag = name => {
    const used = tagUsage[name] || 0
    if (!window.confirm(used ? `タグ「${name}」を削除しますか？\n${used}件のレシピからも外れます（レシピは消えません）` : `タグ「${name}」を削除しますか？`)) return
    const nextDefs = tagDefs.filter(d => d.name !== name)
    const nextRecipes = recipes.map(r => getTags(r).includes(name) ? withTags(r, getTags(r).filter(t => t !== name)) : r)
    setTagDefs(nextDefs); setRecipes(nextRecipes)
    setFilterTags(f => f.filter(t => t !== name))
    triggerSave(buildSave({ tagDefs: nextDefs, recipes: nextRecipes }))
  }

  // ── カタログの絞り込み（タグはすべて満たすもの・検索は名前/メモ/材料/タグ） ──
  const filteredRecipes = useMemo(() => {
    const q = searchKey(search.trim())
    return recipes.filter(r => {
      if (filterFav && !r.favorite) return false
      const tags = getTags(r)
      if (filterTags.some(t => !tags.includes(t))) return false
      if (!q) return true
      const hay = searchKey([r.name, r.memo, ...tags, ...(r.ingredients || []).map(i => i.name)].join(" "))
      return q.split(/\s+/).every(w => hay.includes(w))
    })
  }, [recipes, filterFav, filterTags, search])

  // ── レシピ操作 ──
  const toggleFavorite = id => {
    const next = recipes.map(r => r.id === id ? { ...r, favorite: !r.favorite } : r)
    setRecipes(next); triggerSave(buildSave({ recipes: next }))
  }
  const saveRecipe = recipe => {
    // 写真を差し替え・削除した場合は古いファイルを Storage から消す
    const prev = recipe.id ? recipes.find(r => r.id === recipe.id) : null
    if (prev?.photoPath && prev.photoPath !== recipe.photoPath) deleteRecipePhoto(prev.photoPath).catch(() => {})
    const next = recipe.id ? recipes.map(r => r.id === recipe.id ? recipe : r) : [...recipes, { ...recipe, id: Date.now() }]
    setRecipes(next)
    triggerSave(buildSave({ recipes: next }))
    setShowRegister(false); setEditRecipe(null)
    if (detailRecipe && recipe.id === detailRecipe.id) setDetailRecipe(recipe)
  }
  const deleteRecipe = id => {
    if (!window.confirm("このレシピを削除しますか？")) return
    const target = recipes.find(r => r.id === id)
    if (target?.photoPath) deleteRecipePhoto(target.photoPath).catch(() => {})
    const nextR = recipes.filter(r => r.id !== id)
    const nextP = planEntries.filter(e => e.recipeId !== id)
    const nextB = bentoEntries.filter(e => e.recipeId !== id)
    setRecipes(nextR); setPlanEntries(nextP); setBentoEntries(nextB)
    triggerSave(buildSave({ recipes: nextR, planEntries: nextP, bentoEntries: nextB }))
    if (detailRecipe?.id === id) setDetailRecipe(null)
  }

  // ── 献立プラン ──
  const sortedEntries = useMemo(() => [...planEntries].sort((a, b) => (a.date || "").localeCompare(b.date || "")), [planEntries])

  const addPlanEntry = () => {
    const lastDate = sortedEntries.length > 0 ? sortedEntries[sortedEntries.length - 1].date : null
    let nextDate = ""
    if (lastDate) { const d = new Date(lastDate); d.setDate(d.getDate() + 1); nextDate = d.toISOString().slice(0, 10) }
    const entry = { id: Date.now(), date: nextDate, recipeId: null, portion: 1, skip: false }
    const next = [...planEntries, entry]
    setPlanEntries(next); triggerSave(buildSave({ planEntries: next }))
  }

  const updateEntry = (id, patch) => {
    const next = planEntries.map(e => e.id === id ? { ...e, ...patch } : e)
    setPlanEntries(next); triggerSave(buildSave({ planEntries: next }))
  }

  const removeEntry = id => {
    const next = planEntries.filter(e => e.id !== id)
    setPlanEntries(next); triggerSave(buildSave({ planEntries: next }))
  }

  const moveEntry = (id, dir) => {
    const sorted = [...sortedEntries]
    const idx = sorted.findIndex(e => e.id === id)
    if (dir === -1 && idx === 0) return
    if (dir === 1 && idx === sorted.length - 1) return
    const a = sorted[idx], b = sorted[idx + dir]
    const next = planEntries.map(e => {
      if (e.id === a.id) return { ...e, date: b.date }
      if (e.id === b.id) return { ...e, date: a.date }
      return e
    })
    setPlanEntries(next); triggerSave(buildSave({ planEntries: next }))
  }

  // ── 履歴から献立をコピー（前回の献立をコピー／この週の献立を再利用） ──
  const copyFromHistory = week => {
    if (!week) return
    if ((planEntries.length || bentoEntries.length) && !window.confirm("今の献立は上書きされます。よろしいですか？")) return
    const { planEntries: nextP, bentoEntries: nextB, missing } = buildEntriesFromHistory(week, recipes)
    setPlanEntries(nextP); setBentoEntries(nextB)
    triggerSave(buildSave({ planEntries: nextP, bentoEntries: nextB }))
    setScreen("plan")
    setCopyResult({ source: week.label, period: formatPeriodLabel(nextP), planCount: nextP.length, bentoCount: nextB.length, missing })
  }

  // ── お弁当作り置き ──
  const addBentoEntry = () => {
    const entry = { id: Date.now(), recipeId: null, portion: 1, note: "" }
    const next = [...bentoEntries, entry]
    setBentoEntries(next); triggerSave(buildSave({ bentoEntries: next }))
  }
  const updateBentoEntry = (id, patch) => {
    const next = bentoEntries.map(e => e.id === id ? { ...e, ...patch } : e)
    setBentoEntries(next); triggerSave(buildSave({ bentoEntries: next }))
  }
  const removeBentoEntry = id => {
    const next = bentoEntries.filter(e => e.id !== id)
    setBentoEntries(next); triggerSave(buildSave({ bentoEntries: next }))
  }

  // ── 調味料 ──
  const allActiveSels = useMemo(() => {
    const planSels = planEntries.filter(e => !e.skip && e.recipeId).map(e => ({ recipeId: e.recipeId, portion: e.portion }))
    const bentoSels = bentoEntries.filter(e => e.recipeId).map(e => ({ recipeId: e.recipeId, portion: e.portion }))
    return [...planSels, ...bentoSels]
  }, [planEntries, bentoEntries])

  const allSeasonings = useMemo(() => mergeSeasonings(allActiveSels, recipes), [allActiveSels, recipes])

  const toggleSeasoningCheck = name => {
    const next = { ...seasoningChecks, [name]: !seasoningChecks[name] }
    setSeasoningChecks(next); triggerSave(buildSave({ seasoningChecks: next }))
  }

  // ── 買い物リスト ──
  const baseShoppingList = useMemo(() => {
    const merged = mergeIngredientsAdvanced(allActiveSels, recipes)
    const seasonings = allSeasonings.filter(s => seasoningChecks[s.name]).map(s => ({
      ...s, amount: Math.round(s.totalAmount * 10) / 10, isSeasoning: true
    }))
    const manual = manualItems.map(m => ({ ...m, isManual: true, category: m.category || "冷凍食品・その他" }))
    return [...merged, ...seasonings, ...manual]
  }, [allActiveSels, recipes, seasoningChecks, allSeasonings, manualItems])

  const shoppingList = useMemo(() => baseShoppingList
    .filter(i => !deletedItems.has(i.name))
    .map(i => ({
      ...i,
      displayAmount: shoppingAdjust[i.name] !== undefined ? shoppingAdjust[i.name] : i.amount,
      parts: i.mixed ? i.parts.map(p => {
        const key = adjustKey(i.name, p.unit, true)
        return { ...p, key, displayAmount: shoppingAdjust[key] !== undefined ? shoppingAdjust[key] : p.amount }
      }) : i.parts,
    }))
    .sort((a, b) => { const ai = STORE_ORDER.indexOf(a.category), bi = STORE_ORDER.indexOf(b.category); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) })
  , [baseShoppingList, shoppingAdjust, deletedItems])

  // key は adjustKey() の値。base は調整前の数量
  const adjustShopping = (key, delta, unit, base) => {
    // g・ml系は10刻み、それ以外（個・本・缶・人前・枚 etc）は1刻み
    const bigStep = ["g","ml","cc"].includes(unit)
    const step = bigStep ? 10 : 1
    const cur = shoppingAdjust[key] !== undefined ? shoppingAdjust[key] : (parseAmount(base) || 0)
    const next = { ...shoppingAdjust, [key]: Math.max(0, Math.round((cur + delta * step) * 10) / 10) }
    setShoppingAdjust(next); triggerSave(buildSave({ shoppingAdjust: next }))
  }
  const removeShoppingItem = name => {
    const next = new Set([...deletedItems, name])
    setDeletedItems(next); triggerSave(buildSave({ deletedItems: [...next] }))
  }

  // ── チェック（リアルタイム同期） ──
  const toggleCheck = async (name) => {
    const isChecked = checkedItems.includes(name)
    const next = isChecked ? checkedItems.filter(n => n !== name) : [...checkedItems, name]
    setCheckedItems(next)
    lastLocalCheckWrite.current = Date.now()
    try { await saveShoppingChecks(userId, next) } catch {}
    lastLocalCheckWrite.current = Date.now()
  }

  // 手動追加アイテム
  const addManualItem = () => {
    const trimmed = addManualInput.trim()
    if (!trimmed) return
    if (manualItems.find(m => m.name === trimmed)) { showToast("同じ名前のアイテムがあります", "warn"); return }
    const newItem = { id: Date.now(), name: trimmed, amount: 1, unit: "個", type: "通常食材", category: "冷凍食品・その他" }
    const next = [...manualItems, newItem]
    setManualItems(next); triggerSave(buildSave({ manualItems: next }))
    setAddManualInput("")
  }
  const removeManualItem = name => {
    const next = manualItems.filter(m => m.name !== name)
    setManualItems(next); triggerSave(buildSave({ manualItems: next }))
  }

  // ドラッグストア用リスト操作
  const addDrugItem = () => {
    const trimmed = addManualInput.trim()
    if (!trimmed) return
    if (drugItems.find(m => m.name === trimmed)) { showToast("同じ名前のアイテムがあります", "warn"); return }
    const newItem = { id: Date.now(), name: trimmed }
    const next = [...drugItems, newItem]
    setDrugItems(next); triggerSave(buildSave({ drugItems: next }))
    setAddManualInput("")
  }
  const removeDrugItem = name => {
    const next = drugItems.filter(m => m.name !== name)
    setDrugItems(next); triggerSave(buildSave({ drugItems: next }))
  }

  // ── 今回を締める ──
  const confirmPlan = () => {
    const planMenus = sortedEntries.map(e => {
      const r = recipes.find(r => r.id === e.recipeId)
      return { date: e.date, name: e.skip ? "（外食・スキップ）" : r ? r.name : "未設定", recipeId: !e.skip && r ? r.id : null, portion: e.portion, skip: e.skip }
    })
    const bentoMenus = bentoEntries.filter(e => e.recipeId).map(e => {
      const r = recipes.find(r => r.id === e.recipeId)
      return { name: r ? r.name : "不明", recipeId: r ? r.id : null, portion: e.portion, isBento: true, note: e.note }
    })
    const allMenus = [...planMenus, ...bentoMenus]
    const label = formatPeriodLabel(sortedEntries)
    const newHistory = [{ id: Date.now(), label, menus: allMenus }, ...history]
    setHistory(newHistory)
    setPlanEntries([]); setBentoEntries([]); setSeasoningChecks({})
    setShoppingAdjust({}); setDeletedItems(new Set()); setManualItems([])
    setCheckedItems([]); setShowConfirmPlan(false)
    saveShoppingChecks(userId, []).catch(() => {})
    triggerSave(buildSave({ history: newHistory, planEntries: [], bentoEntries: [], seasoningChecks: {}, shoppingAdjust: {}, deletedItems: [], manualItems: [] }))
    setScreen("history")
  }

  const deleteHistory = id => {
    if (!window.confirm("この履歴を削除しますか？")) return
    const next = history.filter(h => h.id !== id)
    setHistory(next); triggerSave(buildSave({ history: next }))
  }

  const logout = () => {
    clearUid()
    setUserId(null); setRecipes([]); setPlanEntries([]); setBentoEntries([])
    setSeasoningChecks({}); setShoppingAdjust({}); setDeletedItems(new Set())
    setManualItems([]); setDrugItems([]); setCheckedItems([]); setHistory([])
    setTagDefs(DEFAULT_TAG_DEFS); setFilterTags([]); setSearch(""); setScreen("catalog")
  }

  if (autoLogging) return (
    <><style>{CSS}</style>
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f6f2e9" }}>
      <img src="/icon-512.png" alt="CookFlow" style={{ width: 96, height: 96, borderRadius: 24, marginBottom: 14, boxShadow: "0 6px 24px rgba(46,93,78,0.18)" }} />
      <div style={{ fontFamily: "'Zen Maru Gothic',sans-serif", fontSize: 22, fontWeight: 700, color: "#2e5d4e", marginBottom: 22 }}>CookFlow</div>
      <div className="spinner" />
      <div style={{ fontSize: 13, color: "#8f9d94" }}>データを読み込んでいます...</div>
    </div></>
  )

  if (!userId) return (<><style>{CSS}</style><LoginScreen onLogin={handleLogin} /></>)

  const navItems = [
    { id: "catalog", icon: "📋", label: "カタログ" },
    { id: "plan", icon: "📅", label: "献立" },
    { id: "seasoning", icon: "🧂", label: "調味料" },
    { id: "shopping", icon: "🛒", label: "買い物" },
    { id: "history", icon: "📖", label: "履歴" },
  ]

  return (
    <div style={{ minHeight: "100vh", background: "#f6f2e9", fontFamily: "'Zen Kaku Gothic New','Hiragino Kaku Gothic ProN',sans-serif", color: "#1f2a24", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto", position: "relative" }}>
      <style>{CSS}</style>
      {toast && <div className={`toast ${toast.type === "error" ? "error" : toast.type === "warn" ? "warn" : ""}`}>{toast.msg}</div>}

      <header style={{ background: "#2e5d4e", color: "#f6f2e9", padding: "12px 12px 12px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, position: "sticky", top: 0, zIndex: 50 }}>
        <img src="/icon-512.png" alt="CookFlow" style={{ width: 32, height: 32, borderRadius: 8 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Zen Maru Gothic',sans-serif", fontSize: 17, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>CookFlow</div>
          <div style={{ fontSize: 10, color: "#b5c9bd", whiteSpace: "nowrap" }}>{({ catalog: "レシピ", plan: "献立", seasoning: "調味料チェック", shopping: "買い物リスト", history: "履歴", settings: "設定" })[screen]}</div>
        </div>
        <button aria-label="設定" onClick={() => setScreen(screen === "settings" ? "catalog" : "settings")}
          style={{ marginLeft: "auto", width: 40, height: 40, borderRadius: 12, border: "none", cursor: "pointer", fontSize: 19, background: screen === "settings" ? "rgba(246,242,233,0.22)" : "transparent", color: "#f6f2e9" }}>⚙️</button>
      </header>

      <div className="screen" style={{ flex: 1 }}>

        {/* ── カタログ ── */}
        {screen === "catalog" && (
          <div style={{ padding: "14px 16px 0" }}>
            <div className="search-box">
              <span className="icon">🔍</span>
              <input placeholder="料理名・材料・メモで検索" value={search} onChange={e => setSearch(e.target.value)} enterKeyHint="search" />
              {search && <button className="clear" aria-label="検索をクリア" onClick={() => setSearch("")}>✕</button>}
            </div>
            <div className="chip-row" style={{ marginBottom: 10 }}>
              <button className={`pill-btn ${!filterFav && !filterTags.length ? "active" : ""}`} onClick={() => { setFilterFav(false); setFilterTags([]) }}>すべて</button>
              <button className={`pill-btn ${filterFav ? "active" : ""}`} onClick={() => setFilterFav(f => !f)}>★ お気に入り</button>
              {tagDefs.map(d => {
                const on = filterTags.includes(d.name)
                const c = TAG_COLORS[d.color] || TAG_COLORS.gray
                return <button key={d.name} className="pill-btn" onClick={() => setFilterTags(f => on ? f.filter(t => t !== d.name) : [...f, d.name])}
                  style={on ? { background: c.fg, borderColor: c.fg, color: "#fff" } : { borderColor: c.bg, color: c.fg, background: "#fff" }}>{d.name}</button>
              })}
            </div>
            <div style={{ fontSize: 11, color: "#8f9d94", margin: "0 4px 8px", display: "flex", justifyContent: "space-between" }}>
              <span>{filteredRecipes.length}件{filteredRecipes.length !== recipes.length ? ` / 全${recipes.length}件` : ""}</span>
              {filterTags.length > 1 && <span>選んだタグをすべて含むレシピ</span>}
            </div>
            {!filteredRecipes.length
              ? <div className="empty-state"><div style={{ fontSize: 44, marginBottom: 12 }}>🍽️</div>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{recipes.length ? "条件に合うレシピがありません" : "レシピがありません"}</div>
                  <div style={{ fontSize: 12 }}>{recipes.length ? "検索やタグの条件をゆるめてみてね" : "右下の＋から登録してね"}</div></div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {filteredRecipes.map(r => (
                    <div key={r.id} className="recipe-card" onClick={() => setDetailRecipe(r)}>
                      <button className="fav-btn" aria-label="お気に入り" onClick={e => { e.stopPropagation(); toggleFavorite(r.id) }} style={{ padding: "6px 4px" }}>{r.favorite ? "★" : "☆"}</button>
                      {r.photoPath
                        ? <img src={getRecipePhotoUrl(r.photoPath)} alt="" className="recipe-thumb" loading="lazy" />
                        : <div className="recipe-thumb-ph">🍽️</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                        {getTags(r).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: r.memo ? 4 : 0 }}>{getTags(r).map(t => <TagChip key={t} name={t} defs={tagDefs} small />)}</div>}
                        {r.memo && <div style={{ fontSize: 11, color: "#7f8e85", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.memo}</div>}
                      </div>
                      <span style={{ color: "#b5c9bd", fontSize: 20 }}>›</span>
                    </div>
                  ))}
                </div>}
            <button className="fab" aria-label="レシピを追加" onClick={() => { setEditRecipe(null); setShowRegister(true) }}>＋</button>
          </div>
        )}

        {/* ── 献立プラン ── */}
        {screen === "plan" && (
          <div style={{ padding: "16px 16px 0" }}>

            {history.length > 0 && (
              <button className="btn btn-outline" style={{ width: "100%", marginBottom: 12 }} onClick={() => copyFromHistory(history[0])}>
                📋 前回の献立をコピー<span style={{ fontSize: 11, color: "#8f9d94", fontWeight: 400 }}>（{history[0].label}）</span>
              </button>
            )}

            {/* お弁当作り置きセクション */}
            <div className="bento-section">
              <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: bentoEntries.length > 0 ? "1px solid #d8c8f0" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>🍱</span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#4a2fa0" }}>お弁当作り置き</span>
                </div>
                <button className="btn btn-outline btn-sm" style={{ fontSize: 11, borderColor: "#c8b8f0", color: "#4a2fa0" }} onClick={addBentoEntry}>＋ 追加</button>
              </div>
              {bentoEntries.length === 0 && <div style={{ padding: "10px 14px", fontSize: 12, color: "#a090c0" }}>今回作り置きするお弁当メニューを追加してね</div>}
              {bentoEntries.map(entry => (
                <div key={entry.id} style={{ padding: "10px 14px", borderBottom: "1px solid #e8ddf8" }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                    <select value={entry.recipeId || ""} onChange={e => updateBentoEntry(entry.id, { recipeId: e.target.value ? Number(e.target.value) : null })} style={{ flex: 1, fontSize: 13, padding: "6px 10px" }}>
                      <option value="">── お弁当メニューを選択 ──</option>
                      {recipes.filter(r => getTags(r).includes(BENTO_TAG)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      <optgroup label="── その他のレシピ ──">
                        {recipes.filter(r => !getTags(r).includes(BENTO_TAG)).map(r => <option key={r.id} value={r.id}>{r.name}{getTags(r).length ? `（${getTags(r).join("・")}）` : ""}</option>)}
                      </optgroup>
                    </select>
                    <button className="btn-icon" style={{ color: "#c0391b" }} onClick={() => removeBentoEntry(entry.id)}>✕</button>
                  </div>
                  {entry.recipeId && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select className="portion-select" value={entry.portion} onChange={e => updateBentoEntry(entry.id, { portion: Number(e.target.value) })}>
                        <option value={0.5}>0.5回分（1人前）</option>
                        <option value={1}>1回分（2人前）</option>
                        <option value={1.5}>1.5回分（3人前）</option>
                        <option value={2}>2回分（4人前）</option>
                        <option value={2.5}>2.5回分（5人前）</option>
                        <option value={3}>3回分（6人前）</option>
                        <option value={4}>4回分（8人前）</option>
                      </select>
                      <input placeholder="メモ（例：月〜水用）" value={entry.note || ""} onChange={e => updateBentoEntry(entry.id, { note: e.target.value })} style={{ flex: 1, fontSize: 12, padding: "6px 10px" }} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 通常献立 */}
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#2e5d4e" }}>🍽️ 夕食・その他の献立</div>
              <button className="btn btn-outline btn-sm" onClick={addPlanEntry}>＋ 日を追加</button>
            </div>
            {sortedEntries.length === 0 && <div style={{ textAlign: "center", padding: "20px", color: "#8f9d94", fontSize: 13 }}>「＋ 日を追加」から始めよう</div>}
            {(() => {
              // 日付でグループ化（同じ日付のエントリをまとめる）
              const groups = []
              const seen = {}
              sortedEntries.forEach((entry, idx) => {
                const key = entry.date || `__nodate_${idx}`
                if (!seen[key]) { seen[key] = []; groups.push({ date: entry.date, key, entries: seen[key] }) }
                seen[key].push({ entry, idx })
              })
              return groups.map((group, gIdx) => {
                const firstIdx = group.entries[0]?.idx ?? 0
                const lastIdx = group.entries[group.entries.length - 1]?.idx ?? 0
                return (
                  <div key={group.key} className="date-entry">
                    {/* 日付ヘッダー（グループ共通） */}
                    <div className="date-entry-header">
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <button className="btn-icon" style={{ fontSize: 12, padding: "2px 6px" }} onClick={() => moveEntry(group.entries[0].entry.id, -1)} disabled={firstIdx === 0}>▲</button>
                        <button className="btn-icon" style={{ fontSize: 12, padding: "2px 6px" }} onClick={() => moveEntry(group.entries[group.entries.length-1].entry.id, 1)} disabled={lastIdx === sortedEntries.length - 1}>▼</button>
                      </div>
                      <input type="date" value={group.date || ""}
                        onChange={e => {
                          // グループ内の全エントリの日付を一括更新
                          const newDate = e.target.value
                          const next = planEntries.map(pe => group.entries.find(g => g.entry.id === pe.id) ? { ...pe, date: newDate } : pe)
                          setPlanEntries(next); triggerSave(buildSave({ planEntries: next }))
                        }}
                        style={{ width: 128, fontSize: 12, padding: "6px 6px", flex: "0 0 auto" }} />
                      <div style={{ fontSize: 12, color: "#66776d", whiteSpace: "nowrap", minWidth: 0 }}>{group.date ? formatDateLabel(group.date) : "日付未設定"}</div>
                      {/* スキップ：グループの最初のエントリで代表 */}
                      <button onClick={() => {
                        const isSkipped = group.entries[0].entry.skip
                        const next = planEntries.map(pe => group.entries.find(g => g.entry.id === pe.id) ? { ...pe, skip: !isSkipped } : pe)
                        setPlanEntries(next); triggerSave(buildSave({ planEntries: next }))
                      }} style={{ marginLeft: "auto", background: group.entries[0].entry.skip ? "#ebe7dc" : "none", border: "1.5px solid #d3cfc2", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, color: group.entries[0].entry.skip ? "#66776d" : "#a9b4ad", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
                        {group.entries[0].entry.skip ? "スキップ中" : "スキップ"}
                      </button>
                      <button className="btn-icon" style={{ color: "#c0391b", flexShrink: 0, padding: "4px 4px" }} onClick={() => {
                        // グループ内の全エントリを削除
                        const ids = group.entries.map(g => g.entry.id)
                        const next = planEntries.filter(pe => !ids.includes(pe.id))
                        setPlanEntries(next); triggerSave(buildSave({ planEntries: next }))
                      }}>✕</button>
                    </div>

                    {group.entries[0].entry.skip
                      ? <div style={{ padding: "10px 14px", fontSize: 13, color: "#a9b4ad" }}>外食・お休みの日</div>
                      : <>
                          {/* グループ内の各メニュー */}
                          {group.entries.map(({ entry }, mIdx) => (
                            <div key={entry.id} style={{ padding: "10px 14px", borderTop: mIdx > 0 ? "1px dashed #e2ddd0" : "none", display: "flex", flexDirection: "column", gap: 8 }}>
                              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                {group.entries.length > 1 && (
                                  <span style={{ fontSize: 11, color: "#2e5d4e", fontWeight: 700, minWidth: 20 }}>{mIdx + 1}.</span>
                                )}
                                <select value={entry.recipeId || ""} onChange={e => updateEntry(entry.id, { recipeId: e.target.value ? Number(e.target.value) : null })} style={{ flex: 1, fontSize: 13, padding: "7px 10px" }}>
                                  <option value="">── レシピを選択 ──</option>
                                  {recipes.map(r => <option key={r.id} value={r.id}>{r.name}{getTags(r).length ? `（${getTags(r).join("・")}）` : ""}</option>)}
                                </select>
                                {group.entries.length > 1 && (
                                  <button className="btn-icon" style={{ color: "#c0391b", fontSize: 14 }} onClick={() => removeEntry(entry.id)}>✕</button>
                                )}
                              </div>
                              {entry.recipeId && (
                                <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: group.entries.length > 1 ? 28 : 0 }}>
                                  <select className="portion-select" value={entry.portion} onChange={e => updateEntry(entry.id, { portion: Number(e.target.value) })}>
                                    <option value={0.5}>0.5日分（1人前）</option>
                                    <option value={1}>1日分（2人前）</option>
                                    <option value={1.5}>1.5日分（3人前）</option>
                                    <option value={2}>2日分（4人前）</option>
                                    <option value={2.5}>2.5日分（5人前）</option>
                                    <option value={3}>3日分（6人前）</option>
                                    <option value={4}>4日分（8人前）</option>
                                  </select>
                                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, whiteSpace: "nowrap" }} onClick={() => setDetailRecipe(recipes.find(r => r.id === entry.recipeId))}>レシピ確認 →</button>
                                </div>
                              )}
                            </div>
                          ))}
                          {/* この日にメニューを追加するボタン */}
                          <div style={{ padding: "8px 14px", borderTop: "1px dashed #e2ddd0" }}>
                            <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, color: "#2e5d4e" }} onClick={() => {
                              const newEntry = { id: Date.now(), date: group.date, recipeId: null, portion: 1, skip: false }
                              const next = [...planEntries, newEntry]
                              setPlanEntries(next); triggerSave(buildSave({ planEntries: next }))
                            }}>＋ この日にメニューを追加</button>
                          </div>
                        </>
                    }
                  </div>
                )
              })
            })()}

            {(planEntries.some(e => !e.skip && e.recipeId) || bentoEntries.some(e => e.recipeId)) && (
              <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setScreen("seasoning")}>調味料チェックへ →</button>
                <button className="btn btn-outline" style={{ flex: 1, borderColor: "#e8a000", color: "#8a6000" }} onClick={() => setShowConfirmPlan(true)}>🗓 買い物を締める</button>
              </div>
            )}
          </div>
        )}

        {/* ── 調味料チェック ── */}
        {screen === "seasoning" && (
          <div style={{ padding: "16px 16px 0" }}>
            <div style={{ marginBottom: 14, fontSize: 13, color: "#66776d" }}>今回使う調味料です。<br />家にない・買い足したいものにチェックを ✓</div>
            <div className="card" style={{ overflow: "hidden", marginBottom: 16 }}>
              {!allSeasonings.length && <div style={{ padding: "20px", color: "#a9b4ad", fontSize: 13, textAlign: "center" }}>献立タブでメニューを設定してください</div>}
              {allSeasonings.map(s => (
                <div key={s.name} className="check-row" onClick={() => toggleSeasoningCheck(s.name)}>
                  <div className={`custom-check ${seasoningChecks[s.name] ? "checked" : ""}`}>{seasoningChecks[s.name] ? "✓" : ""}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "#7f8e85", marginTop: 2 }}>合計 <strong>{Math.round(s.totalAmount * 10) / 10}{s.unit}</strong>　{s.recipes.join("・")}</div>
                  </div>
                  {seasoningChecks[s.name] && <span style={{ fontSize: 11, color: "#c0391b", fontWeight: 700, flexShrink: 0 }}>リストへ追加</span>}
                </div>
              ))}
            </div>
            <button className="btn btn-primary" style={{ width: "100%", padding: "13px" }} onClick={() => setScreen("shopping")}>買い物リストを見る →</button>
          </div>
        )}

        {/* ── 買い物リスト ── */}
        {screen === "shopping" && (
          <div style={{ padding: "16px 16px 0" }}>
            {/* タブ切り替え：スーパー / ドラッグストア */}
            <div className="tab-toggle" style={{ marginBottom: 14 }}>
              <button className={shoppingTab === "super" ? "active" : ""} onClick={() => setShoppingTab("super")}>🛒 スーパー</button>
              <button className={shoppingTab === "drug" ? "active" : ""} onClick={() => setShoppingTab("drug")}>💊 ドラッグストア</button>
            </div>

            {shoppingTab === "super" ? (
              <>
                {/* 同期インジケーター */}
                <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 11, color: "#66776d", display: "flex", alignItems: "center" }}>
                    <span className={`sync-dot ${syncStatus === "live" ? "" : syncStatus === "polling" ? "poll" : "off"}`} />{syncStatus === "live" ? "リアルタイム同期中" : syncStatus === "polling" ? "30秒ごとに同期中" : "接続中..."}
                  </div>
                  {(planEntries.some(e => !e.skip && e.recipeId) || bentoEntries.some(e => e.recipeId)) && (
                    <button className="btn btn-outline btn-sm" style={{ fontSize: 12, borderColor: "#e8a000", color: "#8a6000" }} onClick={() => setShowConfirmPlan(true)}>🗓 買い物を締める</button>
                  )}
                </div>

                {/* チェック後の並び替え設定（この端末のみ） */}
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                  <label className="switch" onClick={() => { const v = !moveChecked; setMoveChecked(v); saveMoveChecked(v) }}>
                    <span className={`switch-track ${moveChecked ? "on" : ""}`} />チェックしたら下へ移動
                  </label>
                </div>

                {/* 手動追加 */}
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <input placeholder="＋ アイテムを手入力（例：洗剤）" value={addManualInput} onChange={e => setAddManualInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addManualItem()} style={{ flex: 1, fontSize: 13, padding: "9px 12px" }} />
                  <button className="btn btn-primary btn-sm" onClick={addManualItem} style={{ whiteSpace: "nowrap" }}>追加</button>
                </div>

                {!shoppingList.length && <div className="empty-state"><div style={{ fontSize: 44, marginBottom: 12 }}>🛒</div><div>献立タブでメニューを設定するか<br />上の欄から手動で追加してください</div></div>}

                {STORE_ORDER.map(cat => {
                  const allItems = shoppingList.filter(i => i.category === cat)
                  if (!allItems.length) return null
                  const unchecked = allItems.filter(i => !checkedItems.includes(i.name))
                  const checked = allItems.filter(i => checkedItems.includes(i.name))
                  return (
                    <div key={cat} style={{ marginBottom: 14 }}>
                      <div className="section-head">{cat}</div>
                      <div className="card" style={{ overflow: "hidden" }}>
                        {(moveChecked ? [...unchecked, ...checked] : allItems).map(item => {
                          const isChecked = checkedItems.includes(item.name)
                          return (
                            <div key={item.name} className="item-row" style={{ opacity: isChecked ? 0.42 : 1, background: isChecked ? "#f6f2e9" : "#fff" }}>
                              <div onClick={() => toggleCheck(item.name)} style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isChecked ? "#2e5d4e" : "#d3cfc2"}`, background: isChecked ? "#2e5d4e" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "#fff", fontSize: 14 }}>
                                {isChecked ? "✓" : ""}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 500, fontSize: 14, textDecoration: isChecked ? "line-through" : "none" }}>{item.name}</div>
                                {item.isSeasoning && <span style={{ fontSize: 10, color: "#7f8e85" }}>調味料（買い足し）</span>}
                                {item.isManual && <span style={{ fontSize: 10, color: "#5a8aa0" }}>手動追加</span>}
                                {/* 単位が異なる同名食材：内訳ごとに数量調整 */}
                                {item.mixed && <>
                                  <div style={{ fontSize: 12, fontWeight: 700, color: "#2e5d4e", marginTop: 2 }}>{item.parts.map(p => `${p.displayAmount}${p.unit}`).join(" ＋ ")}</div>
                                  {item.parts.map(p => (
                                    <div key={p.unit} className="part-row">
                                      <span className="part-label">└ {p.recipes.join("・")}</span>
                                      <div className="num-ctrl">
                                        <button className="num-btn sm" onClick={() => adjustShopping(p.key, -1, p.unit, p.amount)}>−</button>
                                        <span style={{ minWidth: 48, textAlign: "center", fontSize: 12, fontWeight: 700 }}>{p.displayAmount}{p.unit}</span>
                                        <button className="num-btn sm" onClick={() => adjustShopping(p.key, 1, p.unit, p.amount)}>＋</button>
                                      </div>
                                    </div>
                                  ))}
                                </>}
                              </div>
                              {item.mixed ? null : !item.isSeasoning
                                ? <div className="num-ctrl">
                                    <button className="num-btn" onClick={() => adjustShopping(item.name, -1, item.unit, item.amount)}>−</button>
                                    <span style={{ minWidth: 60, textAlign: "center", fontSize: 14, fontWeight: 700 }}>{item.displayAmount}{item.unit}</span>
                                    <button className="num-btn" onClick={() => adjustShopping(item.name, 1, item.unit, item.amount)}>＋</button>
                                  </div>
                                : <span style={{ fontSize: 13, color: "#66776d" }}>{item.amount}{item.unit}</span>}
                              <button className="btn btn-ghost btn-sm" style={{ color: "#c0391b", padding: "4px 8px" }} onClick={() => item.isManual ? removeManualItem(item.name) : removeShoppingItem(item.name)}>✕</button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                {checkedItems.length > 0 && <div style={{ textAlign: "center", padding: "8px", fontSize: 12, color: "#66776d" }}>{checkedItems.length}品チェック済み</div>}
              </>
            ) : (
              <>
                {/* ドラッグストア用リスト */}
                <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "#66776d", display: "flex", alignItems: "center" }}><span className={`sync-dot ${syncStatus === "live" ? "" : syncStatus === "polling" ? "poll" : "off"}`} />{syncStatus === "live" ? "リアルタイム同期中" : syncStatus === "polling" ? "30秒ごとに同期中" : "接続中..."}</span>
                </div>
                <div style={{ background: "#fdf0e9", border: "1.5px solid #f3c3a8", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "#a64a22" }}>
                  💊 ウェル活・ドラッグストアの買い物はここで管理。スーパーのリストとは別に独立しています。
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <input placeholder="＋ アイテムを追加（例：シャンプー）" value={addManualInput} onChange={e => setAddManualInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addDrugItem()} style={{ flex: 1, fontSize: 13, padding: "9px 12px" }} />
                  <button className="btn btn-primary btn-sm" onClick={addDrugItem} style={{ whiteSpace: "nowrap", background: "#d9602c" }}>追加</button>
                </div>
                {drugItems.length > 0 && <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                  <label className="switch" onClick={() => { const v = !moveChecked; setMoveChecked(v); saveMoveChecked(v) }}>
                    <span className={`switch-track ${moveChecked ? "on" : ""}`} />チェックしたら下へ移動
                  </label>
                </div>}
                {!drugItems.length && <div className="empty-state"><div style={{ fontSize: 44, marginBottom: 12 }}>💊</div><div>ウェル活で買いたいものを<br />上の欄から追加してください</div></div>}
                {drugItems.length > 0 && (
                  <div className="card" style={{ overflow: "hidden" }}>
                    {(moveChecked ? [...drugItems.filter(i => !checkedItems.includes(i.name)), ...drugItems.filter(i => checkedItems.includes(i.name))] : drugItems).map(item => {
                      const isChecked = checkedItems.includes(item.name)
                      return (
                        <div key={item.name} className="item-row" style={{ opacity: isChecked ? 0.42 : 1, background: isChecked ? "#f6f2e9" : "#fff" }}>
                          <div onClick={() => toggleCheck(item.name)} style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isChecked ? "#d9602c" : "#d3cfc2"}`, background: isChecked ? "#d9602c" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "#fff", fontSize: 14 }}>
                            {isChecked ? "✓" : ""}
                          </div>
                          <div style={{ flex: 1, fontWeight: 500, fontSize: 14, textDecoration: isChecked ? "line-through" : "none" }}>{item.name}</div>
                          <button className="btn btn-ghost btn-sm" style={{ color: "#c0391b", padding: "4px 8px" }} onClick={() => removeDrugItem(item.name)}>✕</button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── 履歴 ── */}
        {/* ── 設定 ── */}
        {screen === "settings" && (
          <div style={{ padding: "16px 16px 0" }}>
            <div className="settings-title">🏷 タグ</div>
            <div style={{ fontSize: 11, color: "#7f8e85", margin: "-4px 4px 8px", lineHeight: 1.6 }}>
              名前をタップして変更、左の丸で色を変更できます。並び順はカタログの絞り込みやレシピ登録画面の順番になります。
            </div>
            <div className="settings-section">
              {tagDefs.map((d, i) => (
                <TagSettingsRow key={d.name} def={d} count={tagUsage[d.name] || 0} isFirst={i === 0} isLast={i === tagDefs.length - 1}
                  onRename={renameTag} onColor={setTagColor} onMove={moveTag} onDelete={deleteTag} />
              ))}
              {!tagDefs.length && <div className="settings-row" style={{ color: "#8f9d94", fontSize: 13 }}>タグがありません</div>}
              <form className="settings-row" style={{ background: "#fbf9f4" }} onSubmit={e => {
                e.preventDefault()
                const input = e.currentTarget.elements.newTag
                const palette = Object.keys(TAG_COLORS)
                if (addTag(input.value, palette[tagDefs.length % palette.length])) input.value = ""
              }}>
                <input name="newTag" placeholder="新しいタグ（例：鍋、作り置き）" style={{ flex: 1, fontSize: 14, padding: "8px 10px", background: "#fff" }} />
                <button type="submit" className="btn btn-primary btn-sm" style={{ whiteSpace: "nowrap" }}>＋ 追加</button>
              </form>
            </div>

            <div className="settings-title">🛒 買い物リスト</div>
            <div className="settings-section">
              <div className="settings-row" onClick={() => { const v = !moveChecked; setMoveChecked(v); saveMoveChecked(v) }} style={{ cursor: "pointer" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>チェックしたら下へ移動</div>
                  <div style={{ fontSize: 11, color: "#7f8e85", marginTop: 2 }}>この端末だけの設定です</div>
                </div>
                <span className={`switch-track ${moveChecked ? "on" : ""}`} />
              </div>
            </div>

            <div className="settings-title">👤 アカウント</div>
            <div className="settings-section">
              <div className="settings-row">
                <div style={{ flex: 1, fontSize: 14 }}>ユーザー名</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{userId}</div>
              </div>
              <div className="settings-row">
                <div style={{ flex: 1, fontSize: 12, color: "#7f8e85", lineHeight: 1.6 }}>同じユーザー名でログインすると、2人でレシピ・献立・買い物リストを共有できます。</div>
              </div>
              <button className="settings-row" onClick={() => { if (window.confirm("ログアウトしますか？")) logout() }}
                style={{ width: "100%", border: "none", background: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: "#c0391b", justifyContent: "center", fontWeight: 600 }}>ログアウト</button>
            </div>

            <div style={{ textAlign: "center", fontSize: 11, color: "#a9b4ad", padding: "4px 0 12px" }}>CookFlow</div>
          </div>
        )}

        {screen === "history" && (
          <div style={{ padding: "16px 16px 0" }}>
            {!history.length && <div className="empty-state"><div style={{ fontSize: 44, marginBottom: 12 }}>📖</div><div>まだ履歴がありません</div></div>}
            {history.map(week => (
              <div key={week.id} className="history-week" style={{ marginBottom: 14, background: "#fff" }}>
                <div style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: expandedHistory === week.id ? "#eef3ec" : "#fff" }}
                  onClick={() => setExpandedHistory(expandedHistory === week.id ? null : week.id)}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{week.label}</div>
                    <div style={{ fontSize: 11, color: "#7f8e85", marginTop: 2 }}>{week.menus.length}日分</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); setEditingHistory(week) }}>✏️</button>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: "#c0391b" }} onClick={e => { e.stopPropagation(); deleteHistory(week.id) }}>🗑</button>
                    <span style={{ color: "#66776d" }}>{expandedHistory === week.id ? "▲" : "▼"}</span>
                  </div>
                </div>
                {expandedHistory === week.id && (
                  <div style={{ borderTop: "1px solid #ebe7dc" }}>
                    {week.menus.map((m, i) => (
                      <div key={i} className="item-row">
                        {m.isBento
                          ? <span style={{ fontSize: 11, color: "#4a2fa0", minWidth: 80 }}>🍱 お弁当</span>
                          : <span style={{ fontSize: 12, color: "#66776d", minWidth: 80 }}>{m.date ? formatDateLabel(m.date) : `${i+1}日目`}</span>}
                        <span style={{ flex: 1, fontSize: 14, color: m.skip ? "#a9b4ad" : "#1f2a24" }}>{m.name}</span>
                        {/* レシピ詳細を見るボタン */}
                        {!m.skip && (() => {
                          const r = (m.recipeId && recipes.find(r => r.id === m.recipeId)) || recipes.find(r => r.name === m.name)
                          return r ? <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: "#5a8aa0" }} onClick={() => setDetailRecipe(r)}>詳細</button> : null
                        })()}
                        {!m.skip && <span style={{ fontSize: 11, color: "#7f8e85" }}>{m.portion === 1 ? "1日分" : `${m.portion}日分`}</span>}
                      </div>
                    ))}
                    <div style={{ padding: "12px 16px", borderTop: "1px solid #ebe7dc", background: "#fbf9f4" }}>
                      <button className="btn btn-outline" style={{ width: "100%" }} onClick={() => copyFromHistory(week)}>🔁 この週の献立を再利用</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <nav style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#fff", borderTop: "1px solid #e2ddd0", display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {navItems.map(n => (
          <button key={n.id} onClick={() => setScreen(n.id)} style={{ flex: 1, border: "none", background: "none", cursor: "pointer", padding: "10px 4px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontFamily: "inherit", color: screen === n.id ? "#2e5d4e" : "#8f9d94", transition: "color .15s" }}>
            <span style={{ fontSize: 20 }}>{n.icon}</span>
            <span style={{ fontSize: 10, fontWeight: screen === n.id ? 700 : 400 }}>{n.label}</span>
            {screen === n.id && <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#2e5d4e" }} />}
          </button>
        ))}
      </nav>

      {detailRecipe && <RecipeDetailSheet recipe={detailRecipe} tagDefs={tagDefs} onDelete={() => deleteRecipe(detailRecipe.id)} onClose={() => setDetailRecipe(null)} onEdit={detailRecipe ? () => { setEditRecipe(detailRecipe); setShowRegister(true); setDetailRecipe(null) } : null} />}
      {showRegister && <RegisterSheet recipe={editRecipe} userId={userId} tagDefs={tagDefs} onAddTag={addTag} onSave={saveRecipe} onClose={() => { setShowRegister(false); setEditRecipe(null) }} />}
      {editingHistory && <HistoryEditSheet historyItem={editingHistory} recipes={recipes} onSave={updated => {
        const next = history.map(h => h.id === updated.id ? updated : h)
        setHistory(next); triggerSave(buildSave({ history: next })); setEditingHistory(null)
      }} onClose={() => setEditingHistory(null)} />}

      {copyResult && (
        <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setCopyResult(null) }}>
          <div className="sheet" style={{ maxWidth: 420 }}>
            <div style={{ textAlign: "center", marginBottom: 18 }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>📋</div>
              <h3 style={{ fontFamily: "'Zen Maru Gothic',sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 10 }}>コピーしました</h3>
              <p style={{ fontSize: 13, color: "#66776d", lineHeight: 1.7 }}>日付を確認してください。<br />曜日はそのままで、今日以降の日付にずらしています。</p>
            </div>
            <div style={{ background: "#eef3ec", borderRadius: 12, padding: "12px 16px", marginBottom: 20, fontSize: 13, lineHeight: 1.8 }}>
              <div><span style={{ color: "#66776d" }}>コピー元：</span>{copyResult.source}</div>
              <div><span style={{ color: "#66776d" }}>新しい期間：</span><strong style={{ color: "#2e5d4e" }}>{copyResult.period}</strong></div>
              <div style={{ color: "#66776d" }}>献立 {copyResult.planCount}件 ／ お弁当 {copyResult.bentoCount}件</div>
              {copyResult.missing.length > 0 && <div className="error-msg" style={{ marginTop: 8 }}>⚠️ 見つからないレシピは未設定にしました：{copyResult.missing.join("・")}</div>}
            </div>
            <button className="btn btn-primary" style={{ width: "100%", padding: "13px" }} onClick={() => setCopyResult(null)}>日付を確認する</button>
          </div>
        </div>
      )}

      {showConfirmPlan && (
        <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setShowConfirmPlan(false) }}>
          <div className="sheet" style={{ maxWidth: 420 }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🗓</div>
              <h3 style={{ fontFamily: "'Zen Maru Gothic',sans-serif", fontSize: 20, fontWeight: 700, marginBottom: 10 }}>今回の買い物を締めますか？</h3>
              <p style={{ fontSize: 13, color: "#66776d", lineHeight: 1.7 }}>献立を履歴に保存して、買い物リストをリセットします。<br /><span style={{ color: "#c0391b", fontWeight: 600 }}>※この操作は取り消せません</span></p>
            </div>
            <div style={{ background: "#eef3ec", borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "#66776d", marginBottom: 6, fontWeight: 700 }}>保存される献立</div>
              {sortedEntries.filter(e => !e.skip && e.recipeId).slice(0, 4).map((e, i) => {
                const r = recipes.find(r => r.id === e.recipeId)
                return <div key={i} style={{ fontSize: 13, color: "#2e5d4e", marginBottom: 2 }}>・{e.date ? formatDateLabel(e.date) : ""} {r?.name}</div>
              })}
              {bentoEntries.filter(e => e.recipeId).slice(0, 2).map((e, i) => {
                const r = recipes.find(r => r.id === e.recipeId)
                return <div key={i} style={{ fontSize: 13, color: "#4a2fa0", marginBottom: 2 }}>🍱 {r?.name}（お弁当）</div>
              })}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowConfirmPlan(false)}>キャンセル</button>
              <button className="btn btn-primary" style={{ flex: 2, padding: "13px", background: "#8a6000" }} onClick={confirmPlan}>締めて履歴に保存する</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 設定：タグ1行（名前の変更・色・並べ替え・削除） ──
function TagSettingsRow({ def, count, isFirst, isLast, onRename, onColor, onMove, onDelete }) {
  const [name, setName] = useState(def.name)
  const [open, setOpen] = useState(false)
  useEffect(() => setName(def.name), [def.name])
  const c = TAG_COLORS[def.color] || TAG_COLORS.gray
  const commit = () => { if (name.trim() !== def.name && !onRename(def.name, name)) setName(def.name) }
  return (
    <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <button className="icon-btn" style={{ padding: "2px 6px", fontSize: 11 }} disabled={isFirst} onClick={() => onMove(def.name, -1)} aria-label="上へ">▲</button>
          <button className="icon-btn" style={{ padding: "2px 6px", fontSize: 11 }} disabled={isLast} onClick={() => onMove(def.name, 1)} aria-label="下へ">▼</button>
        </div>
        <button onClick={() => setOpen(o => !o)} aria-label="色を変える" className="color-dot" style={{ background: c.fg, borderColor: open ? "#1f2a24" : "transparent" }} />
        <input value={name} onChange={e => setName(e.target.value)} onBlur={commit} onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()}
          style={{ flex: 1, fontSize: 14, padding: "7px 10px", background: c.bg, color: c.fg, fontWeight: 700, borderColor: "transparent" }} />
        <span style={{ fontSize: 11, color: "#8f9d94", minWidth: 34, textAlign: "right", whiteSpace: "nowrap" }}>{count}件</span>
        <button className="icon-btn" style={{ color: "#c0391b" }} onClick={() => onDelete(def.name)} aria-label="削除">🗑</button>
      </div>
      {open && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingLeft: 36 }}>
          {Object.entries(TAG_COLORS).map(([key, col]) => (
            <button key={key} aria-label={key} className={`color-dot ${def.color === key ? "active" : ""}`} style={{ background: col.fg }} onClick={() => { onColor(def.name, key); setOpen(false) }} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 履歴編集シート ──
function HistoryEditSheet({ historyItem, recipes, onSave, onClose }) {
  const [menus, setMenus] = useState(historyItem.menus.map(m => ({ ...m })))
  const updateMenu = (i, patch) => setMenus(ms => ms.map((m, j) => j === i ? { ...m, ...patch } : m))
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontFamily: "'Zen Maru Gothic',sans-serif", fontSize: 18, fontWeight: 700 }}>履歴を編集</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: "#66776d", marginBottom: 14 }}>{historyItem.label}</div>
        {menus.map((m, i) => (
          <div key={i} style={{ background: "#f3f1ea", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#66776d", marginBottom: 6 }}>{m.isBento ? "🍱 お弁当" : m.date ? formatDateLabel(m.date) : `${i+1}日目`}</div>
            {!m.skip
              ? <select value={recipes.find(r => r.name === m.name)?.id || ""} onChange={e => {
                  const r = recipes.find(r => r.id === Number(e.target.value))
                  updateMenu(i, { name: r ? r.name : m.name })
                }} style={{ fontSize: 13, padding: "7px 10px" }}>
                  <option value="">── 選択 ──</option>
                  {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              : <div style={{ fontSize: 13, color: "#a9b4ad" }}>外食・スキップ</div>}
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>キャンセル</button>
          <button className="btn btn-primary" style={{ flex: 2, padding: "13px" }} onClick={() => onSave({ ...historyItem, menus })}>保存する</button>
        </div>
      </div>
    </div>
  )
}

// ── レシピ登録シート ──
// ── 写真の範囲調整 ──
// 4:3 の枠 = レシピ詳細の写真、中央の点線の正方形 = 一覧のサムネイル。ドラッグで移動、ピンチ/スライダーで拡大
const PHOTO_ASPECT = 4 / 3
function PhotoCropper({ file, onCancel, onDone }) {
  const stageRef = useRef(null)
  const [src, setSrc] = useState(null)
  const [img, setImg] = useState(null)
  const [failed, setFailed] = useState(false)
  const [frameW, setFrameW] = useState(0)
  const [view, setView] = useState(null) // { scale: 画面px/画像px, x, y: 画像左上の位置 }
  const viewRef = useRef(null)
  const pointers = useRef(new Map())
  const gesture = useRef(null)
  const frameH = frameW / PHOTO_ASPECT
  const minScale = img && frameW ? Math.max(frameW / img.naturalWidth, frameH / img.naturalHeight) : 1
  viewRef.current = view

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const im = new Image()
    im.onload = () => setImg(im)
    im.onerror = () => setFailed(true)
    im.src = url
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setFrameW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [img])

  // 画像が枠を必ず覆うように位置と倍率をおさえる
  const clamp = useCallback(v => {
    if (!img) return v
    const scale = Math.min(Math.max(v.scale, minScale), minScale * 5)
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale
    return { scale, x: Math.min(0, Math.max(frameW - w, v.x)), y: Math.min(0, Math.max(frameH - h, v.y)) }
  }, [img, minScale, frameW, frameH])

  // 初期表示：枠いっぱい・中央
  useEffect(() => {
    if (!img || !frameW) return
    setView({ scale: minScale, x: (frameW - img.naturalWidth * minScale) / 2, y: (frameH - img.naturalHeight * minScale) / 2 })
  }, [img, frameW]) // eslint-disable-line react-hooks/exhaustive-deps

  // (cx, cy) を中心に倍率を変える
  const zoomAt = (nextScale, cx, cy, base = viewRef.current) => {
    if (!base) return
    const r = nextScale / base.scale
    setView(clamp({ scale: nextScale, x: cx - (cx - base.x) * r, y: cy - (cy - base.y) * r }))
  }

  const localPoint = e => { const b = stageRef.current.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top } }
  const startGesture = () => {
    const pts = [...pointers.current.values()]
    gesture.current = { view: viewRef.current, pts: pts.map(p => ({ ...p })) }
  }
  const onPointerDown = e => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, localPoint(e))
    startGesture()
  }
  const onPointerMove = e => {
    if (!pointers.current.has(e.pointerId) || !gesture.current?.view) return
    pointers.current.set(e.pointerId, localPoint(e))
    const now = [...pointers.current.values()]
    const { view: v0, pts: p0 } = gesture.current
    if (now.length === 1 && p0.length === 1) {
      setView(clamp({ ...v0, x: v0.x + now[0].x - p0[0].x, y: v0.y + now[0].y - p0[0].y }))
    } else if (now.length >= 2 && p0.length >= 2) {
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
      const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      const m0 = mid(p0[0], p0[1]), m1 = mid(now[0], now[1])
      const scale = v0.scale * dist(now[0], now[1]) / Math.max(1, dist(p0[0], p0[1]))
      // 指の中心にあった画像の点が、指の中心についてくるように
      const ix = (m0.x - v0.x) / v0.scale, iy = (m0.y - v0.y) / v0.scale
      setView(clamp({ scale, x: m1.x - ix * scale, y: m1.y - iy * scale }))
    }
  }
  const onPointerUp = e => { pointers.current.delete(e.pointerId); startGesture() }
  const onWheel = e => { const p = localPoint(e); zoomAt(viewRef.current.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), p.x, p.y) }

  const confirm = () => {
    if (!img || !view) return
    const sw = frameW / view.scale, sh = frameH / view.scale
    const outW = Math.round(Math.min(1280, sw)), outH = Math.round(outW / PHOTO_ASPECT)
    const canvas = document.createElement("canvas")
    canvas.width = outW; canvas.height = outH
    canvas.getContext("2d").drawImage(img, -view.x / view.scale, -view.y / view.scale, sw, sh, 0, 0, outW, outH)
    canvas.toBlob(blob => onDone(blob || file), "image/jpeg", 0.85)
  }

  const guide = "rgba(255,255,255,.55)"
  return (
    <div className="overlay" style={{ zIndex: 300, alignItems: "center", padding: 16 }}>
      <div style={{ background: "#fbf9f4", borderRadius: 20, width: "100%", maxWidth: 440, padding: "18px 16px 16px", animation: "slideUp .25s" }}>
        <div style={{ fontFamily: "'Zen Maru Gothic',sans-serif", fontSize: 17, fontWeight: 700, marginBottom: 4 }}>写真の範囲を調整</div>
        <div style={{ fontSize: 12, color: "#66776d", marginBottom: 12, lineHeight: 1.6 }}>ドラッグで位置、2本指かスライダーで拡大できます</div>
        {failed ? (
          <div className="error-msg" style={{ marginBottom: 12 }}>この写真は範囲を調整できない形式のため、そのまま使います。</div>
        ) : (
          <div ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}
            style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", overflow: "hidden", borderRadius: 12, background: "#1f2a24", touchAction: "none", cursor: "grab", userSelect: "none" }}>
            {src && view && <img src={src} alt="" draggable={false}
              style={{ position: "absolute", left: 0, top: 0, width: img.naturalWidth * view.scale, height: img.naturalHeight * view.scale, transform: `translate(${view.x}px, ${view.y}px)`, maxWidth: "none", pointerEvents: "none" }} />}
            {!view && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" style={{ margin: 0 }} /></div>}
            {/* 三分割のガイド線 */}
            {[1, 2].map(i => <div key={`v${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${(i * 100) / 3}%`, width: 1, background: "rgba(255,255,255,.25)", pointerEvents: "none" }} />)}
            {[1, 2].map(i => <div key={`h${i}`} style={{ position: "absolute", left: 0, right: 0, top: `${(i * 100) / 3}%`, height: 1, background: "rgba(255,255,255,.25)", pointerEvents: "none" }} />)}
            {/* 一覧のサムネイル（中央の正方形） */}
            {frameW > 0 && <div style={{ position: "absolute", top: 0, bottom: 0, left: (frameW - frameH) / 2, width: frameH, border: `2px dashed ${guide}`, boxShadow: "0 0 0 1px rgba(0,0,0,.15)", pointerEvents: "none" }}>
              <span style={{ position: "absolute", left: 6, top: 6, fontSize: 10, color: "#fff", background: "rgba(0,0,0,.45)", borderRadius: 6, padding: "2px 6px" }}>一覧のサムネイル</span>
            </div>}
            <span style={{ position: "absolute", right: 8, bottom: 8, fontSize: 10, color: "#fff", background: "rgba(0,0,0,.45)", borderRadius: 6, padding: "2px 6px", pointerEvents: "none" }}>枠全体：詳細画面の写真</span>
          </div>
        )}
        {!failed && view && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 2px 4px" }}>
            <span style={{ fontSize: 13 }}>🔍</span>
            <input type="range" min={1} max={5} step={0.01} value={view.scale / minScale} aria-label="拡大"
              onChange={e => zoomAt(minScale * Number(e.target.value), frameW / 2, frameH / 2)}
              style={{ flex: 1, padding: 0, border: "none", background: "none", accentColor: "#2e5d4e" }} />
            <button className="btn btn-ghost btn-sm" onClick={() => setView(clamp({ scale: minScale, x: (frameW - img.naturalWidth * minScale) / 2, y: (frameH - img.naturalHeight * minScale) / 2 }))}>リセット</button>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onCancel}>キャンセル</button>
          <button className="btn btn-primary" style={{ flex: 2, padding: "12px" }} disabled={!failed && !view} onClick={() => failed ? onDone(file) : confirm()}>
            {failed ? "そのまま使う" : "この範囲で決定"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── レシピ登録：タグを複数選ぶ（その場で新しいタグも作れる） ──
function TagPicker({ tagDefs, value, onChange, onAddTag }) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState("")
  const toggle = name => onChange(value.includes(name) ? value.filter(t => t !== name) : [...value, name])
  const submitNew = () => {
    const name = newName.trim()
    if (!name) { setAdding(false); return }
    const exists = tagDefs.some(d => d.name === name)
    if (exists || onAddTag(name, Object.keys(TAG_COLORS)[tagDefs.length % Object.keys(TAG_COLORS).length])) {
      if (!value.includes(name)) onChange([...value, name])
      setNewName(""); setAdding(false)
    }
  }
  return (
    <div>
      <label style={{ fontSize: 11, color: "#66776d", display: "block", marginBottom: 6, fontWeight: 700 }}>
        タグ <span style={{ fontWeight: 400, color: "#8f9d94" }}>（いくつでも選べます）</span>
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {tagDefs.map(d => {
          const on = value.includes(d.name)
          const c = TAG_COLORS[d.color] || TAG_COLORS.gray
          return <button key={d.name} type="button" className="pill-btn" onClick={() => toggle(d.name)}
            style={on ? { background: c.fg, borderColor: c.fg, color: "#fff" } : { borderColor: c.bg, color: c.fg, background: "#fff" }}>
            {on ? "✓ " : ""}{d.name}
          </button>
        })}
        {adding
          ? <span style={{ display: "inline-flex", gap: 4 }}>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submitNew() } if (e.key === "Escape") setAdding(false) }}
                placeholder="タグ名" style={{ width: 110, fontSize: 12, padding: "5px 10px", borderRadius: 20 }} />
              <button type="button" className="btn btn-primary btn-sm" style={{ borderRadius: 20 }} onClick={submitNew}>追加</button>
            </span>
          : <button type="button" className="pill-btn" style={{ borderStyle: "dashed", color: "#66776d" }} onClick={() => setAdding(true)}>＋ 新しいタグ</button>}
      </div>
    </div>
  )
}

function RegisterSheet({ recipe, userId, tagDefs, onAddTag, onSave, onClose }) {
  // _catAuto: カテゴリが自動推論のままか（手動で選んだら false にして以後は上書きしない）
  const blankIng = () => ({ name: "", amount: "", unit: "g", type: "通常食材", category: "野菜・果物", _catAuto: true })
  const blank = { name: "", tags: [], favorite: false, memo: "", url: "", photoPath: null, steps: [""], servings: 2, ingredients: [blankIng()] }
  const [form, setForm] = useState(() => { if (!recipe) return blank; const r = JSON.parse(JSON.stringify(recipe)); r.tags = getTags(r); if (!r.steps) r.steps = [""]; if (!r.servings) r.servings = 2; return r })
  const [regTab, setRegTab] = useState("basic")
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState("")
  const fileInput = useRef(null)
  const uploadedPaths = useRef([]) // この画面でアップロードしたもの（保存しなかった分は後で消す）
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setStep = (i, v) => setForm(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? v : s) }))
  const addStep = () => setForm(f => ({ ...f, steps: [...f.steps, ""] }))
  const removeStep = i => setForm(f => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))
  const setIng = (i, k, v) => setForm(f => ({ ...f, ingredients: f.ingredients.map((x, j) => {
    if (j !== i) return x
    if (k === "category") return { ...x, category: v, _catAuto: false }
    if (k === "name" && x._catAuto) {
      const inferred = inferCategory(v)
      return inferred ? { ...x, name: v, category: inferred } : { ...x, name: v }
    }
    return { ...x, [k]: v }
  }) }))
  const addIng = () => setForm(f => ({ ...f, ingredients: [...f.ingredients, blankIng()] }))
  const removeIng = i => setForm(f => ({ ...f, ingredients: f.ingredients.filter((_, j) => j !== i) }))

  // 写真：選んだら縮小してすぐアップロード
  // 写真を選んだら、まず範囲調整の画面を出す
  const [cropFile, setCropFile] = useState(null)
  const pickPhoto = e => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (file) { setPhotoError(""); setCropFile(file) }
  }
  const uploadPhoto = async picked => {
    const original = picked === cropFile
    setCropFile(null)
    setPhotoError(""); setUploading(true)
    try {
      // 範囲調整済みならそのまま、調整できなかった元ファイルは縮小してから
      const blob = original ? await compressImage(picked) : picked
      const path = await uploadRecipePhoto(userId, blob)
      uploadedPaths.current.push(path)
      set("photoPath", path)
    } catch (err) { setPhotoError(err.message || "アップロードに失敗しました") }
    setUploading(false)
  }
  // 保存されなかったアップロードを Storage から消す（元の写真は saveRecipe 側で処理）
  const cleanupUploads = keepPath => {
    uploadedPaths.current.filter(p => p !== keepPath).forEach(p => deleteRecipePhoto(p).catch(() => {}))
    uploadedPaths.current = []
  }
  const handleClose = () => { cleanupUploads(null); onClose() }
  const handleSave = () => {
    if (!form.name || uploading) return
    cleanupUploads(form.photoPath)
    const ingredients = form.ingredients.map(({ _catAuto, ...rest }) => rest)
    onSave(withTags({ ...form, ingredients, steps: form.steps.filter(s => s.trim()) }, form.tags || []))
  }
  const photoUrl = getRecipePhotoUrl(form.photoPath)

  // ── URL・文章から取り込み（レシピサイト・YouTube・貼り付け） ──
  const [importMode, setImportMode] = useState("url") // url | text
  const [importUrl, setImportUrl] = useState("")
  const [importText, setImportText] = useState("")
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null) // { type: "ok" | "warn" | "error", text }
  const runImport = async () => {
    const url = importMode === "url" ? importUrl.trim() : ""
    const text = importMode === "text" ? importText.trim() : ""
    if ((!url && !text) || importing) return
    const hasContent = form.name || form.ingredients.some(i => i.name) || form.steps.some(s => s.trim())
    if (hasContent && !window.confirm("入力中の料理名・材料・作り方を、取り込んだ内容で置き換えますか？")) return
    setImporting(true); setImportMsg(null)
    try {
      const res = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(text ? { text } : { url }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.recipe) throw new Error(data.error || `取り込みに失敗しました（${res.status}）`)
      const r = data.recipe
      const ingredients = r.ingredients.map(i => {
        const inferred = inferCategory(i.name)
        const isSeasoning = i.isSeasoning ?? inferred === "調味料"
        // 水は買い物リストに載せない
        const type = isSeasoning || /^(水|お湯|湯|熱湯|氷)$/.test(i.name) ? "調味料" : "通常食材"
        return { name: i.name, amount: i.amount, unit: i.unit, type, category: inferred || (type === "調味料" ? "調味料" : "冷凍食品・その他"), _catAuto: true }
      })
      setForm(f => ({
        ...f,
        name: r.name || f.name,
        url: r.url || url || f.url,
        memo: r.memo || f.memo,
        servings: r.servings || f.servings || 2,
        steps: r.steps.length ? r.steps : [""],
        ingredients: ingredients.length ? ingredients : [blankIng()],
      }))
      const counts = `材料${ingredients.length}件・手順${r.steps.length}件`
      if (data.warning) setImportMsg({ type: "warn", text: `${counts}を取り込みました。${data.warning}` })
      else setImportMsg({ type: "ok", text: !String(data.source || "").startsWith("ai")
        ? `✓ サイトのレシピ情報から取り込みました（${counts}）`
        : `✓ AIで読み取りました（${counts}）。分量と手順を確認してから保存してください` })
      if (text) setImportText(""); else setImportUrl("")
    } catch (e) {
      setImportMsg({ type: "error", text: e.message || "取り込みに失敗しました" })
    }
    setImporting(false)
  }
  const tabStyle = id => ({ flex: 1, border: "none", background: "none", padding: "10px 4px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: regTab === id ? "#2e5d4e" : "#8f9d94", borderBottom: regTab === id ? "2px solid #2e5d4e" : "2px solid transparent", transition: "all .15s" })
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="sheet">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontFamily: "'Zen Maru Gothic',sans-serif", fontSize: 18, fontWeight: 700 }}>{recipe ? "レシピを編集" : "レシピを追加"}</h3>
          <button className="btn btn-ghost" onClick={handleClose}>✕</button>
        </div>
        <div style={{ display: "flex", borderBottom: "1px solid #ebe7dc", marginBottom: 18 }}>
          <button style={tabStyle("basic")} onClick={() => setRegTab("basic")}>基本情報</button>
          <button style={tabStyle("steps")} onClick={() => setRegTab("steps")}>作り方</button>
          <button style={tabStyle("ingredients")} onClick={() => setRegTab("ingredients")}>材料</button>
        </div>
        {regTab === "basic" && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ background: "#fdf0e9", border: "1.5px solid #f3c3a8", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                <label style={{ fontSize: 11, color: "#b8542a", fontWeight: 700 }}>🔗 レシピを取り込む</label>
                <div style={{ display: "flex", gap: 4 }}>
                  {[{ id: "url", label: "URL" }, { id: "text", label: "文章から" }].map(m => (
                    <button key={m.id} className={`pill-btn ${importMode === m.id ? "active" : ""}`} style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => { setImportMode(m.id); setImportMsg(null) }} disabled={importing}>{m.label}</button>
                  ))}
                </div>
              </div>
              {importMode === "url" ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input placeholder="レシピサイト・YouTube の URL" value={importUrl} onChange={e => setImportUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && runImport()} disabled={importing} inputMode="url" autoCapitalize="none" autoCorrect="off" style={{ flex: 1, fontSize: 13, padding: "8px 10px", background: "#fff" }} />
                  <button className="btn btn-primary btn-sm" onClick={runImport} disabled={importing || !importUrl.trim()} style={{ whiteSpace: "nowrap" }}>{importing ? "読み取り中..." : "取り込む"}</button>
                </div>
              ) : (
                <>
                  <textarea rows={5} placeholder={"クックパッドのアプリなどでレシピをコピーして貼り付け\n（料理名・材料・作り方がまとめて入っていればOK）"} value={importText} onChange={e => setImportText(e.target.value)} disabled={importing} style={{ fontSize: 13, padding: "8px 10px", background: "#fff", resize: "vertical" }} />
                  <button className="btn btn-primary btn-sm" onClick={runImport} disabled={importing || !importText.trim()} style={{ width: "100%", marginTop: 8 }}>{importing ? "AIで読み取り中..." : "AIで取り込む"}</button>
                </>
              )}
              {importing && importMode === "url" && <div style={{ fontSize: 11, color: "#b8542a", marginTop: 6 }}>動画の場合は数十秒かかることがあります</div>}
              {!importing && !importMsg && (importMode === "url" ? (
                <details style={{ marginTop: 8, fontSize: 11, color: "#66776d", lineHeight: 1.7 }}>
                  <summary style={{ cursor: "pointer", color: "#b8542a", fontWeight: 700 }}>取り込めるサイト</summary>
                  <div style={{ marginTop: 4 }}>
                    <div><b>AIなしで取り込める</b>：{SUPPORTED_SITES.join("・")}</div>
                    <div><b>YouTube</b>：概要欄に材料と作り方が書かれている動画（リュウジさんなど）はAIなし。書かれていなければAIで読み取り</div>
                    <div><b>そのほかのサイト</b>：本文に「材料」「作り方」があればAIなし、なければAIで読み取り</div>
                    <div><b>クックパッド</b>：見えている部分だけ取り込み。全部取り込むときはアプリでコピーして「文章から」へ</div>
                  </div>
                </details>
              ) : (
                <div style={{ marginTop: 6, fontSize: 11, color: "#66776d", lineHeight: 1.6 }}>「材料」と「作り方」が書かれた文章ならAIなしで読み取ります（リュウジさんの概要欄・アプリのレシピなど）。形が崩れているときはAIで読み取ります。</div>
              ))}
              {importMsg && (importMsg.type === "error"
                ? <div className="error-msg">⚠️ {importMsg.text}</div>
                : <div style={{ fontSize: 12, color: importMsg.type === "warn" ? "#8a6000" : "#2e6b4f", background: importMsg.type === "warn" ? "#fff3d6" : "transparent", borderRadius: 8, padding: importMsg.type === "warn" ? "8px 10px" : 0, marginTop: 6, lineHeight: 1.6 }}>
                    {importMsg.type === "warn" ? "⚠️ " : ""}{importMsg.text}
                    {importMsg.type === "warn" && <button className="btn btn-outline btn-sm" style={{ display: "flex", marginTop: 6, fontSize: 11 }} onClick={() => { setImportMode("text"); setImportMsg(null) }}>「文章から」に切り替える</button>}
                  </div>)}
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#66776d", display: "block", marginBottom: 4, fontWeight: 700 }}>写真</label>
              <div className="photo-box" onClick={() => !uploading && fileInput.current?.click()} style={{ cursor: uploading ? "wait" : "pointer", ...(photoUrl ? { aspectRatio: "4 / 3", maxHeight: "none" } : { aspectRatio: "auto", height: 72, flexDirection: "row" }) }}>
                {photoUrl
                  ? <img src={photoUrl} alt="レシピ写真" />
                  : <><span style={{ fontSize: 24 }}>📷</span><span>タップして写真を追加</span></>}
                {uploading && <div style={{ position: "absolute", inset: 0, background: "rgba(251,249,244,.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}><div className="spinner" style={{ marginBottom: 8 }} /><span>アップロード中...</span></div>}
              </div>
              <input ref={fileInput} type="file" accept="image/*" onChange={pickPhoto} style={{ display: "none" }} />
              {cropFile && <PhotoCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={uploadPhoto} />}
              {form.photoPath && !uploading && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => fileInput.current?.click()}>📷 写真を変更</button>
                  <button className="btn btn-outline btn-sm" style={{ flex: 1, color: "#c0391b" }} onClick={() => set("photoPath", null)}>🗑 写真を外す</button>
                </div>
              )}
              {photoError && <div className="error-msg">⚠️ {photoError}</div>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "flex-end" }}>
              <div><label style={{ fontSize: 11, color: "#66776d", display: "block", marginBottom: 4, fontWeight: 700 }}>レシピ名 *</label><input placeholder="例: 肉じゃが" value={form.name} onChange={e => set("name", e.target.value)} /></div>
              <button onClick={() => set("favorite", !form.favorite)} style={{ background: "none", border: "1.5px solid #d3cfc2", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontSize: 22, color: "#ed7342" }}>{form.favorite ? "★" : "☆"}</button>
            </div>
            <TagPicker tagDefs={tagDefs} value={form.tags || []} onChange={tags => set("tags", tags)} onAddTag={onAddTag} />
            <div><label style={{ fontSize: 11, color: "#66776d", display: "block", marginBottom: 4, fontWeight: 700 }}>メモ・コツ</label><textarea rows={2} placeholder="調理のコツや気づきなど..." value={form.memo} onChange={e => set("memo", e.target.value)} style={{ resize: "vertical" }} /></div>
            <div><label style={{ fontSize: 11, color: "#66776d", display: "block", marginBottom: 4, fontWeight: 700 }}>参考URL（YouTube等）</label><input placeholder="https://..." value={form.url} onChange={e => set("url", e.target.value)} />{form.url && <a href={form.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#5a8aa0", display: "block", marginTop: 4 }}>🔗 URLを確認</a>}</div>
          </div>
        )}
        {regTab === "steps" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#66776d" }}>手順を1ステップずつ入力してね</div>
              <button className="btn btn-outline btn-sm" onClick={addStep}>＋ 追加</button>
            </div>
            {form.steps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
                <div className="step-num" style={{ flexShrink: 0, marginTop: 4 }}>{i + 1}</div>
                <textarea rows={2} placeholder={`手順 ${i + 1}...`} value={step} onChange={e => setStep(i, e.target.value)} style={{ flex: 1, resize: "vertical", fontSize: 13, padding: "8px 10px" }} />
                <button onClick={() => removeStep(i)} style={{ background: "none", border: "1.5px solid #dcd7ca", borderRadius: 8, cursor: "pointer", color: "#c0391b", width: 32, height: 32, fontSize: 14, flexShrink: 0, marginTop: 4 }}>×</button>
              </div>
            ))}
          </div>
        )}
        {regTab === "ingredients" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#66776d" }}>基本</div>
                <select value={form.servings || 2} onChange={e => set("servings", Number(e.target.value))} style={{ fontSize: 13, padding: "4px 8px", width: "auto" }}>
                  {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}人前</option>)}
                </select>
                <div style={{ fontSize: 12, color: "#66776d" }}>で入力</div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={addIng}>＋ 追加</button>
            </div>
            {form.ingredients.map((ing, i) => (
              <div key={i} style={{ background: "#f3f1ea", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 6, marginBottom: 6 }}>
                  <input placeholder="食材名" value={ing.name} onChange={e => setIng(i, "name", e.target.value)} style={{ fontSize: 13, padding: "7px 10px" }} />
                  <input placeholder="量" value={ing.amount} onChange={e => setIng(i, "amount", e.target.value)} style={{ fontSize: 13, padding: "7px 10px" }} />
                  <input placeholder="単位" value={ing.unit} onChange={e => setIng(i, "unit", e.target.value)} style={{ fontSize: 13, padding: "7px 10px" }} />
                  <button onClick={() => removeIng(i)} style={{ background: "none", border: "1.5px solid #dcd7ca", borderRadius: 8, cursor: "pointer", color: "#c0391b", width: 32, fontSize: 14 }}>×</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <select value={ing.type} onChange={e => setIng(i, "type", e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }}><option>通常食材</option><option>調味料</option></select>
                  <div style={{ position: "relative" }}>
                    <select value={ing.category} onChange={e => setIng(i, "category", e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }}>{STORE_ORDER.map(c => <option key={c}>{c}</option>)}</select>
                    {ing._catAuto && inferCategory(ing.name) && <span style={{ position: "absolute", top: -7, right: 6, fontSize: 9, fontWeight: 700, background: "#2e5d4e", color: "#fff", borderRadius: 6, padding: "1px 5px" }}>自動</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={handleClose}>キャンセル</button>
          <button className="btn btn-primary" style={{ flex: 2, padding: "13px" }} onClick={handleSave} disabled={uploading}>{uploading ? "アップロード中..." : "保存する"}</button>
        </div>
      </div>
    </div>
  )
}
