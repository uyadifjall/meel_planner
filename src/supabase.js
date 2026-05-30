// Supabase 設定
const SUPABASE_URL = "https://icdxnlkgrxsccqbrmsad.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZHhubGtncnhzY2NxYnJtc2FkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNDgxNDQsImV4cCI6MjA5NTYyNDE0NH0.1yLiXwKYfgPRb6B2u2ZaQBBjKqmSc4iUGdlYiE_IL9U"

const headers = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
}

// SHA-256 ハッシュ
export async function hashPassword(pw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32)
}

// ユーザー取得
export async function getUser(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=*`, { headers })
  if (!res.ok) throw new Error("取得失敗")
  const rows = await res.json()
  return rows[0] || null
}

// ユーザー作成
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

// データ保存
export async function saveData(userId, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ data }),
  })
  if (!res.ok) throw new Error("保存失敗")
  return true
}
