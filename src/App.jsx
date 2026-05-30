import { useState, useMemo, useCallback, useRef } from "react"
import { hashPassword, getUser, createUser, saveData } from "./supabase.js"

// ─────────────── 定数 ───────────────
const TAGS = ["主菜", "副菜", "お弁当"]
const STORE_ORDER = ["野菜・果物","肉・魚","卵・乳製品","加工食品・大豆製品","乾物・麺類・パスタ","調味料","冷凍食品・その他"]
const DAYS = ["月","火","水","木","金","土","日"]

const SAMPLE_RECIPES = [
  { id: 1, name: "肉じゃが", tag: "主菜", favorite: true, memo: "じゃがいもはほくほくになるまで煮る。牛肉は最初に炒めてから。", url: "",
    ingredients: [
      { name: "牛薄切り肉", amount: 150, unit: "g", type: "通常食材", category: "肉・魚" },
      { name: "じゃがいも", amount: 2, unit: "個", type: "通常食材", category: "野菜・果物" },
      { name: "玉ねぎ", amount: 1, unit: "個", type: "通常食材", category: "野菜・果物" },
      { name: "にんじん", amount: 0.5, unit: "本", type: "通常食材", category: "野菜・果物" },
      { name: "醤油", amount: 3, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "みりん", amount: 2, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "砂糖", amount: 1, unit: "大さじ", type: "調味料", category: "調味料" },
    ]},
  { id: 2, name: "鶏の唐揚げ", tag: "主菜", favorite: true, memo: "二度揚げでカリッと。下味は30分以上漬けると美味しい。", url: "",
    ingredients: [
      { name: "鶏もも肉", amount: 300, unit: "g", type: "通常食材", category: "肉・魚" },
      { name: "醤油", amount: 2, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "酒", amount: 1, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "にんにく", amount: 1, unit: "片", type: "通常食材", category: "野菜・果物" },
      { name: "片栗粉", amount: 4, unit: "大さじ", type: "調味料", category: "乾物・麺類・パスタ" },
    ]},
  { id: 3, name: "ほうれん草のおひたし", tag: "副菜", favorite: false, memo: "茹ですぎに注意。色鮮やかなうちに冷水に取る。", url: "",
    ingredients: [
      { name: "ほうれん草", amount: 1, unit: "袋", type: "通常食材", category: "野菜・果物" },
      { name: "醤油", amount: 1, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "かつお節", amount: 1, unit: "パック", type: "通常食材", category: "乾物・麺類・パスタ" },
    ]},
  { id: 4, name: "卵焼き", tag: "お弁当", favorite: true, memo: "甘めが好きなら砂糖多め。巻くときはしっかり火を通して。", url: "",
    ingredients: [
      { name: "卵", amount: 3, unit: "個", type: "通常食材", category: "卵・乳製品" },
      { name: "砂糖", amount: 1, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "醤油", amount: 0.5, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "みりん", amount: 0.5, unit: "大さじ", type: "調味料", category: "調味料" },
    ]},
  { id: 5, name: "豚汁", tag: "副菜", favorite: false, memo: "根菜は先に炒めると甘みが出る。味噌は火を止めてから。", url: "",
    ingredients: [
      { name: "豚こま肉", amount: 100, unit: "g", type: "通常食材", category: "肉・魚" },
      { name: "大根", amount: 100, unit: "g", type: "通常食材", category: "野菜・果物" },
      { name: "にんじん", amount: 0.5, unit: "本", type: "通常食材", category: "野菜・果物" },
      { name: "こんにゃく", amount: 0.5, unit: "枚", type: "通常食材", category: "加工食品・大豆製品" },
      { name: "味噌", amount: 2, unit: "大さじ", type: "調味料", category: "調味料" },
    ]},
]

// ─────────────── ユーティリティ ───────────────
function getWeekLabel() {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth() + 1
  const weekNum = Math.ceil(now.getDate() / 7)
  const d1 = new Date(now); d1.setDate(now.getDate() - now.getDay() + 1)
  const d2 = new Date(d1); d2.setDate(d1.getDate() + 6)
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}`
  return `${y}年${m}月第${weekNum}週（${fmt(d1)}〜${fmt(d2)}）`
}

function mergeIngredients(selections, recipes) {
  const map = {}
  selections.forEach(sel => {
    const recipe = recipes.find(r => r.id === sel.recipeId)
    if (!recipe) return
    recipe.ingredients.filter(i => i.type === "通常食材").forEach(ing => {
      if (!map[ing.name]) map[ing.name] = { ...ing, amount: 0 }
      map[ing.name].amount += ing.amount * sel.portion
    })
  })
  return Object.values(map)
}

// ─────────────── CSS ───────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@300;400;500;700;900&family=Zen+Old+Mincho:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#f8f5f0;}
::-webkit-scrollbar{width:4px;}
::-webkit-scrollbar-thumb{background:#d4c5b0;border-radius:2px;}
.screen{flex:1;overflow-y:auto;padding-bottom:88px;}
.card{background:#fff;border-radius:16px;box-shadow:0 1px 8px rgba(80,60,20,0.07);}
.btn{border:none;border-radius:10px;cursor:pointer;font-family:inherit;font-weight:500;transition:all .15s;display:inline-flex;align-items:center;justify-content:center;gap:6px;}
.btn-primary{background:#3d2b08;color:#fff;padding:11px 20px;font-size:14px;}
.btn-primary:hover{background:#2a1c04;}
.btn-primary:disabled{background:#a09080;cursor:not-allowed;}
.btn-outline{background:#fff;color:#3d2b08;border:1.5px solid #d4c5b0;padding:9px 16px;font-size:13px;}
.btn-outline:hover{background:#f5ede0;}
.btn-ghost{background:transparent;color:#8a7050;border:none;padding:6px 10px;font-size:13px;cursor:pointer;}
.btn-sm{padding:6px 12px;font-size:12px;border-radius:8px;}
.tag{display:inline-flex;align-items:center;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;letter-spacing:0.05em;}
.tag-主菜{background:#fde8e0;color:#c0391b;}
.tag-副菜{background:#e0f0e8;color:#1b7a3e;}
.tag-お弁当{background:#e8e4f8;color:#4a2fa0;}
input,select,textarea{font-family:inherit;border:1.5px solid #e0d4c0;border-radius:10px;padding:10px 13px;font-size:14px;width:100%;background:#fdfaf6;color:#1a1208;outline:none;transition:border .15s;}
input:focus,select:focus,textarea:focus{border-color:#3d2b08;box-shadow:0 0 0 3px rgba(61,43,8,0.07);}
.overlay{position:fixed;inset:0;background:rgba(26,18,8,.55);z-index:200;display:flex;align-items:flex-end;justify-content:center;}
.sheet{background:#fdfaf6;border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:92vh;overflow-y:auto;padding:24px 20px 40px;animation:slideUp .25s;}
@keyframes slideUp{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.pill-btn{border:1.5px solid #d4c5b0;border-radius:20px;background:#fff;color:#5a4020;padding:6px 14px;font-family:inherit;font-size:12px;cursor:pointer;transition:all .15s;font-weight:500;}
.pill-btn.active{background:#3d2b08;color:#fff;border-color:#3d2b08;}
.section-head{font-size:11px;font-weight:700;color:#b09070;letter-spacing:.1em;padding:0 4px;margin-bottom:6px;}
.item-row{display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid #f0e8d8;gap:10px;background:#fff;}
.item-row:last-child{border-bottom:none;}
.num-ctrl{display:inline-flex;align-items:center;gap:4px;}
.num-btn{width:28px;height:28px;border:1.5px solid #d4c5b0;border-radius:8px;background:#fff;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;color:#3d2b08;font-weight:700;}
.num-btn:hover{background:#f5ede0;}
.check-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #f0e8d8;cursor:pointer;}
.check-row:last-child{border-bottom:none;}
.custom-check{width:22px;height:22px;border:2px solid #d4c5b0;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
.custom-check.checked{background:#3d2b08;border-color:#3d2b08;color:#fff;}
.fav-btn{background:none;border:none;cursor:pointer;font-size:18px;padding:2px;line-height:1;}
.history-week{border-radius:12px;overflow:hidden;border:1.5px solid #e8dcc8;}
.empty-state{text-align:center;padding:60px 20px;color:#b09070;}
.portion-select{border:1.5px solid #d4c5b0;border-radius:8px;background:#fff;color:#3d2b08;padding:5px 8px;font-size:12px;font-family:inherit;cursor:pointer;}
.toast{position:fixed;top:68px;left:50%;transform:translateX(-50%);background:#3d2b08;color:#fff;border-radius:20px;padding:8px 20px;font-size:12px;z-index:400;animation:fadeIn .2s;white-space:nowrap;}
.toast.error{background:#c0391b;}
.error-msg{color:#c0391b;font-size:12px;margin-top:6px;padding:8px 12px;background:#fff0ee;border-radius:8px;}
.login-wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f8f5f0;padding:24px;}
.login-card{background:#fff;border-radius:20px;padding:36px 28px;width:100%;max-width:360px;box-shadow:0 4px 24px rgba(61,43,8,0.12);}
.tab-toggle{display:flex;border-radius:10px;background:#f0e8d8;padding:3px;gap:3px;margin-bottom:24px;}
.tab-toggle button{flex:1;border:none;border-radius:8px;padding:9px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;}
.tab-toggle button.active{background:#3d2b08;color:#fff;}
.tab-toggle button:not(.active){background:transparent;color:#8a7050;}
`

// ─────────────── ログイン画面 ───────────────
function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handle = async () => {
    setError("")
    if (!username.trim() || !password.trim()) { setError("ユーザー名とパスワードを入力してください"); return }
    if (username.trim().length < 2) { setError("ユーザー名は2文字以上で入力してください"); return }
    if (password.length < 4) { setError("パスワードは4文字以上で入力してください"); return }
    setLoading(true)
    try {
      const uid = username.trim().toLowerCase()
      const hash = await hashPassword(password)
      if (mode === "register") {
        const existing = await getUser(uid)
        if (existing) { setError("そのユーザー名は既に使われています"); setLoading(false); return }
        const initData = { recipes: SAMPLE_RECIPES, history: [], weeklySelections: [], seasoningChecks: {}, shoppingAdjust: {}, deletedItems: [] }
        await createUser(uid, hash, initData)
        onLogin(uid, initData)
      } else {
        const user = await getUser(uid)
        if (!user) { setError("ユーザー名が見つかりません"); setLoading(false); return }
        if (user.password_hash !== hash) { setError("パスワードが違います"); setLoading(false); return }
        onLogin(uid, user.data || { recipes: SAMPLE_RECIPES, history: [], weeklySelections: [], seasoningChecks: {}, shoppingAdjust: {}, deletedItems: [] })
      }
    } catch (e) {
      setError("エラーが発生しました: " + e.message)
    }
    setLoading(false)
  }

  return (
    <div className="login-wrap">
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🥢</div>
        <div style={{ fontFamily: "'Zen Old Mincho',serif", fontSize: 26, fontWeight: 700, color: "#3d2b08" }}>週献立ノート</div>
        <div style={{ fontSize: 11, color: "#b09070", marginTop: 4, letterSpacing: "0.12em" }}>WEEKLY MENU PLANNER</div>
      </div>
      <div className="login-card">
        <div className="tab-toggle">
          <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError("") }}>ログイン</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError("") }}>新規登録</button>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#8a7050", display: "block", marginBottom: 4 }}>ユーザー名</label>
            <input placeholder="例: hanako" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} autoCapitalize="none" autoCorrect="off" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#8a7050", display: "block", marginBottom: 4 }}>パスワード</label>
            <input type="password" placeholder="4文字以上" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} />
          </div>
          {error && <div className="error-msg">⚠️ {error}</div>}
          <button className="btn btn-primary" style={{ width: "100%", padding: "13px", marginTop: 4 }} onClick={handle} disabled={loading}>
            {loading ? "処理中..." : mode === "login" ? "ログイン" : "アカウントを作成"}
          </button>
        </div>
        {mode === "register" && (
          <div style={{ marginTop: 16, fontSize: 11, color: "#b09070", textAlign: "center", lineHeight: 1.7 }}>
            登録したアカウントで<br />スマホ・PCどこからでも使えます
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────── メインアプリ ───────────────
export default function App() {
  const [userId, setUserId] = useState(null)
  const [screen, setScreen] = useState("catalog")
  const [recipes, setRecipes] = useState([])
  const [history, setHistory] = useState([])
  const [weeklySelections, setWeeklySelections] = useState([])
  const [seasoningChecks, setSeasoningChecks] = useState({})
  const [shoppingAdjust, setShoppingAdjust] = useState({})
  const [deletedItems, setDeletedItems] = useState(new Set())
  const [filterTag, setFilterTag] = useState("すべて")
  const [filterFav, setFilterFav] = useState(false)
  const [editRecipe, setEditRecipe] = useState(null)
  const [showRegister, setShowRegister] = useState(false)
  const [expandedHistory, setExpandedHistory] = useState(null)
  const [toast, setToast] = useState(null)
  const saveTimer = useRef(null)

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2200)
  }

  const handleLogin = (uid, data) => {
    setUserId(uid)
    setRecipes(data.recipes || SAMPLE_RECIPES)
    setHistory(data.history || [])
    setWeeklySelections(data.weeklySelections || [])
    setSeasoningChecks(data.seasoningChecks || {})
    setShoppingAdjust(data.shoppingAdjust || {})
    setDeletedItems(new Set(data.deletedItems || []))
    setScreen("catalog")
  }

  const triggerSave = useCallback((newData) => {
    if (!userId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await saveData(userId, newData)
        showToast("保存しました ✓")
      } catch (e) {
        showToast("保存失敗: " + e.message, "error")
      }
    }, 1500)
  }, [userId])

  const buildSave = useCallback((overrides = {}) => ({
    recipes, history, weeklySelections, seasoningChecks,
    shoppingAdjust, deletedItems: [...deletedItems], ...overrides,
  }), [recipes, history, weeklySelections, seasoningChecks, shoppingAdjust, deletedItems])

  // ── レシピ操作 ──
  const toggleFavorite = id => {
    const next = recipes.map(r => r.id === id ? { ...r, favorite: !r.favorite } : r)
    setRecipes(next); triggerSave(buildSave({ recipes: next }))
  }
  const saveRecipe = recipe => {
    const next = recipe.id ? recipes.map(r => r.id === recipe.id ? recipe : r) : [...recipes, { ...recipe, id: Date.now() }]
    setRecipes(next); triggerSave(buildSave({ recipes: next }))
    setShowRegister(false); setEditRecipe(null)
  }
  const deleteRecipe = id => {
    const nextR = recipes.filter(r => r.id !== id)
    const nextW = weeklySelections.filter(s => s.recipeId !== id)
    setRecipes(nextR); setWeeklySelections(nextW)
    triggerSave(buildSave({ recipes: nextR, weeklySelections: nextW }))
  }

  // ── 今週メニュー ──
  const toggleWeeklyMenu = (day, recipeId) => {
    const exists = weeklySelections.find(s => s.day === day && s.recipeId === recipeId)
    const next = exists
      ? weeklySelections.filter(s => !(s.day === day && s.recipeId === recipeId))
      : [...weeklySelections, { day, recipeId, portion: 1 }]
    setWeeklySelections(next); triggerSave(buildSave({ weeklySelections: next }))
  }
  const setWeeklyPortion = (day, recipeId, portion) => {
    const next = weeklySelections.map(s => s.day === day && s.recipeId === recipeId ? { ...s, portion } : s)
    setWeeklySelections(next); triggerSave(buildSave({ weeklySelections: next }))
  }

  // ── 調味料 ──
  const toggleSeasoningCheck = name => {
    const next = { ...seasoningChecks, [name]: !seasoningChecks[name] }
    setSeasoningChecks(next); triggerSave(buildSave({ seasoningChecks: next }))
  }

  // ── 買い物 ──
  const weeklySeasonings = useMemo(() => {
    const map = {}
    weeklySelections.forEach(sel => {
      const r = recipes.find(r => r.id === sel.recipeId)
      if (!r) return
      r.ingredients.filter(i => i.type === "調味料").forEach(ing => { map[ing.name] = ing })
    })
    return Object.values(map)
  }, [weeklySelections, recipes])

  const baseShoppingList = useMemo(() => {
    const merged = mergeIngredients(weeklySelections, recipes)
    const seasonings = weeklySeasonings.filter(s => seasoningChecks[s.name]).map(s => ({ ...s, amount: "適量", isSeasoning: true }))
    return [...merged, ...seasonings]
  }, [weeklySelections, recipes, seasoningChecks, weeklySeasonings])

  const shoppingList = useMemo(() => baseShoppingList
    .filter(i => !deletedItems.has(i.name))
    .map(i => ({ ...i, displayAmount: shoppingAdjust[i.name] !== undefined ? shoppingAdjust[i.name] : i.amount }))
    .sort((a, b) => {
      const ai = STORE_ORDER.indexOf(a.category), bi = STORE_ORDER.indexOf(b.category)
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    }), [baseShoppingList, shoppingAdjust, deletedItems])

  const adjustShopping = (name, delta, unit) => {
    const step = ["個","本","袋","枚","パック","片","束"].includes(unit) ? 1 : 10
    const cur = shoppingAdjust[name] !== undefined ? shoppingAdjust[name] : (baseShoppingList.find(i => i.name === name)?.amount || 0)
    const next = { ...shoppingAdjust, [name]: Math.max(0, cur + delta * step) }
    setShoppingAdjust(next); triggerSave(buildSave({ shoppingAdjust: next }))
  }
  const removeShoppingItem = name => {
    const next = new Set([...deletedItems, name])
    setDeletedItems(next); triggerSave(buildSave({ deletedItems: [...next] }))
  }

  // ── 今週確定 ──
  const confirmWeek = () => {
    const menus = weeklySelections
      .map(s => { const r = recipes.find(r => r.id === s.recipeId); return { day: s.day, name: r ? r.name : "不明", portion: s.portion } })
      .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day))
    const newHistory = [{ id: Date.now(), weekLabel: getWeekLabel(), menus }, ...history]
    setHistory(newHistory)
    setWeeklySelections([]); setSeasoningChecks({}); setShoppingAdjust({}); setDeletedItems(new Set())
    triggerSave(buildSave({ history: newHistory, weeklySelections: [], seasoningChecks: {}, shoppingAdjust: {}, deletedItems: [] }))
    setScreen("history")
  }

  const logout = () => {
    setUserId(null); setRecipes([]); setHistory([])
    setWeeklySelections([]); setSeasoningChecks({}); setShoppingAdjust({}); setDeletedItems(new Set())
  }

  if (!userId) return (<><style>{CSS}</style><LoginScreen onLogin={handleLogin} /></>)

  const navItems = [
    { id: "catalog", icon: "📋", label: "カタログ" },
    { id: "weekly",  icon: "📅", label: "今週" },
    { id: "seasoning", icon: "🧂", label: "調味料" },
    { id: "shopping", icon: "🛒", label: "買い物" },
    { id: "history", icon: "📖", label: "履歴" },
  ]

  return (
    <div style={{ minHeight: "100vh", background: "#f8f5f0", fontFamily: "'Zen Kaku Gothic New','Hiragino Kaku Gothic ProN',sans-serif", color: "#1a1208", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto", position: "relative" }}>
      <style>{CSS}</style>
      {toast && <div className={`toast ${toast.type === "error" ? "error" : ""}`}>{toast.msg}</div>}

      <header style={{ background: "#3d2b08", color: "#f8f0e4", padding: "13px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, position: "sticky", top: 0, zIndex: 50 }}>
        <span style={{ fontSize: 20 }}>🥢</span>
        <div>
          <div style={{ fontFamily: "'Zen Old Mincho',serif", fontSize: 17, fontWeight: 700, letterSpacing: "0.1em" }}>週献立ノート</div>
          <div style={{ fontSize: 9, color: "#c9b090", letterSpacing: "0.15em" }}>WEEKLY MENU PLANNER</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "#c9b090" }}>👤 {userId}</span>
          {screen === "catalog" && (
            <button className="btn btn-outline btn-sm" style={{ background: "transparent", color: "#f8f0e4", borderColor: "#6a5030" }}
              onClick={() => { setEditRecipe(null); setShowRegister(true) }}>＋ 追加</button>
          )}
          <button className="btn btn-ghost btn-sm" style={{ color: "#c9b090", fontSize: 11 }} onClick={logout}>ログアウト</button>
        </div>
      </header>

      <div className="screen" style={{ flex: 1 }}>

        {/* カタログ */}
        {screen === "catalog" && (
          <div style={{ padding: "16px 16px 0" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <button className={`pill-btn ${filterFav ? "active" : ""}`} onClick={() => setFilterFav(f => !f)}>★ お気に入り</button>
              {["すべて", ...TAGS].map(t => (
                <button key={t} className={`pill-btn ${filterTag === t ? "active" : ""}`} onClick={() => setFilterTag(t)}>{t}</button>
              ))}
            </div>
            {(() => {
              const filtered = recipes.filter(r => (!filterFav || r.favorite) && (filterTag === "すべて" || r.tag === filterTag))
              if (!filtered.length) return (
                <div className="empty-state">
                  <div style={{ fontSize: 44, marginBottom: 12 }}>🍽️</div>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>レシピがありません</div>
                  <div style={{ fontSize: 12 }}>右上の「＋追加」から登録してね</div>
                </div>
              )
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {filtered.map(r => (
                    <div key={r.id} style={{ background: "#fff", borderRadius: 12, padding: "13px 14px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 6px rgba(80,60,20,0.06)" }}>
                      <button className="fav-btn" onClick={() => toggleFavorite(r.id)}>{r.favorite ? "★" : "☆"}</button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: r.memo ? 3 : 0 }}>
                          <span style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</span>
                          <span className={`tag tag-${r.tag}`}>{r.tag}</span>
                        </div>
                        {r.memo && <div style={{ fontSize: 11, color: "#a08870", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.memo}</div>}
                        {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#7a9fc0" }}>🔗 参考URL</a>}
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditRecipe(r); setShowRegister(true) }}>編集</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: "#c0391b" }} onClick={() => deleteRecipe(r.id)}>削除</button>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {/* 今週のメニュー */}
        {screen === "weekly" && (
          <div style={{ padding: "16px 16px 0" }}>
            <div style={{ marginBottom: 14, fontSize: 13, color: "#8a7050" }}>曜日ごとにメニューを選んで分量を設定してね</div>
            {DAYS.map(day => {
              const daySel = weeklySelections.filter(s => s.day === day)
              return (
                <div key={day} style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#3d2b08", marginBottom: 5, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ background: "#3d2b08", color: "#fff", borderRadius: "50%", width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{day}</span>
                    <span>曜日</span>
                  </div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {!daySel.length && <div style={{ padding: "9px 16px", color: "#c0a880", fontSize: 13 }}>未選択</div>}
                    {daySel.map(sel => {
                      const r = recipes.find(r => r.id === sel.recipeId)
                      if (!r) return null
                      return (
                        <div key={sel.recipeId} className="item-row">
                          <span className={`tag tag-${r.tag}`}>{r.tag}</span>
                          <span style={{ flex: 1, fontWeight: 500, fontSize: 14 }}>{r.name}</span>
                          <select className="portion-select" value={sel.portion} onChange={e => setWeeklyPortion(day, sel.recipeId, Number(e.target.value))}>
                            <option value={1}>1日分（2人前）</option>
                            <option value={2}>2日分（4人前）</option>
                            <option value={3}>3日分（6人前）</option>
                          </select>
                          <button className="btn btn-ghost btn-sm" style={{ color: "#c0391b", padding: "4px 8px" }} onClick={() => toggleWeeklyMenu(day, sel.recipeId)}>✕</button>
                        </div>
                      )
                    })}
                    <div style={{ padding: "7px 12px", borderTop: daySel.length ? "1px solid #f0e8d8" : "none" }}>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {recipes.filter(r => !daySel.find(s => s.recipeId === r.id)).map(r => (
                          <button key={r.id} className="pill-btn" style={{ fontSize: 11, padding: "4px 10px" }} onClick={() => toggleWeeklyMenu(day, r.id)}>＋ {r.name}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {weeklySelections.length > 0 && (
              <button className="btn btn-primary" style={{ width: "100%", padding: "13px", marginTop: 12 }} onClick={() => setScreen("seasoning")}>
                調味料チェックへ進む →
              </button>
            )}
          </div>
        )}

        {/* 調味料チェック */}
        {screen === "seasoning" && (
          <div style={{ padding: "16px 16px 0" }}>
            <div style={{ marginBottom: 14, fontSize: 13, color: "#8a7050" }}>今週のメニューで使う調味料です。<br />家にない・買い足したいものにチェックを入れてね ✓</div>
            <div className="card" style={{ overflow: "hidden", marginBottom: 16 }}>
              {!weeklySeasonings.length && <div style={{ padding: "20px", color: "#c0a880", fontSize: 13, textAlign: "center" }}>今週のメニューを選択してください</div>}
              {weeklySeasonings.map(s => (
                <div key={s.name} className="check-row" onClick={() => toggleSeasoningCheck(s.name)}>
                  <div className={`custom-check ${seasoningChecks[s.name] ? "checked" : ""}`}>{seasoningChecks[s.name] ? "✓" : ""}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "#a08870" }}>{s.category}</div>
                  </div>
                  {seasoningChecks[s.name] && <span style={{ fontSize: 11, color: "#c0391b", fontWeight: 700 }}>買い物リストへ追加</span>}
                </div>
              ))}
            </div>
            <button className="btn btn-primary" style={{ width: "100%", padding: "13px" }} onClick={() => setScreen("shopping")}>
              買い物リストを見る →
            </button>
          </div>
        )}

        {/* 買い物リスト */}
        {screen === "shopping" && (
          <div style={{ padding: "16px 16px 0" }}>
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, color: "#8a7050" }}>＋−で数量を微調整できます</div>
              {weeklySelections.length > 0 && (
                <button className="btn btn-primary btn-sm" style={{ fontSize: 12, padding: "8px 14px" }} onClick={confirmWeek}>今週を確定して保存</button>
              )}
            </div>
            {!shoppingList.length && <div className="empty-state"><div style={{ fontSize: 44, marginBottom: 12 }}>🛒</div><div>メニューを選択してください</div></div>}
            {STORE_ORDER.map(cat => {
              const items = shoppingList.filter(i => i.category === cat)
              if (!items.length) return null
              return (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div className="section-head">{cat}</div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {items.map(item => (
                      <div key={item.name} className="item-row">
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500, fontSize: 14 }}>{item.name}</div>
                          {item.isSeasoning && <span style={{ fontSize: 10, color: "#a08870" }}>調味料（買い足し）</span>}
                        </div>
                        {!item.isSeasoning ? (
                          <div className="num-ctrl">
                            <button className="num-btn" onClick={() => adjustShopping(item.name, -1, item.unit)}>−</button>
                            <span style={{ minWidth: 54, textAlign: "center", fontSize: 14, fontWeight: 700 }}>{item.displayAmount}{item.unit}</span>
                            <button className="num-btn" onClick={() => adjustShopping(item.name, 1, item.unit)}>＋</button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 13, color: "#8a7050" }}>適量</span>
                        )}
                        <button className="btn btn-ghost btn-sm" style={{ color: "#c0391b", padding: "4px 8px" }} onClick={() => removeShoppingItem(item.name)}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 履歴 */}
        {screen === "history" && (
          <div style={{ padding: "16px 16px 0" }}>
            {!history.length && <div className="empty-state"><div style={{ fontSize: 44, marginBottom: 12 }}>📖</div><div>まだ履歴がありません</div></div>}
            {history.map(week => (
              <div key={week.id} className="history-week" style={{ marginBottom: 14, background: "#fff" }}>
                <div style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: expandedHistory === week.id ? "#faf3e8" : "#fff" }}
                  onClick={() => setExpandedHistory(expandedHistory === week.id ? null : week.id)}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{week.weekLabel}</div>
                    <div style={{ fontSize: 11, color: "#a08870", marginTop: 2 }}>{week.menus.length}メニュー</div>
                  </div>
                  <span style={{ color: "#8a7050" }}>{expandedHistory === week.id ? "▲" : "▼"}</span>
                </div>
                {expandedHistory === week.id && (
                  <div style={{ borderTop: "1px solid #f0e8d8" }}>
                    {week.menus.map((m, i) => (
                      <div key={i} className="item-row">
                        <span style={{ background: "#3d2b08", color: "#fff", borderRadius: "50%", width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>{m.day}</span>
                        <span style={{ flex: 1, fontSize: 14 }}>{m.name}</span>
                        <span style={{ fontSize: 11, color: "#a08870" }}>{m.portion === 1 ? "1日分" : `${m.portion}日分`}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ボトムナビ */}
      <nav style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#fff", borderTop: "1px solid #e8dcc8", display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {navItems.map(n => (
          <button key={n.id} onClick={() => setScreen(n.id)} style={{ flex: 1, border: "none", background: "none", cursor: "pointer", padding: "10px 4px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontFamily: "inherit", color: screen === n.id ? "#3d2b08" : "#b09070", transition: "color .15s" }}>
            <span style={{ fontSize: 20 }}>{n.icon}</span>
            <span style={{ fontSize: 10, fontWeight: screen === n.id ? 700 : 400 }}>{n.label}</span>
            {screen === n.id && <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#3d2b08" }} />}
          </button>
        ))}
      </nav>

      {showRegister && <RegisterSheet recipe={editRecipe} onSave={saveRecipe} onClose={() => { setShowRegister(false); setEditRecipe(null) }} />}
    </div>
  )
}

// ─────────────── レシピ登録シート ───────────────
function RegisterSheet({ recipe, onSave, onClose }) {
  const blank = { name: "", tag: "主菜", favorite: false, memo: "", url: "", ingredients: [{ name: "", amount: "", unit: "g", type: "通常食材", category: "野菜・果物" }] }
  const [form, setForm] = useState(recipe ? JSON.parse(JSON.stringify(recipe)) : blank)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setIng = (i, k, v) => setForm(f => ({ ...f, ingredients: f.ingredients.map((x, j) => j === i ? { ...x, [k]: v } : x) }))
  const addIng = () => setForm(f => ({ ...f, ingredients: [...f.ingredients, { name: "", amount: "", unit: "g", type: "通常食材", category: "野菜・果物" }] }))
  const removeIng = i => setForm(f => ({ ...f, ingredients: f.ingredients.filter((_, j) => j !== i) }))

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontFamily: "'Zen Old Mincho',serif", fontSize: 18, fontWeight: 700 }}>{recipe ? "レシピを編集" : "レシピを追加"}</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: 11, color: "#8a7050", display: "block", marginBottom: 4, fontWeight: 700 }}>レシピ名 *</label>
              <input placeholder="例: 肉じゃが" value={form.name} onChange={e => set("name", e.target.value)} />
            </div>
            <button onClick={() => set("favorite", !form.favorite)} style={{ background: "none", border: "1.5px solid #d4c5b0", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontSize: 22 }}>
              {form.favorite ? "★" : "☆"}
            </button>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#8a7050", display: "block", marginBottom: 4, fontWeight: 700 }}>分類タグ</label>
            <div style={{ display: "flex", gap: 8 }}>
              {TAGS.map(t => <button key={t} className={`pill-btn ${form.tag === t ? "active" : ""}`} onClick={() => set("tag", t)}>{t}</button>)}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#8a7050", display: "block", marginBottom: 4, fontWeight: 700 }}>作り方メモ</label>
            <textarea rows={2} placeholder="コツや手順など..." value={form.memo} onChange={e => set("memo", e.target.value)} style={{ resize: "vertical" }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#8a7050", display: "block", marginBottom: 4, fontWeight: 700 }}>参考URL（YouTube等）</label>
            <input placeholder="https://..." value={form.url} onChange={e => set("url", e.target.value)} />
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: "#8a7050", fontWeight: 700 }}>材料（基本2人前）</label>
              <button className="btn btn-outline btn-sm" onClick={addIng}>＋ 追加</button>
            </div>
            {form.ingredients.map((ing, i) => (
              <div key={i} style={{ background: "#faf5ee", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 6, marginBottom: 6 }}>
                  <input placeholder="食材名" value={ing.name} onChange={e => setIng(i, "name", e.target.value)} style={{ fontSize: 13, padding: "7px 10px" }} />
                  <input placeholder="量" value={ing.amount} onChange={e => setIng(i, "amount", e.target.value)} style={{ fontSize: 13, padding: "7px 10px" }} />
                  <input placeholder="単位" value={ing.unit} onChange={e => setIng(i, "unit", e.target.value)} style={{ fontSize: 13, padding: "7px 10px" }} />
                  <button onClick={() => removeIng(i)} style={{ background: "none", border: "1.5px solid #e0d0c0", borderRadius: 8, cursor: "pointer", color: "#c0391b", width: 32, fontSize: 14 }}>×</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <select value={ing.type} onChange={e => setIng(i, "type", e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }}>
                    <option>通常食材</option><option>調味料</option>
                  </select>
                  <select value={ing.category} onChange={e => setIng(i, "category", e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }}>
                    {STORE_ORDER.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>キャンセル</button>
          <button className="btn btn-primary" style={{ flex: 2, padding: "13px" }} onClick={() => form.name && onSave(form)}>保存する</button>
        </div>
      </div>
    </div>
  )
}
