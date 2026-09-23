import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = "https://icdxnlkgrxsccqbrmsad.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZHhubGtncnhzY2NxYnJtc2FkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNDgxNDQsImV4cCI6MjA5NTYyNDE0NH0.1yLiXwKYfgPRb6B2u2ZaQBBjKqmSc4iUGdlYiE_IL9U"

// Realtime / Storage 用クライアント（認証は独自実装のため Supabase Auth のセッションは使わない）
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const PHOTO_BUCKET = "recipe-photos"

const headers = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
}

export async function hashPassword(pw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32)
}

export async function getUser(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=*`, { headers })
  if (!res.ok) throw new Error("取得失敗")
  const rows = await res.json()
  return rows[0] || null
}

export async function createUser(userId, passwordHash, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({ id: userId, password_hash: passwordHash, data }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.message || "作成失敗")
  }
  return await res.json()
}

// データ保存（リトライ付き）
export async function saveData(userId, data) {
  const attempt = async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ data }),
    })
    if (!res.ok) throw new Error(`保存失敗(${res.status})`)
    return true
  }
  // 失敗時に最大3回リトライ
  for (let i = 0; i < 3; i++) {
    try { return await attempt() }
    catch (e) {
      if (i === 2) throw e
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
}

// チェック状態専用の保存・取得（shoppingChecks列）
export async function saveShoppingChecks(userId, checks) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ shopping_checks: checks }),
  })
  if (!res.ok) throw new Error("チェック保存失敗")
  return true
}

export async function getShoppingChecks(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=shopping_checks`, { headers })
  if (!res.ok) return []
  const rows = await res.json()
  return rows[0]?.shopping_checks || []
}

// ── チェック状態のリアルタイム購読（postgres_changes） ──
// onChange(checks) : 他端末を含む shopping_checks の変更
// onStatus(status) : "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED"
// 戻り値は購読解除関数
// onRow(row) : 変更後の行（shopping_checks・data）。行が大きいと列が省略されることがあるので、
//              その列が無いときは呼び出し側で取り直す
export function subscribeUserRow(userId, onRow, onStatus) {
  const channel = supabase
    .channel(`user-row-${userId}-${Date.now()}`)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "users", filter: `id=eq.${userId}` },
      payload => onRow(payload.new || {}))
    .subscribe(status => onStatus && onStatus(status))
  return () => { supabase.removeChannel(channel) }
}

// 同期用：レシピ等のデータとチェック状態だけを取る（パスワードのハッシュは取らない）
export async function getUserSyncState(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=data,shopping_checks`, { headers })
  if (!res.ok) throw new Error("取得失敗")
  const rows = await res.json()
  return rows[0] || null
}

// ── レシピ写真（Supabase Storage: recipe-photos） ──
export async function uploadRecipePhoto(userId, blob) {
  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg"
  // Storage のキーに使えない文字（日本語など）は置き換える
  const folder = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_") || "user"
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  })
  if (error) throw new Error(error.message || "写真のアップロードに失敗しました")
  return path
}

export async function deleteRecipePhoto(path) {
  if (!path) return
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([path])
  if (error) throw new Error(error.message || "写真の削除に失敗しました")
}

export function getRecipePhotoUrl(path) {
  if (!path) return null
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
}
