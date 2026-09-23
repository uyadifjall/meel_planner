// POST /api/import { url } → レシピの下書きを返す
// 1. レシピサイト：ページ内の schema.org Recipe（JSON-LD）を読む（AI不使用・無料）
// 2. YouTube：概要欄を Gemini で整理。概要欄にレシピがなければ動画そのものを Gemini に見せる
// 3. JSON-LD がないサイト：本文テキストを Gemini で整理（クックパッドは HTML から直接読む）
// POST /api/import { text } → 貼り付けたレシピ文章を Gemini で整理
import { lookup } from "node:dns/promises"
import net from "node:net"
import {
  extractJsonLdRecipe, extractCookpadRecipe, htmlToText, getYouTubeId, geminiExtract, cleanText,
} from "./_recipe.js"

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
const MAX_BYTES = 3 * 1024 * 1024

// 内部ネットワークへのアクセスを防ぐ
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase()
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7))
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")
  }
  const [a, b] = ip.split(".").map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

async function assertPublicUrl(raw) {
  let u
  try { u = new URL(raw) } catch { throw new Error("URLの形式が正しくありません") }
  if (!/^https?:$/.test(u.protocol)) throw new Error("http / https のURLを指定してください")
  const addrs = await lookup(u.hostname, { all: true }).catch(() => { throw new Error("サイトが見つかりません") })
  if (addrs.some(a => isPrivateIp(a.address))) throw new Error("このURLは取り込めません")
  return u
}

async function fetchHtml(url) {
  let current = url
  // リダイレクト先も毎回チェックする
  for (let i = 0; i < 5; i++) {
    await assertPublicUrl(current)
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "ja,en;q=0.8" },
      signal: AbortSignal.timeout(15000),
    })
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), current).toString()
      continue
    }
    if (!res.ok) throw new Error(`ページを取得できませんでした（${res.status}）`)
    const reader = res.body.getReader()
    const chunks = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) { reader.cancel(); break }
      chunks.push(value)
    }
    const buf = Buffer.concat(chunks)
    // 古いサイトの Shift_JIS / EUC-JP にも対応
    const head = buf.subarray(0, 4096).toString("latin1")
    const charset = ((res.headers.get("content-type") || "").match(/charset=([\w-]+)/i) || head.match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8"
    try { return new TextDecoder(charset.toLowerCase()).decode(buf) } catch { return new TextDecoder("utf-8").decode(buf) }
  }
  throw new Error("リダイレクトが多すぎます")
}

// YouTube の動画ページからタイトルと概要欄を取り出す
async function fetchYouTubeInfo(videoId) {
  try {
    const html = await fetchHtml(`https://www.youtube.com/watch?v=${videoId}&hl=ja`)
    const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*(?:var\s|<\/script>)/)
    if (m) {
      const d = JSON.parse(m[1]).videoDetails || {}
      return { title: d.title || "", description: d.shortDescription || "" }
    }
  } catch {}
  // 取れなければ oEmbed でタイトルだけ
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`)
    if (res.ok) return { title: (await res.json()).title || "", description: "" }
  } catch {}
  return { title: "", description: "" }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {})
  const url = String(body.url || "").trim()
  const pasted = String(body.text || "").trim()
  if (!url && !pasted) { res.status(400).json({ error: "URLかレシピの文章を入力してください" }); return }

  const apiKey = process.env.GEMINI_API_KEY
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash"
  const noKey = () => res.status(400).json({ error: "AIでの読み取りが必要です。Vercel に GEMINI_API_KEY を設定してください" })

  try {
    // 貼り付けテキスト
    if (pasted) {
      if (!apiKey) return noKey()
      const recipe = await geminiExtract({ apiKey, model, text: `貼り付けられたレシピ:\n${pasted.slice(0, 15000)}` })
      if (!recipe) { res.status(422).json({ error: "文章からレシピを読み取れませんでした" }); return }
      res.status(200).json({ recipe: { ...recipe, url: url || "" }, source: "ai-text" })
      return
    }

    const videoId = getYouTubeId(url)
    if (videoId) {
      if (!apiKey) return noKey()
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
      const { title, description } = await fetchYouTubeInfo(videoId)
      let recipe = null
      if (description.trim()) {
        recipe = await geminiExtract({ apiKey, model, text: `動画タイトル: ${title}\n\n概要欄:\n${description}` })
      }
      let source = "youtube-description"
      // 概要欄にレシピがなければ動画を直接見せる（時間と無料枠の消費が大きい）
      if (!recipe || !recipe.ingredients.length) {
        recipe = await geminiExtract({ apiKey, model, youtubeUrl: watchUrl, text: title ? `動画タイトル: ${title}` : "" })
        source = "youtube-video"
      }
      if (!recipe) { res.status(422).json({ error: "この動画からレシピを読み取れませんでした" }); return }
      if (!recipe.name) recipe.name = cleanText(title)
      res.status(200).json({ recipe: { ...recipe, url: watchUrl }, source })
      return
    }

    const html = await fetchHtml(url)
    if (/(^|\.)cookpad\.com$/.test(new URL(url).hostname)) {
      const cp = extractCookpadRecipe(html)
      if (cp) {
        const { truncated, ...recipe } = cp
        const warning = truncated
          ? "クックパッドはログインしないと材料・作り方の一部しか見られないため、見えている部分だけ取り込みました。残りはクックパッドのアプリでレシピをコピーし、「文章から」で貼り付けてください"
          : null
        res.status(200).json({ recipe: { ...recipe, url }, source: "cookpad", warning })
        return
      }
    }
    const fromLd = extractJsonLdRecipe(html)
    if (fromLd && fromLd.ingredients.length) {
      res.status(200).json({ recipe: { ...fromLd, url }, source: "jsonld" })
      return
    }
    if (!apiKey) return noKey()
    const title = cleanText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")
    const recipe = await geminiExtract({ apiKey, model, text: `ページタイトル: ${title}\n\n本文:\n${htmlToText(html)}` })
    if (!recipe) { res.status(422).json({ error: "このページからレシピを読み取れませんでした" }); return }
    res.status(200).json({ recipe: { ...recipe, url }, source: "ai-page" })
  } catch (e) {
    res.status(500).json({ error: e.message || "取り込みに失敗しました" })
  }
}
