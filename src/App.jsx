import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { hashPassword, getUser, createUser, saveData } from "./supabase.js"
import { extractRecipeFromUrl, extractRecipeFromText, mergeIngredientsAdvanced, normalizeName, normalizeUnit } from "./gemini.js"

const TAGS = ["主菜", "副菜", "お弁当"]
const STORE_ORDER = ["野菜・果物","肉・魚","卵・乳製品","加工食品・大豆製品","乾物・麺類・パスタ","調味料","冷凍食品・その他"]

const SAMPLE_RECIPES = [
  { id: 1, name: "肉じゃが", tag: "主菜", favorite: true,
    memo: "じゃがいもはほくほくになるまで煮る。牛肉は最初に炒めてから。",
    url: "https://www.youtube.com/results?search_query=肉じゃが+レシピ",
    steps: ["牛肉を一口大に切り、サラダ油で炒める。","じゃがいも・玉ねぎ・にんじんを加えてさらに炒める。","水200mlと砂糖・醤油・みりんを加え、落し蓋をして中火で15分煮る。","じゃがいもに箸が通ったら完成。"],
    ingredients: [
      { name: "牛薄切り肉", amount: 150, unit: "g", type: "通常食材", category: "肉・魚" },
      { name: "じゃがいも", amount: 2, unit: "個", type: "通常食材", category: "野菜・果物" },
      { name: "玉ねぎ", amount: 1, unit: "個", type: "通常食材", category: "野菜・果物" },
      { name: "にんじん", amount: 0.5, unit: "本", type: "通常食材", category: "野菜・果物" },
      { name: "醤油", amount: 3, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "みりん", amount: 2, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "砂糖", amount: 1, unit: "大さじ", type: "調味料", category: "調味料" },
    ]},
  { id: 2, name: "鶏の唐揚げ", tag: "主菜", favorite: true,
    memo: "二度揚げでカリッと。下味は30分以上漬けると美味しい。",
    url: "https://www.youtube.com/results?search_query=唐揚げ+レシピ",
    steps: ["鶏もも肉を一口大に切り、醤油・酒・すりおろしにんにくで30分漬ける。","片栗粉をまぶして170℃の油で4分揚げ、一度取り出す。","油を190℃に上げて再度1分揚げる。","油を切って完成。"],
    ingredients: [
      { name: "鶏もも肉", amount: 300, unit: "g", type: "通常食材", category: "肉・魚" },
      { name: "醤油", amount: 2, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "酒", amount: 1, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "にんにく", amount: 1, unit: "片", type: "通常食材", category: "野菜・果物" },
      { name: "片栗粉", amount: 4, unit: "大さじ", type: "調味料", category: "乾物・麺類・パスタ" },
    ]},
  { id: 3, name: "ほうれん草のおひたし", tag: "副菜", favorite: false, memo: "茹ですぎに注意。", url: "",
    steps: ["ほうれん草を塩少々入れた熱湯で1〜2分茹でる。","冷水にとって絞り、3〜4cmに切る。","醤油をかけてかつお節をのせる。"],
    ingredients: [
      { name: "ほうれん草", amount: 1, unit: "袋", type: "通常食材", category: "野菜・果物" },
      { name: "醤油", amount: 1, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "かつお節", amount: 1, unit: "パック", type: "通常食材", category: "乾物・麺類・パスタ" },
    ]},
  { id: 4, name: "卵焼き", tag: "お弁当", favorite: true, memo: "甘めが好きなら砂糖多め。", url: "",
    steps: ["卵3個を割りほぐし、砂糖・醤油・みりんを加えてよく混ぜる。","卵焼き器に油を引き、卵液の1/3を流し入れて半熟になったら手前に巻く。","残りの卵液を2回に分けて同様に巻く。","巻き簾で形を整えて冷ます。"],
    ingredients: [
      { name: "卵", amount: 3, unit: "個", type: "通常食材", category: "卵・乳製品" },
      { name: "砂糖", amount: 1, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "醤油", amount: 0.5, unit: "大さじ", type: "調味料", category: "調味料" },
      { name: "みりん", amount: 0.5, unit: "大さじ", type: "調味料", category: "調味料" },
    ]},
  { id: 5, name: "豚汁", tag: "副菜", favorite: false, memo: "味噌は火を止めてから。", url: "",
    steps: ["豚こま肉・大根・にんじん・こんにゃくを一口大に切る。","鍋にごま油を引いて豚肉を炒め、根菜を加えてさらに炒める。","水600mlを加えて沸騰したらアクを取り、中火で10分煮る。","火を止めてから味噌を溶き入れて完成。"],
    ingredients: [
      { name: "豚こま肉", amount: 100, unit: "g", type: "通常食材", category: "肉・魚" },
      { name: "大根", amount: 100, unit: "g", type: "通常食材", category: "野菜・果物" },
      { name: "にんじん", amount: 0.5, unit: "本", type: "通常食材", category: "野菜・果物" },
      { name: "こんにゃく", amount: 0.5, unit: "枚", type: "通常食材", category: "加工食品・大豆製品" },
      { name: "味噌", amount: 2, unit: "大さじ", type: "調味料", category: "調味料" },
    ]},
]

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
  return `${first.getFullYear()}年${first.getMonth()+1}月${fmt(first)}〜${fmt(last)}`
}

function mergeSeasonings(selections, recipes) {
  const map = {}
  selections.forEach(sel => {
    const r = recipes.find(r => r.id === sel.recipeId)
    if (!r) return
    r.ingredients.filter(i => i.type === "調味料").forEach(ing => {
      const key = ing.name
      if (!map[key]) map[key] = { ...ing, totalAmount: 0, recipes: [] }
      map[key].totalAmount += (Number(ing.amount) || 0) * sel.portion
      if (!map[key].recipes.includes(r.name)) map[key].recipes.push(r.name)
    })
  })
  return Object.values(map)
}

const LS_KEY = "kondate_uid"
function getSavedUid() { try { return localStorage.getItem(LS_KEY) || null } catch { return null } }
function saveUid(uid) { try { localStorage.setItem(LS_KEY, uid) } catch {} }
function clearUid() { try { localStorage.removeItem(LS_KEY) } catch {} }

// ── CSS ──
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
.btn-icon{background:none;border:none;cursor:pointer;padding:4px 8px;font-size:16px;color:#8a7050;border-radius:6px;}
.btn-icon:hover{background:#f0e8d8;}
.tag{display:inline-flex;align-items:center;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;letter-spacing:0.05em;}
.tag-主菜{background:#fde8e0;color:#c0391b;}
.tag-副菜{background:#e0f0e8;color:#1b7a3e;}
.tag-お弁当{background:#e8e4f8;color:#4a2fa0;}
input,select,textarea{font-family:inherit;border:1.5px solid #e0d4c0;border-radius:10px;padding:10px 13px;font-size:14px;width:100%;background:#fdfaf6;color:#1a1208;outline:none;transition:border .15s;}
input:focus,select:focus,textarea:focus{border-color:#3d2b08;box-shadow:0 0 0 3px rgba(61,43,8,0.07);}
input[type=date]{cursor:pointer;}
.overlay{position:fixed;inset:0;background:rgba(26,18,8,.55);z-index:200;display:flex;align-items:flex-end;justify-content:center;}
.sheet{background:#fdfaf6;border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:92vh;overflow-y:auto;padding:24px 20px 40px;animation:slideUp .25s;}
.detail-sheet{background:#fdfaf6;border-radius:20px 20px 0 0;width:100%;max-width:480px;height:88vh;overflow-y:auto;animation:slideUp .25s;}
@keyframes slideUp{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
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
.toast{position:fixed;top:68px;left:50%;transform:translateX(-50%);background:#3d2b08;color:#fff;border-radius:20px;padding:8px 20px;font-size:12px;z-index:400;animation:fadeIn .2s;white-space:nowrap;pointer-events:none;}
.toast.error{background:#c0391b;}
.error-msg{color:#c0391b;font-size:12px;margin-top:6px;padding:8px 12px;background:#fff0ee;border-radius:8px;}
.login-wrap{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f8f5f0;padding:24px;}
.login-card{background:#fff;border-radius:20px;padding:36px 28px;width:100%;max-width:360px;box-shadow:0 4px 24px rgba(61,43,8,0.12);}
.tab-toggle{display:flex;border-radius:10px;background:#f0e8d8;padding:3px;gap:3px;margin-bottom:24px;}
.tab-toggle button{flex:1;border:none;border-radius:8px;padding:9px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;}
.tab-toggle button.active{background:#3d2b08;color:#fff;}
.tab-toggle button:not(.active){background:transparent;color:#8a7050;}
.step-row{display:flex;gap:12px;margin-bottom:14px;align-items:flex-start;}
.step-num{width:28px;height:28px;border-radius:50%;background:#3d2b08;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;}
.step-text{flex:1;line-height:1.7;font-size:14px;color:#2c1e08;}
.ing-chip{display:inline-flex;align-items:center;background:#faf3e8;border:1px solid #e8d8c0;border-radius:8px;padding:6px 12px;font-size:13px;gap:6px;}
.ing-amount{font-weight:700;color:#3d2b08;}
.detail-header{background:#3d2b08;color:#f8f0e4;padding:16px 20px 20px;}
.url-btn{display:flex;align-items:center;gap:8px;background:#fff7ed;border:1.5px solid #e8c87a;border-radius:12px;padding:12px 16px;color:#8a6010;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;width:100%;text-decoration:none;}
.url-btn:hover{background:#fff0d0;}
.spinner{width:36px;height:36px;border:3px solid #e8dcc8;border-top-color:#3d2b08;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px;}
.spinner-sm{width:18px;height:18px;border:2px solid #e8dcc8;border-top-color:#3d2b08;border-radius:50%;animation:spin .8s linear infinite;display:inline-block;}
.date-entry{background:#fff;border-radius:12px;border:1.5px solid #e8dcc8;margin-bottom:8px;overflow:hidden;}
.date-entry-header{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#fdfaf6;border-bottom:1px solid #f0e8d8;}
.skip-badge{background:#f0e8d8;color:#8a7050;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;}
.ai-badge{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;}
`

// ── ログイン画面 ──
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
      const uid = username.trim().toLowerCase(), hash = await hashPassword(password)
      if (mode === "register") {
        const existing = await getUser(uid)
        if (existing) { setError("そのユーザー名は既に使われています"); setLoading(false); return }
        const initData = { recipes: SAMPLE_RECIPES, planEntries: [], seasoningChecks: {}, shoppingAdjust: {}, deletedItems: [], history: [] }
        await createUser(uid, hash, initData); saveUid(uid); onLogin(uid, initData)
      } else {
        const user = await getUser(uid)
        if (!user) { setError("ユーザー名が見つかりません"); setLoading(false); return }
        if (user.password_hash !== hash) { setError("パスワードが違います"); setLoading(false); return }
        saveUid(uid)
        onLogin(uid, user.data || { recipes: SAMPLE_RECIPES, planEntries: [], seasoningChecks: {}, shoppingAdjust: {}, deletedItems: [], history: [] })
      }
    } catch (e) { setError("エラーが発生しました: " + e.message) }
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
          <div><label style={{ fontSize: 11, fontWeight: 700, color: "#8a7050", display: "block", marginBottom: 4 }}>ユーザー名</label><input placeholder="例: hanako" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} autoCapitalize="none" autoCorrect="off" /></div>
          <div><label style={{ fontSize: 11, fontWeight: 700, color: "#8a7050", display: "block", marginBottom: 4 }}>パスワード</label><input type="password" placeholder="4文字以上" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} /></div>
          {error && <div className="error-msg">⚠️ {error}</div>}
          <button className="btn btn-primary" style={{ width: "100%", padding: "13px", marginTop: 4 }} onClick={handle} disabled={loading}>{loading ? "処理中..." : mode === "login" ? "ログイン" : "アカウントを作成"}</button>
        </div>
        {mode === "register" && <div style={{ marginTop: 16, fontSize: 11, color: "#b09070", textAlign: "center", lineHeight: 1.7 }}>登録したアカウントで<br />スマホ・PCどこからでも使えます</div>}
      </div>
    </div>
  )
}

// ── レシピ詳細シート ──
function RecipeDetailSheet({ recipe, onClose, onEdit }) {
  const [activeTab, setActiveTab] = useState("steps")
  if (!recipe) return null
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="detail-sheet">
        <div className="detail-header">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8, color: "#f8f0e4", padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>← 戻る</button>
            <button onClick={onEdit} style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: 8, color: "#f8f0e4", padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>編集</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span className={`tag tag-${recipe.tag}`}>{recipe.tag}</span>
            {recipe.favorite && <span style={{ fontSize: 18 }}>★</span>}
          </div>
          <h2 style={{ fontFamily: "'Zen Old Mincho',serif", fontSize: 24, fontWeight: 700, marginBottom: 6 }}>{recipe.name}</h2>
          {recipe.memo && <p style={{ fontSize: 13, color: "#d4b88a", lineHeight: 1.6 }}>💬 {recipe.memo}</p>}
        </div>
        {recipe.url && <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0e8d8" }}><a href={recipe.url} target="_blank" rel="noopener noreferrer" className="url-btn"><span style={{ fontSize: 18 }}>▶️</span><span>参考動画・レシピを見る</span><span style={{ marginLeft: "auto", fontSize: 11, color: "#b09070" }}>外部リンク →</span></a></div>}
        <div style={{ display: "flex", borderBottom: "2px solid #f0e8d8", background: "#fff" }}>
          {[{ id: "steps", label: "👨‍🍳 作り方" }, { id: "ingredients", label: "🥬 材料" }].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex: 1, border: "none", background: "none", padding: "13px", cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 600, color: activeTab === t.id ? "#3d2b08" : "#b09070", borderBottom: activeTab === t.id ? "2px solid #3d2b08" : "2px solid transparent", marginBottom: -2, transition: "all .15s" }}>{t.label}</button>
          ))}
        </div>
        {activeTab === "steps" && <div style={{ padding: "20px 16px" }}>
          {(!recipe.steps || !recipe.steps.length) ? <div style={{ textAlign: "center", padding: "40px 20px", color: "#b09070" }}><div style={{ fontSize: 36, marginBottom: 10 }}>📝</div><div>作り方が登録されていません</div></div>
            : recipe.steps.map((step, i) => <div key={i} className="step-row"><div className="step-num">{i + 1}</div><div className="step-text">{step}</div></div>)}
        </div>}
        {activeTab === "ingredients" && <div style={{ padding: "20px 16px" }}>
          <div style={{ fontSize: 12, color: "#b09070", marginBottom: 14 }}>基本 {recipe.servings || 2}人前</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {recipe.ingredients.filter(i => i.type === "通常食材").map((ing, i) => <div key={i} className="ing-chip"><span>{ing.name}</span><span className="ing-amount">{ing.amount}{ing.unit}</span></div>)}
          </div>
          {recipe.ingredients.some(i => i.type === "調味料") && <>
            <div style={{ fontSize: 12, color: "#b09070", marginBottom: 10, fontWeight: 700 }}>調味料</div>
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
  // planEntries: [{id, date, recipeId, portion, skip}]
  const [planEntries, setPlanEntries] = useState([])
  const [seasoningChecks, setSeasoningChecks] = useState({})
  const [shoppingAdjust, setShoppingAdjust] = useState({})
  const [deletedItems, setDeletedItems] = useState(new Set())
  const [checkedShoppingItems, setCheckedShoppingItems] = useState(new Set())
  const [showConfirmPlan, setShowConfirmPlan] = useState(false)
  const [history, setHistory] = useState([])
  const [filterTag, setFilterTag] = useState("すべて")
  const [filterFav, setFilterFav] = useState(false)
  const [editRecipe, setEditRecipe] = useState(null)
  const [showRegister, setShowRegister] = useState(false)
  const [detailRecipe, setDetailRecipe] = useState(null)
  const [expandedHistory, setExpandedHistory] = useState(null)
  const [editingHistory, setEditingHistory] = useState(null)
  const [toast, setToast] = useState(null)
  const saveTimer = useRef(null)

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 2500) }

  useEffect(() => {
    const uid = getSavedUid()
    if (!uid) { setAutoLogging(false); return }
    getUser(uid).then(user => {
      if (user) {
        const d = user.data || {}
        setUserId(uid); setRecipes(d.recipes || SAMPLE_RECIPES)
        setPlanEntries(d.planEntries || [])
        setSeasoningChecks(d.seasoningChecks || {}); setShoppingAdjust(d.shoppingAdjust || {})
        setDeletedItems(new Set(d.deletedItems || [])); setHistory(d.history || [])
      } else { clearUid() }
      setAutoLogging(false)
    }).catch(() => { clearUid(); setAutoLogging(false) })
  }, [])

  const handleLogin = (uid, data) => {
    setUserId(uid); setRecipes(data.recipes || SAMPLE_RECIPES)
    setPlanEntries(data.planEntries || [])
    setSeasoningChecks(data.seasoningChecks || {}); setShoppingAdjust(data.shoppingAdjust || {})
    setDeletedItems(new Set(data.deletedItems || [])); setHistory(data.history || [])
    setScreen("catalog")
  }

  const triggerSave = useCallback((newData) => {
    if (!userId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try { await saveData(userId, newData); showToast("保存しました ✓") }
      catch (e) { showToast("保存失敗: " + e.message, "error") }
    }, 1500)
  }, [userId])

  const buildSave = useCallback((overrides = {}) => ({
    recipes, planEntries, seasoningChecks, shoppingAdjust,
    deletedItems: [...deletedItems], history, ...overrides,
  }), [recipes, planEntries, seasoningChecks, shoppingAdjust, deletedItems, history])

  // ── レシピ操作 ──
  const toggleFavorite = id => { const next = recipes.map(r => r.id === id ? { ...r, favorite: !r.favorite } : r); setRecipes(next); triggerSave(buildSave({ recipes: next })) }
  const saveRecipe = recipe => {
    const next = recipe.id ? recipes.map(r => r.id === recipe.id ? recipe : r) : [...recipes, { ...recipe, id: Date.now() }]
    setRecipes(next); triggerSave(buildSave({ recipes: next }))
    setShowRegister(false); setEditRecipe(null)
    if (detailRecipe && recipe.id === detailRecipe.id) setDetailRecipe(recipe)
  }
  const deleteRecipe = id => {
    if (!window.confirm("このレシピを削除しますか？")) return
    const nextR = recipes.filter(r => r.id !== id), nextP = planEntries.filter(e => e.recipeId !== id)
    setRecipes(nextR); setPlanEntries(nextP); triggerSave(buildSave({ recipes: nextR, planEntries: nextP }))
    if (detailRecipe?.id === id) setDetailRecipe(null)
  }

  const deleteHistory = id => {
    if (!window.confirm("この履歴を削除しますか？")) return
    const next = history.filter(h => h.id !== id)
    setHistory(next); triggerSave(buildSave({ history: next }))
  }

  // ── プラン操作 ──
  const sortedEntries = useMemo(() => [...planEntries].sort((a, b) => (a.date || "").localeCompare(b.date || "")), [planEntries])

  const addPlanEntry = () => {
    const lastDate = sortedEntries.length > 0 ? sortedEntries[sortedEntries.length - 1].date : null
    let nextDate = ""
    if (lastDate) {
      const d = new Date(lastDate); d.setDate(d.getDate() + 1)
      nextDate = d.toISOString().slice(0, 10)
    }
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
    const swapIdx = idx + dir
    const a = sorted[idx], b = sorted[swapIdx]
    // 日付を交換
    const next = planEntries.map(e => {
      if (e.id === a.id) return { ...e, date: b.date }
      if (e.id === b.id) return { ...e, date: a.date }
      return e
    })
    setPlanEntries(next); triggerSave(buildSave({ planEntries: next }))
  }

  // ── 調味料 ──
  const allSeasonings = useMemo(() => {
    const activeSels = planEntries.filter(e => !e.skip && e.recipeId).map(e => ({ recipeId: e.recipeId, portion: e.portion }))
    return mergeSeasonings(activeSels, recipes)
  }, [planEntries, recipes])

  const toggleSeasoningCheck = name => {
    const next = { ...seasoningChecks, [name]: !seasoningChecks[name] }
    setSeasoningChecks(next); triggerSave(buildSave({ seasoningChecks: next }))
  }

  // ── 買い物リスト ──
  const baseShoppingList = useMemo(() => {
    const activeSels = planEntries.filter(e => !e.skip && e.recipeId).map(e => ({ recipeId: e.recipeId, portion: e.portion }))
    const merged = mergeIngredientsAdvanced(activeSels, recipes)
    const seasonings = allSeasonings.filter(s => seasoningChecks[s.name]).map(s => ({ ...s, amount: s.totalAmount || "適量", isSeasoning: true }))
    return [...merged, ...seasonings]
  }, [planEntries, recipes, seasoningChecks, allSeasonings])

  const shoppingList = useMemo(() => baseShoppingList
    .filter(i => !deletedItems.has(i.name))
    .map(i => ({ ...i, displayAmount: shoppingAdjust[i.name] !== undefined ? shoppingAdjust[i.name] : i.amount }))
    .sort((a, b) => { const ai = STORE_ORDER.indexOf(a.category), bi = STORE_ORDER.indexOf(b.category); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) })
  , [baseShoppingList, shoppingAdjust, deletedItems])

  const adjustShopping = (name, delta, unit) => {
    const step = ["個","本","袋","枚","パック","片","束"].includes(unit) ? 1 : 10
    const cur = shoppingAdjust[name] !== undefined ? shoppingAdjust[name] : (Number(baseShoppingList.find(i => i.name === name)?.amount) || 0)
    const next = { ...shoppingAdjust, [name]: Math.max(0, Math.round((cur + delta * step) * 10) / 10) }
    setShoppingAdjust(next); triggerSave(buildSave({ shoppingAdjust: next }))
  }
  const removeShoppingItem = name => { const next = new Set([...deletedItems, name]); setDeletedItems(next); triggerSave(buildSave({ deletedItems: [...next] })) }

  // ── 確定 ──
  const confirmPlan = () => {
    const menus = sortedEntries.map(e => {
      const r = recipes.find(r => r.id === e.recipeId)
      return { date: e.date, name: e.skip ? "（外食・スキップ）" : r ? r.name : "未設定", portion: e.portion, skip: e.skip }
    })
    const label = formatPeriodLabel(sortedEntries)
    const newHistory = [{ id: Date.now(), label, menus, entries: sortedEntries }, ...history]
    setHistory(newHistory); setPlanEntries([]); setSeasoningChecks({}); setShoppingAdjust({})
    setDeletedItems(new Set()); setCheckedShoppingItems(new Set()); setShowConfirmPlan(false)
    triggerSave(buildSave({ history: newHistory, planEntries: [], seasoningChecks: {}, shoppingAdjust: {}, deletedItems: [] }))
    setScreen("history")
  }

  const logout = () => { clearUid(); setUserId(null); setRecipes([]); setPlanEntries([]); setSeasoningChecks({}); setShoppingAdjust({}); setDeletedItems(new Set()); setHistory([]) }

  if (autoLogging) return (
    <><style>{CSS}</style>
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f8f5f0" }}>
      <div style={{ fontSize: 48, marginBottom: 20 }}>🥢</div>
      <div className="spinner" />
      <div style={{ fontSize: 13, color: "#b09070" }}>データを読み込んでいます...</div>
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
          {screen === "catalog" && <button className="btn btn-outline btn-sm" style={{ background: "transparent", color: "#f8f0e4", borderColor: "#6a5030" }} onClick={() => { setEditRecipe(null); setShowRegister(true) }}>＋ 追加</button>}
          <button className="btn btn-ghost btn-sm" style={{ color: "#c9b090", fontSize: 11 }} onClick={logout}>ログアウト</button>
        </div>
      </header>

      <div className="screen" style={{ flex: 1 }}>

        {/* ── カタログ ── */}
        {screen === "catalog" && (
          <div style={{ padding: "16px 16px 0" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <button className={`pill-btn ${filterFav ? "active" : ""}`} onClick={() => setFilterFav(f => !f)}>★ お気に入り</button>
              {["すべて", ...TAGS].map(t => <button key={t} className={`pill-btn ${filterTag === t ? "active" : ""}`} onClick={() => setFilterTag(t)}>{t}</button>)}
            </div>
            {(() => {
              const filtered = recipes.filter(r => (!filterFav || r.favorite) && (filterTag === "すべて" || r.tag === filterTag))
              if (!filtered.length) return <div className="empty-state"><div style={{ fontSize: 44, marginBottom: 12 }}>🍽️</div><div style={{ fontWeight: 600, marginBottom: 6 }}>レシピがありません</div><div style={{ fontSize: 12 }}>右上の「＋追加」から登録してね</div></div>
              return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.map(r => (
                  <div key={r.id} style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 6px rgba(80,60,20,0.06)", overflow: "hidden" }}>
                    <div style={{ padding: "13px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setDetailRecipe(r)}>
                      <button className="fav-btn" onClick={e => { e.stopPropagation(); toggleFavorite(r.id) }}>{r.favorite ? "★" : "☆"}</button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: r.memo ? 3 : 0 }}>
                          <span style={{ fontWeight: 700, fontSize: 15 }}>{r.name}</span>
                          <span className={`tag tag-${r.tag}`}>{r.tag}</span>
                          {r.aiGenerated && <span className="ai-badge">AI</span>}
                        </div>
                        {r.memo && <div style={{ fontSize: 11, color: "#a08870", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.memo}</div>}
                      </div>
                      <span style={{ color: "#c9b090", fontSize: 20 }}>›</span>
                    </div>
                    <div style={{ display: "flex", borderTop: "1px solid #f5ede0", background: "#fdfaf6" }}>
                      <button className="btn btn-ghost btn-sm" style={{ flex: 1, padding: "8px", borderRadius: 0, fontSize: 12 }} onClick={() => { setEditRecipe(r); setShowRegister(true) }}>✏️ 編集</button>
                      <div style={{ width: 1, background: "#f0e8d8" }} />
                      <button className="btn btn-ghost btn-sm" style={{ flex: 1, padding: "8px", borderRadius: 0, fontSize: 12, color: "#c0391b" }} onClick={() => deleteRecipe(r.id)}>🗑 削除</button>
                    </div>
                  </div>
                ))}
              </div>
            })()}
          </div>
        )}

        {/* ── 献立プラン ── */}
        {screen === "plan" && (
          <div style={{ padding: "16px 16px 0" }}>
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, color: "#8a7050" }}>日付を選んでメニューを設定してね</div>
              <button className="btn btn-outline btn-sm" onClick={addPlanEntry}>＋ 日を追加</button>
            </div>

            {sortedEntries.length === 0 && <div className="empty-state"><div style={{ fontSize: 44, marginBottom: 12 }}>📅</div><div>「＋ 日を追加」から始めよう</div></div>}

            {sortedEntries.map((entry, idx) => (
              <div key={entry.id} className="date-entry">
                <div className="date-entry-header">
                  {/* 上下移動 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <button className="btn-icon" style={{ fontSize: 12, padding: "2px 6px" }} onClick={() => moveEntry(entry.id, -1)} disabled={idx === 0}>▲</button>
                    <button className="btn-icon" style={{ fontSize: 12, padding: "2px 6px" }} onClick={() => moveEntry(entry.id, 1)} disabled={idx === sortedEntries.length - 1}>▼</button>
                  </div>
                  {/* 日付 */}
                  <input type="date" value={entry.date || ""} onChange={e => updateEntry(entry.id, { date: e.target.value })}
                    style={{ width: 150, fontSize: 13, padding: "6px 10px", flex: "0 0 auto" }} />
                  <div style={{ fontSize: 13, color: "#8a7050", minWidth: 80 }}>{entry.date ? formatDateLabel(entry.date) : "日付未設定"}</div>
                  {/* スキップトグル */}
                  <button onClick={() => updateEntry(entry.id, { skip: !entry.skip })} style={{ marginLeft: "auto", background: entry.skip ? "#f0e8d8" : "none", border: "1.5px solid #d4c5b0", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 11, color: entry.skip ? "#8a7050" : "#c0a880", fontWeight: 600 }}>
                    {entry.skip ? "スキップ中" : "スキップ"}
                  </button>
                  <button className="btn-icon" style={{ color: "#c0391b" }} onClick={() => removeEntry(entry.id)}>✕</button>
                </div>

                {!entry.skip && (
                  <div style={{ padding: "10px 14px" }}>
                    <div style={{ marginBottom: 8 }}>
                      <select value={entry.recipeId || ""} onChange={e => updateEntry(entry.id, { recipeId: e.target.value ? Number(e.target.value) : null })}
                        style={{ fontSize: 13, padding: "8px 10px" }}>
                        <option value="">── レシピを選択 ──</option>
                        {recipes.map(r => <option key={r.id} value={r.id}>{r.name}（{r.tag}）</option>)}
                      </select>
                    </div>
                    {entry.recipeId && (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <select className="portion-select" value={entry.portion} onChange={e => updateEntry(entry.id, { portion: Number(e.target.value) })}>
                          <option value={1}>1日分（2人前）</option>
                          <option value={2}>2日分（4人前）</option>
                          <option value={3}>3日分（6人前）</option>
                        </select>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => setDetailRecipe(recipes.find(r => r.id === entry.recipeId))}>レシピ確認 →</button>
                      </div>
                    )}
                  </div>
                )}
                {entry.skip && <div style={{ padding: "10px 14px", fontSize: 13, color: "#c0a880" }}>外食・お休みの日</div>}
              </div>
            ))}

            {planEntries.some(e => !e.skip && e.recipeId) && (
              <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setScreen("seasoning")}>調味料チェックへ →</button>
                <button className="btn btn-outline" style={{ flex: 1, borderColor: "#e8a000", color: "#8a6000" }} onClick={() => setShowConfirmPlan(true)}>🗓 今回の買い物を締める</button>
              </div>
            )}
          </div>
        )}

        {/* ── 調味料チェック（分量表示付き） ── */}
        {screen === "seasoning" && (
          <div style={{ padding: "16px 16px 0" }}>
            <div style={{ marginBottom: 14, fontSize: 13, color: "#8a7050" }}>今回のメニューで使う調味料です。<br />家にない・買い足したいものにチェックを入れてね ✓</div>
            <div className="card" style={{ overflow: "hidden", marginBottom: 16 }}>
              {!allSeasonings.length && <div style={{ padding: "20px", color: "#c0a880", fontSize: 13, textAlign: "center" }}>献立タブでメニューを設定してください</div>}
              {allSeasonings.map(s => (
                <div key={s.name} className="check-row" onClick={() => toggleSeasoningCheck(s.name)}>
                  <div className={`custom-check ${seasoningChecks[s.name] ? "checked" : ""}`}>{seasoningChecks[s.name] ? "✓" : ""}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "#a08870", marginTop: 2 }}>
                      合計 <strong>{Math.round(s.totalAmount * 10) / 10}{s.unit}</strong>
                      　使用レシピ: {s.recipes.join("・")}
                    </div>
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
            <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 13, color: "#8a7050" }}>タップでチェック、＋−で数量調整</div>
              {planEntries.some(e => !e.skip && e.recipeId) && (
                <button className="btn btn-outline btn-sm" style={{ fontSize: 12, borderColor: "#e8a000", color: "#8a6000" }} onClick={() => setShowConfirmPlan(true)}>
                  🗓 買い物を締める
                </button>
              )}
            </div>
            {!shoppingList.length && <div className="empty-state"><div style={{ fontSize: 44, marginBottom: 12 }}>🛒</div><div>献立タブでメニューを設定してください</div></div>}
            {STORE_ORDER.map(cat => {
              const allItems = shoppingList.filter(i => i.category === cat)
              if (!allItems.length) return null
              const unchecked = allItems.filter(i => !checkedShoppingItems.has(i.name))
              const checked = allItems.filter(i => checkedShoppingItems.has(i.name))
              return (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div className="section-head">{cat}</div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {[...unchecked, ...checked].map(item => {
                      const isChecked = checkedShoppingItems.has(item.name)
                      return (
                        <div key={item.name} className="item-row" style={{ opacity: isChecked ? 0.45 : 1, background: isChecked ? "#f8f5f0" : "#fff" }}>
                          {/* チェックボックス */}
                          <div onClick={() => {
                            const next = new Set(checkedShoppingItems)
                            isChecked ? next.delete(item.name) : next.add(item.name)
                            setCheckedShoppingItems(next)
                          }} style={{ width: 24, height: 24, borderRadius: 6, border: `2px solid ${isChecked ? "#3d2b08" : "#d4c5b0"}`, background: isChecked ? "#3d2b08" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: "#fff", fontSize: 14 }}>
                            {isChecked ? "✓" : ""}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 500, fontSize: 14, textDecoration: isChecked ? "line-through" : "none" }}>{item.name}</div>
                            {item.isSeasoning && <span style={{ fontSize: 10, color: "#a08870" }}>調味料（買い足し）</span>}
                          </div>
                          {!item.isSeasoning
                            ? <div className="num-ctrl">
                                <button className="num-btn" onClick={() => adjustShopping(item.name, -1, item.unit)}>−</button>
                                <span style={{ minWidth: 60, textAlign: "center", fontSize: 14, fontWeight: 700 }}>{item.displayAmount}{item.unit}</span>
                                <button className="num-btn" onClick={() => adjustShopping(item.name, 1, item.unit)}>＋</button>
                              </div>
                            : <span style={{ fontSize: 13, color: "#8a7050" }}>{item.amount}{item.unit}</span>}
                          <button className="btn btn-ghost btn-sm" style={{ color: "#c0391b", padding: "4px 8px" }} onClick={() => removeShoppingItem(item.name)}>✕</button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {checkedShoppingItems.size > 0 && (
              <div style={{ textAlign: "center", padding: "8px", fontSize: 12, color: "#8a7050" }}>
                {checkedShoppingItems.size}品チェック済み
              </div>
            )}
          </div>
        )}

        {/* ── 履歴 ── */}
        {screen === "history" && (
          <div style={{ padding: "16px 16px 0" }}>
            {!history.length && <div className="empty-state"><div style={{ fontSize: 44, marginBottom: 12 }}>📖</div><div>まだ履歴がありません</div></div>}
            {history.map(week => (
              <div key={week.id} className="history-week" style={{ marginBottom: 14, background: "#fff" }}>
                <div style={{ padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", background: expandedHistory === week.id ? "#faf3e8" : "#fff" }}
                  onClick={() => setExpandedHistory(expandedHistory === week.id ? null : week.id)}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{week.label}</div>
                    <div style={{ fontSize: 11, color: "#a08870", marginTop: 2 }}>{week.menus.length}日分</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={e => { e.stopPropagation(); setEditingHistory(week) }}>✏️ 編集</button>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: "#c0391b" }} onClick={e => { e.stopPropagation(); deleteHistory(week.id) }}>🗑 削除</button>
                    <span style={{ color: "#8a7050" }}>{expandedHistory === week.id ? "▲" : "▼"}</span>
                  </div>
                </div>
                {expandedHistory === week.id && (
                  <div style={{ borderTop: "1px solid #f0e8d8" }}>
                    {week.menus.map((m, i) => (
                      <div key={i} className="item-row">
                        <span style={{ fontSize: 12, color: "#8a7050", minWidth: 80 }}>{m.date ? formatDateLabel(m.date) : `${i+1}日目`}</span>
                        <span style={{ flex: 1, fontSize: 14, color: m.skip ? "#c0a880" : "#1a1208" }}>{m.name}</span>
                        {!m.skip && <span style={{ fontSize: 11, color: "#a08870" }}>{m.portion === 1 ? "1日分" : `${m.portion}日分`}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <nav style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "#fff", borderTop: "1px solid #e8dcc8", display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {navItems.map(n => (
          <button key={n.id} onClick={() => setScreen(n.id)} style={{ flex: 1, border: "none", background: "none", cursor: "pointer", padding: "10px 4px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, fontFamily: "inherit", color: screen === n.id ? "#3d2b08" : "#b09070", transition: "color .15s" }}>
            <span style={{ fontSize: 20 }}>{n.icon}</span>
            <span style={{ fontSize: 10, fontWeight: screen === n.id ? 700 : 400 }}>{n.label}</span>
            {screen === n.id && <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#3d2b08" }} />}
          </button>
        ))}
      </nav>

      {detailRecipe && <RecipeDetailSheet recipe={detailRecipe} onClose={() => setDetailRecipe(null)} onEdit={() => { setEditRecipe(detailRecipe); setShowRegister(true); setDetailRecipe(null) }} />}
      {showRegister && <RegisterSheet recipe={editRecipe} onSave={saveRecipe} onClose={() => { setShowRegister(false); setEditRecipe(null) }} />}
      {editingHistory && <HistoryEditSheet historyItem={editingHistory} recipes={recipes} onSave={updated => {
        const next = history.map(h => h.id === updated.id ? updated : h)
        setHistory(next); triggerSave(buildSave({ history: next })); setEditingHistory(null)
      }} onClose={() => setEditingHistory(null)} />}

      {/* 買い物締めの確認モーダル */}
      {showConfirmPlan && (
        <div className="overlay" onClick={e => { if (e.target === e.currentTarget) setShowConfirmPlan(false) }}>
          <div className="sheet" style={{ maxWidth: 420 }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🗓</div>
              <h3 style={{ fontFamily: "'Zen Old Mincho',serif", fontSize: 20, fontWeight: 700, marginBottom: 10 }}>今回の買い物を締めますか？</h3>
              <p style={{ fontSize: 13, color: "#8a7050", lineHeight: 1.7 }}>
                現在の献立を履歴に保存して、<br />
                買い物リスト・献立をリセットします。<br />
                <span style={{ color: "#c0391b", fontWeight: 600 }}>※この操作は取り消せません</span>
              </p>
            </div>
            <div style={{ background: "#faf3e8", borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "#8a7050", marginBottom: 6, fontWeight: 700 }}>保存される献立</div>
              {sortedEntries.filter(e => !e.skip && e.recipeId).slice(0, 5).map((e, i) => {
                const r = recipes.find(r => r.id === e.recipeId)
                return <div key={i} style={{ fontSize: 13, color: "#3d2b08", marginBottom: 2 }}>・{e.date ? formatDateLabel(e.date) : ""} {r?.name}</div>
              })}
              {sortedEntries.filter(e => !e.skip && e.recipeId).length > 5 && <div style={{ fontSize: 12, color: "#8a7050" }}>他{sortedEntries.filter(e => !e.skip && e.recipeId).length - 5}件...</div>}
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

// ── 履歴編集シート ──
function HistoryEditSheet({ historyItem, recipes, onSave, onClose }) {
  const [menus, setMenus] = useState(historyItem.menus.map(m => ({ ...m })))
  const updateMenu = (i, patch) => setMenus(ms => ms.map((m, j) => j === i ? { ...m, ...patch } : m))
  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontFamily: "'Zen Old Mincho',serif", fontSize: 18, fontWeight: 700 }}>履歴を編集</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: "#8a7050", marginBottom: 14 }}>{historyItem.label}</div>
        {menus.map((m, i) => (
          <div key={i} style={{ background: "#faf5ee", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#8a7050", marginBottom: 6 }}>{m.date ? formatDateLabel(m.date) : `${i+1}日目`}</div>
            {!m.skip
              ? <select value={recipes.find(r => r.name === m.name)?.id || ""} onChange={e => {
                  const r = recipes.find(r => r.id === Number(e.target.value))
                  updateMenu(i, { name: r ? r.name : m.name })
                }} style={{ fontSize: 13, padding: "7px 10px" }}>
                  <option value="">── 選択 ──</option>
                  {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              : <div style={{ fontSize: 13, color: "#c0a880" }}>外食・スキップ</div>}
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

// ── レシピ登録シート（Gemini連携付き） ──
function RegisterSheet({ recipe, onSave, onClose }) {
  const blank = { name: "", tag: "主菜", favorite: false, memo: "", url: "", steps: [""], servings: 2, ingredients: [{ name: "", amount: "", unit: "g", type: "通常食材", category: "野菜・果物" }] }
  const [form, setForm] = useState(() => { if (!recipe) return blank; const r = JSON.parse(JSON.stringify(recipe)); if (!r.steps) r.steps = [""]; if (!r.servings) r.servings = 2; return r })
  const [regTab, setRegTab] = useState("basic")
  const [aiUrl, setAiUrl] = useState("")
  const [aiText, setAiText] = useState("")
  const [aiMode, setAiMode] = useState("url") // url | text
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState("")

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setStep = (i, v) => setForm(f => ({ ...f, steps: f.steps.map((s, j) => j === i ? v : s) }))
  const addStep = () => setForm(f => ({ ...f, steps: [...f.steps, ""] }))
  const removeStep = i => setForm(f => ({ ...f, steps: f.steps.filter((_, j) => j !== i) }))
  const setIng = (i, k, v) => setForm(f => ({ ...f, ingredients: f.ingredients.map((x, j) => j === i ? { ...x, [k]: v } : x) }))
  const addIng = () => setForm(f => ({ ...f, ingredients: [...f.ingredients, { name: "", amount: "", unit: "g", type: "通常食材", category: "野菜・果物" }] }))
  const removeIng = i => setForm(f => ({ ...f, ingredients: f.ingredients.filter((_, j) => j !== i) }))
  const tabStyle = id => ({ flex: 1, border: "none", background: "none", padding: "10px 4px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: regTab === id ? "#3d2b08" : "#b09070", borderBottom: regTab === id ? "2px solid #3d2b08" : "2px solid transparent", transition: "all .15s" })

  const handleAiExtract = async () => {
    const input = aiMode === "url" ? aiUrl.trim() : aiText.trim()
    if (!input) return
    setAiLoading(true); setAiError("")
    try {
      const result = aiMode === "url"
        ? await extractRecipeFromUrl(input)
        : await extractRecipeFromText(input)
      setForm({
        name: result.recipeName || "",
        tag: "主菜", favorite: false,
        memo: result.memo || "",
        url: aiMode === "url" ? input : "",
        steps: result.steps?.length ? result.steps : [""],
        ingredients: (result.ingredients || []).map(ing => ({
          name: ing.name || "", amount: ing.amount ?? "",
          unit: ing.unit || "g", type: ing.type || "通常食材",
          category: ing.category || "野菜・果物"
        })),
        aiGenerated: true,
      })
      setRegTab("basic")
    } catch (e) {
      setAiError(e.message)
    }
    setAiLoading(false)
  }

  return (
    <div className="overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontFamily: "'Zen Old Mincho',serif", fontSize: 18, fontWeight: 700 }}>{recipe ? "レシピを編集" : "レシピを追加"}</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>

        {/* AI自動入力エリア */}
        {!recipe && (
          <div style={{ background: "linear-gradient(135deg,#eef2ff,#f5f3ff)", border: "1.5px solid #c7d2fe", borderRadius: 12, padding: "14px 16px", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span className="ai-badge">✨ AI</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#4338ca" }}>レシピを自動入力</span>
            </div>
            {/* モード切替 */}
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <button onClick={() => setAiMode("url")} className="pill-btn" style={{ fontSize: 11, padding: "4px 12px", background: aiMode === "url" ? "#4f46e5" : "#fff", color: aiMode === "url" ? "#fff" : "#5a4020", borderColor: aiMode === "url" ? "#4f46e5" : "#d4c5b0" }}>URLから</button>
              <button onClick={() => setAiMode("text")} className="pill-btn" style={{ fontSize: 11, padding: "4px 12px", background: aiMode === "text" ? "#4f46e5" : "#fff", color: aiMode === "text" ? "#fff" : "#5a4020", borderColor: aiMode === "text" ? "#4f46e5" : "#d4c5b0" }}>テキストを貼り付け</button>
            </div>
            {aiMode === "url" ? (
              <div>
                <div style={{ fontSize: 11, color: "#6366f1", marginBottom: 6 }}>※ クックパッド・デリッシュ等のレシピサイトが対象。YouTubeはタイトルのみ解析します</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input placeholder="https://cookpad.com/recipe/..." value={aiUrl} onChange={e => setAiUrl(e.target.value)} style={{ flex: 1, fontSize: 13, padding: "8px 10px", borderColor: "#c7d2fe" }} />
                  <button className="btn btn-primary btn-sm" style={{ background: "#4f46e5", whiteSpace: "nowrap" }} onClick={handleAiExtract} disabled={aiLoading}>
                    {aiLoading ? <span className="spinner-sm" /> : "解析"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 11, color: "#6366f1", marginBottom: 6 }}>レシピページのテキストをコピーして貼り付けてください</div>
                <textarea rows={4} placeholder="材料&#10;・鶏もも肉 300g&#10;・醤油 大さじ2&#10;&#10;作り方&#10;1. ..." value={aiText} onChange={e => setAiText(e.target.value)} style={{ fontSize: 12, padding: "8px 10px", borderColor: "#c7d2fe", resize: "vertical", marginBottom: 8 }} />
                <button className="btn btn-primary btn-sm" style={{ background: "#4f46e5", width: "100%", padding: "10px" }} onClick={handleAiExtract} disabled={aiLoading}>
                  {aiLoading ? <><span className="spinner-sm" /> 解析中...</> : "✨ AIで解析する"}
                </button>
              </div>
            )}
            {aiError && <div style={{ fontSize: 11, color: "#c0391b", marginTop: 8, padding: "8px", background: "#fff0ee", borderRadius: 6 }}>⚠️ {aiError}</div>}
          </div>
        )}

        <div style={{ display: "flex", borderBottom: "1px solid #f0e8d8", marginBottom: 18 }}>
          <button style={tabStyle("basic")} onClick={() => setRegTab("basic")}>基本情報</button>
          <button style={tabStyle("steps")} onClick={() => setRegTab("steps")}>作り方</button>
          <button style={tabStyle("ingredients")} onClick={() => setRegTab("ingredients")}>材料</button>
        </div>

        {regTab === "basic" && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "flex-end" }}>
              <div><label style={{ fontSize: 11, color: "#8a7050", display: "block", marginBottom: 4, fontWeight: 700 }}>レシピ名 *</label><input placeholder="例: 肉じゃが" value={form.name} onChange={e => set("name", e.target.value)} /></div>
              <button onClick={() => set("favorite", !form.favorite)} style={{ background: "none", border: "1.5px solid #d4c5b0", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontSize: 22 }}>{form.favorite ? "★" : "☆"}</button>
            </div>
            <div><label style={{ fontSize: 11, color: "#8a7050", display: "block", marginBottom: 4, fontWeight: 700 }}>分類タグ</label><div style={{ display: "flex", gap: 8 }}>{TAGS.map(t => <button key={t} className={`pill-btn ${form.tag === t ? "active" : ""}`} onClick={() => set("tag", t)}>{t}</button>)}</div></div>
            <div><label style={{ fontSize: 11, color: "#8a7050", display: "block", marginBottom: 4, fontWeight: 700 }}>メモ・コツ</label><textarea rows={2} placeholder="調理のコツや気づきなど..." value={form.memo} onChange={e => set("memo", e.target.value)} style={{ resize: "vertical" }} /></div>
            <div><label style={{ fontSize: 11, color: "#8a7050", display: "block", marginBottom: 4, fontWeight: 700 }}>参考URL（YouTube等）</label><input placeholder="https://..." value={form.url} onChange={e => set("url", e.target.value)} />{form.url && <a href={form.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#7a9fc0", display: "block", marginTop: 4 }}>🔗 URLを確認</a>}</div>
          </div>
        )}
        {regTab === "steps" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#8a7050" }}>手順を1ステップずつ入力してね</div>
              <button className="btn btn-outline btn-sm" onClick={addStep}>＋ 追加</button>
            </div>
            {form.steps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "flex-start" }}>
                <div className="step-num" style={{ flexShrink: 0, marginTop: 4 }}>{i + 1}</div>
                <textarea rows={2} placeholder={`手順 ${i + 1}...`} value={step} onChange={e => setStep(i, e.target.value)} style={{ flex: 1, resize: "vertical", fontSize: 13, padding: "8px 10px" }} />
                <button onClick={() => removeStep(i)} style={{ background: "none", border: "1.5px solid #e0d0c0", borderRadius: 8, cursor: "pointer", color: "#c0391b", width: 32, height: 32, fontSize: 14, flexShrink: 0, marginTop: 4 }}>×</button>
              </div>
            ))}
          </div>
        )}
        {regTab === "ingredients" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#8a7050" }}>基本</div>
                <select value={form.servings || 2} onChange={e => set("servings", Number(e.target.value))} style={{ fontSize: 13, padding: "4px 8px", width: "auto" }}>
                  {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}人前</option>)}
                </select>
                <div style={{ fontSize: 12, color: "#8a7050" }}>で入力してね</div>
              </div>
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
                  <select value={ing.type} onChange={e => setIng(i, "type", e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }}><option>通常食材</option><option>調味料</option></select>
                  <select value={ing.category} onChange={e => setIng(i, "category", e.target.value)} style={{ fontSize: 12, padding: "6px 8px" }}>{STORE_ORDER.map(c => <option key={c}>{c}</option>)}</select>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>キャンセル</button>
          <button className="btn btn-primary" style={{ flex: 2, padding: "13px" }} onClick={() => form.name && onSave({ ...form, steps: form.steps.filter(s => s.trim()) })}>保存する</button>
        </div>
      </div>
    </div>
  )
}
