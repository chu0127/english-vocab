"use strict";
/* ============ helpers ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAY = 86400000;
const today = () => { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / DAY); };
const isoDay = n => new Date(n * DAY).toISOString().slice(0, 10);
const md = n => { const d = new Date(n * DAY); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };
const WEEK = "日一二三四五六";
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function toast(msg, ms) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms || 2200);
}
const IV = [0, 1, 2, 4, 7, 15, 30, 60];          // Leitner box -> days until next review
const POS = ["名詞", "動詞", "形容詞", "副詞", "片語", "名詞片語", "連接詞", "介詞", "代名詞", "其他"];

/* ============ state ============ */
const KEY = "vocab-app-v1";
function fresh() { return { v: 1, p: {}, days: [], log: {}, custom: [], set: { newPerDay: 10, auto: true } }; }
function normalize(st) {
  const f = fresh();
  st = Object.assign(f, st || {});
  st.set = Object.assign(fresh().set, st.set || {});
  if (!Array.isArray(st.days)) st.days = [];
  if (!Array.isArray(st.custom)) st.custom = [];
  if (typeof st.p !== "object" || !st.p) st.p = {};
  if (typeof st.log !== "object" || !st.log) st.log = {};
  return st;
}
let S = fresh();
let _all = null;
function allWords() { return _all || (_all = WORDS.concat(S.custom.map(w => Object.assign({ custom: true }, w)))); }
function invalidate() { _all = null; }
function byId(id) { return allWords().find(w => w.id === id); }
function lessons() { const seen = []; allWords().forEach(w => { if (!seen.includes(w.lesson)) seen.push(w.lesson); }); return seen; }
function sayText(w) {
  if (w.say) return w.say;
  return w.word.replace(/\(([^)]*)\)/g, "$1").replace(/\+\s*-?ing/g, "").replace(/\s+/g, " ").trim();
}

/* ============ storage (localStorage → URL hash fallback) ============ */
const store = { mode: "ls" };
function lsOK() { try { const k = "__vt"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; } catch (e) { return false; } }
const b64u = {
  enc(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); },
  dec(str) { str = str.replace(/-/g, "+").replace(/_/g, "/"); while (str.length % 4) str += "="; const bin = atob(str); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
};
async function pipeBytes(bytes, Stream) {
  const s = new Blob([bytes]).stream().pipeThrough(new Stream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function encodeState(st) {
  const raw = new TextEncoder().encode(JSON.stringify(st));
  if (typeof CompressionStream === "function") { try { return "V1z." + b64u.enc(await pipeBytes(raw, CompressionStream)); } catch (e) { } }
  return "V1j." + b64u.enc(raw);
}
async function decodeState(text) {
  const m = String(text || "").replace(/\s+/g, "").match(/V1([zj])\.([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("搵唔到進度碼（應該以 V1 開頭）");
  let bytes = b64u.dec(m[2]);
  if (m[1] === "z") {
    if (typeof DecompressionStream !== "function") throw new Error("呢個瀏覽器太舊，解唔到壓縮碼");
    bytes = await pipeBytes(bytes, DecompressionStream);
  }
  const st = JSON.parse(new TextDecoder().decode(bytes));
  if (!st || st.v !== 1 || typeof st.p !== "object") throw new Error("唔係有效嘅進度資料");
  return normalize(st);
}
function mergeState(a, b) {            // merge b into a, keeping the more-practised record per word
  const out = normalize(JSON.parse(JSON.stringify(a)));
  for (const id in b.p) {
    const x = out.p[id], y = b.p[id];
    if (!x || (y.r || 0) > (x.r || 0) || ((y.r || 0) === (x.r || 0) && (y.s || 0) > (x.s || 0))) out.p[id] = y;
  }
  out.days = Array.from(new Set(out.days.concat(b.days))).sort((m, n) => m - n);
  for (const d in b.log) {
    const x = out.log[d] || {}, y = b.log[d];
    out.log[d] = { r: Math.max(x.r || 0, y.r || 0), n: Math.max(x.n || 0, y.n || 0), q: Math.max(x.q || 0, y.q || 0) };
  }
  const ids = new Set(out.custom.map(w => w.id));
  b.custom.forEach(w => { if (!ids.has(w.id)) out.custom.push(w); });
  out.set = Object.assign({}, out.set, b.set);
  return out;
}
function trim() {
  const t = today();
  for (const d in S.log) if (+d < t - 90) delete S.log[d];
  if (S.days.length > 800) S.days = S.days.slice(-800);
}
let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(flush, 250); }
async function flush() {
  clearTimeout(saveT); saveT = null; trim();
  if (store.mode === "ls") {
    try { localStorage.setItem(KEY, JSON.stringify(S)); return; } catch (e) { store.mode = "hash"; showNotice(); }
  }
  const h = "#s=" + await encodeState(S);
  if (location.hash !== h) {
    try { history.replaceState(null, "", h); } catch (e) { try { location.replace(h); } catch (e2) { } }
  }
}
async function load() {
  store.mode = lsOK() ? "ls" : "hash";
  let st = null;
  if (store.mode === "ls") { try { const j = localStorage.getItem(KEY); if (j) st = normalize(JSON.parse(j)); } catch (e) { } }
  const m = location.hash.match(/s=(V1[zj]\.[A-Za-z0-9_-]+)/);
  if (m) { try { const hs = await decodeState(m[1]); st = st ? mergeState(st, hs) : hs; } catch (e) { } }
  if (st) S = st;
  invalidate();
  if (store.mode === "ls" && m) { await flush(); try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { } }
}
addEventListener("pagehide", () => { if (saveT) flush(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && saveT) flush(); });
function showNotice() {
  const n = $("#notice");
  if (store.mode === "ls" || S.set.hideNotice === today()) { n.hidden = true; return; }
  n.innerHTML = `⚠️ 呢個網址唔畀瀏覽器儲存資料（例如 htmldrop 網站），所以進度會暫時記喺<b>網址</b>度：請將而家個網址<b>加入書籤</b>，用書籤打開。換新網址前，記得去 <button data-go="stats">進度 → 備份</button> 匯出進度碼。 <button data-hide>收埋</button>`;
  n.hidden = false;
}
$("#notice").addEventListener("click", e => {
  if (e.target.dataset.go) switchTab(e.target.dataset.go);
  if (e.target.hasAttribute("data-hide")) { S.set.hideNotice = today(); save(); $("#notice").hidden = true; }
});

/* ============ audio ============ */
let player = null, voice = null;
window.__tts = [];                        // record of browser-TTS fallbacks (handy for testing)
function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices();
    voice = vs.find(v => /en[-_]GB/i.test(v.lang) && /Sonia|Libby|Natural|Google UK|Serena|Kate|Daniel/i.test(v.name))
      || vs.find(v => /en[-_]GB/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
  } catch (e) { }
}
if ("speechSynthesis" in window) { pickVoice(); try { speechSynthesis.onvoiceschanged = pickVoice; } catch (e) { } }
function stopAudio() { try { if (player) player.pause(); } catch (e) { } try { if ("speechSynthesis" in window) speechSynthesis.cancel(); } catch (e) { } }
function tts(text) {
  window.__tts.push(text);
  if (!("speechSynthesis" in window)) { toast("呢部機唔支援語音"); return; }
  try { const u = new SpeechSynthesisUtterance(text); u.lang = "en-GB"; if (voice) u.voice = voice; u.rate = 0.9; speechSynthesis.speak(u); }
  catch (e) { toast("播放唔到語音"); }
}
function speak(w, kind) {
  if (!w) return;
  const text = kind === "w" ? sayText(w) : w.example;
  if (!text) return;
  stopAudio();
  const src = AUDIO[w.id] && AUDIO[w.id][kind];
  if (src) {
    try { player = new Audio(src); const pr = player.play(); if (pr && pr.catch) pr.catch(() => tts(text)); return; } catch (e) { }
  }
  tts(text);
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-say]");
  if (!b) return;
  e.stopPropagation();
  speak(byId(b.dataset.id), b.dataset.say);
}, true);
const sayBtn = (w, kind, sm) => `<button class="speak${sm ? " sm" : ""}" data-say="${kind}" data-id="${esc(w.id)}" aria-label="${kind === "w" ? "讀出生字" : "讀出例句"}">🔊</button>`;

/* ============ SRS (Leitner) ============ */
function dueList() {
  const t = today();
  return allWords().filter(w => S.p[w.id] && S.p[w.id].d <= t)
    .sort((a, b) => S.p[a.id].d - S.p[b.id].d || S.p[a.id].b - S.p[b.id].b);
}
function newWords() { return allWords().filter(w => !S.p[w.id]); }
function newLeftToday() { return Math.max(0, S.set.newPerDay - ((S.log[today()] || {}).n || 0)); }
function markStudy(kind) {
  const t = today();
  if (!S.days.includes(t)) S.days.push(t);
  const L = S.log[t] || (S.log[t] = { r: 0, n: 0, q: 0 });
  L[kind] = (L[kind] || 0) + 1;
}
function nextBox(p, g) {
  if (!p) return g === 2 ? 2 : 1;
  if (g === 2) return Math.min(7, Math.max(1, p.b) + 1);
  if (g === 1) return Math.max(1, p.b - 1);
  return 1;
}
function nextDays(p, g) { return g === 2 ? IV[nextBox(p, g)] : 1; }
function grade(id, g) {             // g: 2 記得, 1 有啲唔確定, 0 唔記得
  const t = today(), old = S.p[id];
  const p = old ? Object.assign({}, old) : { b: 0, d: t, r: 0, l: 0, s: t, a: t };
  p.b = nextBox(old, g);
  p.d = t + nextDays(old, g);
  p.r += 1; p.s = t;
  if (g === 0) p.l += 1;
  S.p[id] = p;
  markStudy("r");
  if (!old) markStudy("n");
  save();
}
function streak() {
  const set = new Set(S.days); let t = today();
  if (!set.has(t)) t--;
  let n = 0; while (set.has(t)) { n++; t--; }
  return n;
}
const mastered = () => allWords().filter(w => S.p[w.id] && S.p[w.id].b >= 4).length;
const learned = () => allWords().filter(w => S.p[w.id]).length;

/* ============ tabs ============ */
let cur = "home";
function switchTab(name) {
  cur = name; stopAudio();
  $$("#nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  $$(".tab").forEach(s => { s.hidden = s.id !== "tab-" + name; });
  ({ home: renderHome, cards: renderCards, quiz: renderQuiz, bank: renderBank, stats: renderStats })[name]();
  window.scrollTo(0, 0);
  updateTop();
}
$("#nav").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) switchTab(b.dataset.tab); });
function updateTop() { const s = streak(); $("#topSub").textContent = s ? `🔥 連續 ${s} 日` : ""; }
function lessonSelect(id, val) {
  return `<select id="${id}" aria-label="揀課"><option value="">全部課 (${allWords().length})</option>${lessons().map(l =>
    `<option value="${esc(l)}"${l === val ? " selected" : ""}>${esc(l)} (${allWords().filter(w => w.lesson === l).length})</option>`).join("")}</select>`;
}

/* ============ 今日溫習 ============ */
let ses = null;
function startSession(extraNew) {
  const due = dueList().map(w => ({ id: w.id }));
  const nNew = extraNew != null ? extraNew : newLeftToday();
  const fresh = newWords().slice(0, nNew).map(w => ({ id: w.id, isNew: true }));
  ses = { q: due.concat(fresh), i: 0, shown: false, tally: [0, 0, 0], total: due.length + fresh.length };
  if (!ses.q.length) { ses = null; toast("而家冇字要溫 🎉"); }
  renderHome(true);
}
function renderHome(autoplay) {
  const el = $("#tab-home");
  if (ses) return renderSession(el, autoplay);
  const t = today(), d = new Date(t * DAY);
  const due = dueList().length, nw = Math.min(newLeftToday(), newWords().length), L = S.log[t] || {};
  const total = allWords().length;
  el.innerHTML = `
  <div class="panel">
    <div class="mute">${md(t)}（星期${WEEK[d.getUTCDay()]}）</div>
    <h2 style="margin-top:6px">今日溫習</h2>
    <div class="row" style="align-items:flex-end;gap:14px"><div class="big" id="dueCount">${due + nw}</div><div class="mute">個字要溫<br>複習 ${due}・新字 ${nw}</div></div>
    <button class="btn primary block mt" data-act="start" ${due + nw ? "" : "disabled"}>▶ 開始今日溫習</button>
    ${due + nw ? "" : `<p class="center" style="margin:12px 0 4px">今日已經溫晒 🎉 聽日再嚟！</p>
      ${newWords().length ? `<button class="btn block" data-act="more">➕ 想學多啲：加 5 個新字</button>` : ""}`}
  </div>
  <div class="grid3">
    <div class="stat"><b>${streak()}</b><small>🔥 連續日數</small></div>
    <div class="stat"><b>${L.r || 0}</b><small>今日溫咗</small></div>
    <div class="stat"><b>${mastered()}<span style="font-size:.9rem;color:var(--mute)">/${total}</span></b><small>已掌握</small></div>
  </div>
  <div class="panel mt">
    <h2>點樣溫？</h2>
    <div class="mute">睇英文，諗中文意思，再撳「顯示答案」。然後老實揀：<br>
    <b style="color:var(--ok)">記得</b> → 隔幾日先再出（越記得隔越耐）<br>
    <b style="color:var(--warn)">有啲唔確定</b> → 聽日再溫<br>
    <b style="color:var(--bad)">唔記得</b> → 今次再出多次，聽日再溫</div>
  </div>
  <div class="mute center">字庫 ${total} 個字・${lessons().length} 課・更新於 ${esc(BUILD.built)}</div>`;
}
function renderSession(el, autoplay) {
  if (ses.i >= ses.q.length) {
    const [bad, mid, good] = ses.tally;
    el.innerHTML = `<div class="panel center"><div style="font-size:3rem">🎉</div><h2>完成今日溫習！</h2>
      <p>記得 <b style="color:var(--ok)">${good}</b>・唔確定 <b style="color:var(--warn)">${mid}</b>・唔記得 <b style="color:var(--bad)">${bad}</b></p>
      <p class="mute">🔥 連續 ${streak()} 日</p><button class="btn primary block" data-act="home">返主頁</button></div>`;
    ses = null; updateTop(); return;
  }
  const it = ses.q[ses.i], w = byId(it.id);
  if (!w) { ses.i++; return renderSession(el, autoplay); }
  const p = S.p[w.id];
  const label = g => it.relearn ? (g === 0 ? "再出多次" : "聽日再溫") : (g === 0 ? "今次再出" : `${nextDays(p, g)} 日後`);
  el.innerHTML = `
  <div class="row" style="justify-content:space-between"><span class="mute" id="sesProg">今日溫習　${Math.min(ses.i + 1, ses.q.length)} / ${ses.q.length}</span>
    <span class="mute">${it.isNew && !it.relearn ? "🆕 新字" : it.relearn ? "🔁 再溫" : "第 " + (p ? p.b : 0) + " 級"}</span></div>
  <div class="meter"><i style="width:${ses.i / ses.q.length * 100}%"></i></div>
  <div class="wcard" id="revCard">
    <div class="lesson-tag">${esc(w.lesson)}</div>
    <div class="word">${esc(w.word)}</div>
    ${w.ipa ? `<div class="ipa">${esc(w.ipa)}</div>` : ""}
    ${sayBtn(w, "w")}
    ${ses.shown ? `<div class="answer"><span class="pos">${esc(w.pos)}</span><div class="zh">${esc(w.zh)}</div>
      ${w.example ? `<div class="ex">${esc(w.example)}</div>${w.example_zh ? `<div class="exzh">${esc(w.example_zh)}</div>` : ""}${sayBtn(w, "e", 1)}` : ""}</div>`
      : `<button class="btn primary block mt" data-act="show">👀 顯示答案</button>`}
  </div>
  ${ses.shown ? `<div class="grades">
    <button class="btn bad" data-grade="0">唔記得<small>${label(0)}</small></button>
    <button class="btn warn" data-grade="1">有啲唔確定<small>${label(1)}</small></button>
    <button class="btn ok" data-grade="2">記得<small>${label(2)}</small></button></div>` : ""}
  <button class="btn ghost block mt" data-act="pause">⏸ 暫停，遲啲再繼續</button>`;
  if (autoplay && S.set.auto && !ses.shown) speak(w, "w");
}
$("#tab-home").addEventListener("click", e => {
  const a = e.target.closest("[data-act],[data-grade]"); if (!a) return;
  const act = a.dataset.act;
  if (act === "start") startSession();
  else if (act === "more") startSession(5);
  else if (act === "home" || act === "pause") { ses = null; renderHome(); updateTop(); }
  else if (act === "show") { ses.shown = true; renderHome(); }
  else if (a.dataset.grade != null) {
    const g = +a.dataset.grade, it = ses.q[ses.i];
    if (!it.relearn) { grade(it.id, g); ses.tally[g]++; }
    if (g === 0 && (it.tries || 0) < 3) ses.q.push({ id: it.id, relearn: true, tries: (it.tries || 0) + 1 });
    ses.i++; ses.shown = false; renderHome(true); updateTop();
  }
});

/* ============ 閃卡 ============ */
const fc = { lesson: "", order: null, i: 0 };
function fcDeck() { return allWords().filter(w => !fc.lesson || w.lesson === fc.lesson).map(w => w.id); }
function renderCards() {
  const el = $("#tab-cards");
  if (!fc.order) fc.order = fcDeck();
  fc.order = fc.order.filter(id => byId(id));
  if (fc.i >= fc.order.length) fc.i = 0;
  const w = byId(fc.order[fc.i]);
  el.innerHTML = `<div class="panel" style="padding:12px">${lessonSelect("fcLesson", fc.lesson)}</div>
  ${w ? `<div class="row" style="justify-content:space-between;margin:0 4px 8px"><span class="mute">第 ${fc.i + 1} / ${fc.order.length} 張</span><span class="lvl l${S.p[w.id] ? S.p[w.id].b : 0}">${S.p[w.id] ? "第 " + S.p[w.id].b + " 級" : "未溫過"}</span></div>
  <div class="flip" id="flip"><div class="flip-inner">
    <div class="face front"><div class="wcard"><div class="lesson-tag">${esc(w.lesson)}</div><div class="word">${esc(w.word)}</div>${w.ipa ? `<div class="ipa">${esc(w.ipa)}</div>` : ""}${sayBtn(w, "w")}<div class="hint">撳卡片睇意思</div></div></div>
    <div class="face back"><div class="wcard"><span class="pos">${esc(w.pos)}</span><div class="zh">${esc(w.zh)}</div>${w.example ? `<div class="ex">${esc(w.example)}</div>${w.example_zh ? `<div class="exzh">${esc(w.example_zh)}</div>` : ""}${sayBtn(w, "e", 1)}` : ""}<div class="hint">撳卡片返去正面</div></div></div>
  </div></div>
  <div class="grid2 mt"><button class="btn" data-act="prev">◀ 上一張</button><button class="btn" data-act="next">下一張 ▶</button></div>
  <div class="grid2 mt"><button class="btn" data-act="shuffle">🔀 洗牌</button><button class="btn" data-act="order">↺ 原本次序</button></div>`
    : `<div class="panel center">呢課未有字。</div>`}`;
  $("#fcLesson").onchange = e => { fc.lesson = e.target.value; fc.order = fcDeck(); fc.i = 0; renderCards(); };
  const f = $("#flip");
  if (f) {
    f.addEventListener("click", () => f.classList.toggle("on"));
    let sx = null;
    f.addEventListener("touchstart", e => { sx = e.touches[0].clientX; }, { passive: true });
    f.addEventListener("touchend", e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 60) { e.preventDefault(); fcGo(dx < 0 ? 1 : -1); } });
  }
}
function fcGo(step) { const n = fc.order.length; if (!n) return; fc.i = (fc.i + step + n) % n; renderCards(); }
$("#tab-cards").addEventListener("click", e => {
  const a = e.target.closest("[data-act]"); if (!a) return;
  ({ prev: () => fcGo(-1), next: () => fcGo(1),
     shuffle: () => { fc.order = shuffle(fcDeck()); fc.i = 0; renderCards(); toast("已洗牌"); },
     order: () => { fc.order = fcDeck(); fc.i = 0; renderCards(); } })[a.dataset.act]();
});
document.addEventListener("keydown", e => {
  if (cur !== "cards" || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key === "ArrowRight") fcGo(1); else if (e.key === "ArrowLeft") fcGo(-1);
  else if (e.key === " ") { e.preventDefault(); const f = $("#flip"); if (f) f.classList.toggle("on"); }
});

/* ============ 測驗 ============ */
const qz = { phase: "setup", type: "spell", lesson: "", n: 10 };
const norm = s => String(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/[^a-z' -]+/g, " ").replace(/\s+/g, " ").trim();
function accepts(w) {
  const set = new Set();
  const add = s => { const n = norm(s); if (n) set.add(n); };
  add(w.word); add(w.word.replace(/\([^)]*\)/g, "")); add(w.word.replace(/[()]/g, "")); add(sayText(w));
  (w.accept || []).forEach(add);
  Array.from(set).forEach(s => { const m = s.match(/^(be|a|an|the|to) (.+)$/); if (m) set.add(m[2]); });
  return set;
}
function pattern(w) { return sayText(w).split(" ").map(t => t[0] + t.slice(1).replace(/[a-z]/gi, "_")).join("   ") + `（${sayText(w).replace(/[^a-z]/gi, "").length} 個字母）`; }
function startQuiz(items) {
  let pool = items || shuffle(allWords().filter(w => !qz.lesson || w.lesson === qz.lesson));
  if (!items && qz.n) pool = pool.slice(0, qz.n);
  if (qz.type === "mc" && allWords().length < 2) { toast("最少要有 2 個字先可以做選擇題"); return; }
  if (!pool.length) { toast("呢課未有字"); return; }
  Object.assign(qz, { phase: "q", items: pool.map(w => w.id), i: 0, score: 0, wrong: [], done: false, hint: false, choice: null });
  renderQuiz(true);
}
function mcOptions(w) {
  const others = shuffle(allWords().filter(x => x.id !== w.id && x.zh !== w.zh));
  const same = others.filter(x => x.pos === w.pos), rest = others.filter(x => x.pos !== w.pos);
  const picks = []; const seen = new Set([w.zh]);
  for (const x of same.concat(rest)) { if (picks.length >= 3) break; if (!seen.has(x.zh)) { seen.add(x.zh); picks.push(x); } }
  return shuffle(picks.concat([w]));
}
function renderQuiz(autoplay) {
  const el = $("#tab-quiz");
  if (qz.phase === "setup") {
    el.innerHTML = `<div class="panel"><h2>測驗</h2>
      <label class="f">題型</label>
      <div class="seg" id="qType"><button data-v="spell" class="${qz.type === "spell" ? "on" : ""}">✍️ 默書（中→英）</button><button data-v="mc" class="${qz.type === "mc" ? "on" : ""}">🔤 選擇題（英→中）</button></div>
      <label class="f">範圍</label>${lessonSelect("qLesson", qz.lesson)}
      <label class="f">題數</label>
      <div class="seg" id="qN">${[10, 20, 0].map(n => `<button data-v="${n}" class="${qz.n === n ? "on" : ""}">${n || "全部"}</button>`).join("")}</div>
      <button class="btn primary block mt" data-act="go">▶ 開始測驗</button></div>
      <div class="mute center">默書：睇中文，打英文（唔理大細楷）。選擇題：睇英文，揀中文意思。</div>`;
    $("#qType").onclick = e => { const b = e.target.closest("button"); if (b) { qz.type = b.dataset.v; renderQuiz(); } };
    $("#qN").onclick = e => { const b = e.target.closest("button"); if (b) { qz.n = +b.dataset.v; renderQuiz(); } };
    $("#qLesson").onchange = e => { qz.lesson = e.target.value; };
    return;
  }
  if (qz.phase === "done") {
    const n = qz.items.length, pct = Math.round(qz.score / n * 100);
    el.innerHTML = `<div class="panel center"><div style="font-size:2.6rem">${pct >= 80 ? "🏆" : pct >= 50 ? "👍" : "💪"}</div>
      <h2>得分 ${qz.score} / ${n}（${pct}%）</h2>
      ${qz.wrong.length ? `<p class="mute">要再溫：</p><ul class="list" style="text-align:left">${qz.wrong.map(id => { const w = byId(id); return w ? `<li><div class="head"><div class="t"><b>${esc(w.word)}</b> <span class="mute">${esc(w.zh)}</span></div>${sayBtn(w, "w", 1)}</div></li>` : ""; }).join("")}</ul>
      <button class="btn primary block mt" data-act="redo">🔁 重做錯咗嘅題目</button>` : "<p>全部啱晒！</p>"}
      <button class="btn block mt" data-act="again">再嚟一次</button><button class="btn ghost block mt" data-act="setup">返去揀題型</button></div>`;
    return;
  }
  const w = byId(qz.items[qz.i]);
  if (!w) { qz.i++; return qz.i >= qz.items.length ? (qz.phase = "done", renderQuiz()) : renderQuiz(); }
  const head = `<div class="row" style="justify-content:space-between"><span class="mute" id="qProg">第 ${qz.i + 1} / ${qz.items.length} 題</span><span class="mute">得分 ${qz.score}</span></div>
    <div class="meter"><i style="width:${qz.i / qz.items.length * 100}%"></i></div>`;
  const next = qz.done ? `<button class="btn primary block mt" data-act="next" id="qNext">${qz.i + 1 < qz.items.length ? "下一題 ▶" : "睇結果"}</button>` : "";
  if (qz.type === "spell") {
    el.innerHTML = head + `<div class="wcard" style="min-height:0">
      <span class="pos">${esc(w.pos)}</span><div class="zh">${esc(w.zh)}</div>
      ${w.example_zh ? `<div class="exzh">例：${esc(w.example_zh)}</div>` : ""}
      ${qz.hint && !qz.done ? `<div class="ipa pat">${esc(pattern(w))}</div>` : ""}
      <input type="text" id="spellIn" class="spell" placeholder="打英文" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" value="${esc(qz.typed || "")}" ${qz.done ? "disabled" : ""}>
      ${qz.done ? `<div class="feedback ${qz.ok ? "good" : "badc"}" id="qFeedback">${qz.ok ? "✓ 啱晒！" : "✗ 正確答案：" + esc(w.word)}</div>
        ${w.ipa ? `<div class="ipa">${esc(w.ipa)}</div>` : ""}${w.example ? `<div class="ex">${esc(w.example)}</div>` : ""}
        <div class="row" style="justify-content:center">${sayBtn(w, "w", 1)}${w.example ? sayBtn(w, "e", 1) : ""}</div>`
      : `<div class="grid3" style="width:100%;margin-top:6px"><button class="btn small" data-act="hint">💡 提示</button><button class="btn small" data-say="w" data-id="${esc(w.id)}">🔊 聽讀音</button><button class="btn small primary" data-act="check">對答案</button></div>`}
    </div>` + next;
    const inp = $("#spellIn");
    if (!qz.done) { inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); checkSpell(); } }); inp.addEventListener("input", () => { qz.typed = inp.value; }); }
  } else {
    if (!qz.opts || qz.optsFor !== w.id) { qz.opts = mcOptions(w).map(x => x.id); qz.optsFor = w.id; }
    el.innerHTML = head + `<div class="wcard" style="min-height:0">
      <div class="word">${esc(w.word)}</div>${w.ipa ? `<div class="ipa">${esc(w.ipa)}</div>` : ""}${sayBtn(w, "w")}
      <div class="opts" id="mcOpts">${qz.opts.map(id => { const x = byId(id); let c = "";
        if (qz.done) { if (id === w.id) c = "right"; else if (id === qz.choice) c = "wrong"; }
        return `<button data-opt="${esc(id)}" class="${c}" ${qz.done ? "disabled" : ""}>${esc(x.zh)} <span class="mute">${esc(x.pos)}</span></button>`; }).join("")}</div>
      ${qz.done ? `<div class="feedback ${qz.ok ? "good" : "badc"}" id="qFeedback">${qz.ok ? "✓ 啱晒！" : "✗ 正確係：" + esc(w.zh)}</div>${w.example ? `<div class="ex">${esc(w.example)}</div>${sayBtn(w, "e", 1)}` : ""}` : ""}
    </div>` + next;
    if (autoplay && S.set.auto && !qz.done) speak(w, "w");
  }
}
function finishQ(ok) {
  qz.done = true; qz.ok = ok;
  if (ok) qz.score++; else qz.wrong.push(qz.items[qz.i]);
  renderQuiz();
  speak(byId(qz.items[qz.i]), "w");
}
function checkSpell() {
  const w = byId(qz.items[qz.i]), v = $("#spellIn").value;
  if (!norm(v)) { toast("先打個答案啦"); return; }
  qz.typed = v; finishQ(accepts(w).has(norm(v)));
}
$("#tab-quiz").addEventListener("click", e => {
  const o = e.target.closest("[data-opt]");
  if (o && !qz.done) { qz.choice = o.dataset.opt; finishQ(qz.choice === qz.items[qz.i]); return; }
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act;
  if (act === "go" || act === "again") startQuiz();
  else if (act === "redo") startQuiz(shuffle(qz.wrong.map(byId).filter(Boolean)));
  else if (act === "setup") { qz.phase = "setup"; renderQuiz(); }
  else if (act === "hint") { qz.hint = true; renderQuiz(); }
  else if (act === "check") checkSpell();
  else if (act === "next") {
    qz.i++; qz.done = false; qz.hint = false; qz.typed = ""; qz.choice = null;
    if (qz.i >= qz.items.length) { qz.phase = "done"; markStudy("q"); save(); updateTop(); }
    renderQuiz(true);
    const inp = $("#spellIn"); if (inp) inp.focus();
  }
});

/* ============ 字庫 ============ */
const bk = { q: "", lesson: "", open: null, adding: false, arm: null };
function renderBank() {
  const el = $("#tab-bank");
  el.innerHTML = `<div class="panel" style="padding:12px">
    <input type="search" id="bkQ" placeholder="🔍 搜尋英文、中文或例句" value="${esc(bk.q)}" autocapitalize="off">
    <div class="mt">${lessonSelect("bkLesson", bk.lesson)}</div>
    <button class="btn block mt" data-act="add">${bk.adding ? "✕ 收埋新增表格" : "➕ 新增生字"}</button>
    <div id="addForm"></div></div>
  <div class="mute" id="bkCount" style="margin:0 6px 6px"></div><ul class="list" id="bkList"></ul>`;
  $("#bkQ").addEventListener("input", e => { bk.q = e.target.value; renderBankList(); });
  $("#bkLesson").onchange = e => { bk.lesson = e.target.value; renderBankList(); };
  if (bk.adding) renderAddForm();
  renderBankList();
}
function renderBankList() {
  const q = bk.q.trim().toLowerCase();
  const ws = allWords().filter(w => (!bk.lesson || w.lesson === bk.lesson) &&
    (!q || [w.word, w.zh, w.example, w.example_zh, w.pos].some(s => s && String(s).toLowerCase().includes(q))));
  $("#bkCount").textContent = `共 ${ws.length} 個字`;
  $("#bkList").innerHTML = ws.map(w => {
    const p = S.p[w.id], open = bk.open === w.id;
    return `<li data-row="${esc(w.id)}"><div class="head"><div class="t"><b>${esc(w.word)}</b> <span class="ipa" style="font-size:.95rem">${esc(w.ipa || "")}</span><br><span class="mute">${esc(w.pos)}</span> ${esc(w.zh)}</div>
      <span class="lvl l${p ? p.b : 0}">${p ? "第 " + p.b + " 級" : "新"}</span>${sayBtn(w, "w", 1)}</div>
      ${open ? `<div class="detail">${w.example ? `<div class="row"><div style="flex:1"><i>${esc(w.example)}</i>${w.example_zh ? `<br><span class="mute">${esc(w.example_zh)}</span>` : ""}</div>${sayBtn(w, "e", 1)}</div>` : ""}
        <div class="mute mt">${esc(w.lesson)}・加入於 ${esc(w.added || "")}${p ? `・下次溫習：${p.d <= today() ? "今日" : md(p.d)}` : ""}${AUDIO[w.id] ? "" : "・🔈 用瀏覽器語音"}</div>
        ${w.custom ? `<button class="btn small mt ${bk.arm === w.id ? "bad" : "ghost"}" data-del="${esc(w.id)}">${bk.arm === w.id ? "再撳一次確認刪除" : "🗑 刪除呢個字"}</button>` : ""}</div>` : ""}</li>`;
  }).join("") || `<li class="center mute">搵唔到</li>`;
}
function renderAddForm() {
  $("#addForm").innerHTML = `<div class="mt">
    <label class="f">英文 *</label><input type="text" id="aw" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="e.g. ambitious">
    <label class="f">中文 *</label><input type="text" id="azh" placeholder="例如：有野心嘅">
    <label class="f">詞性</label><select id="apos">${POS.map(p => `<option>${p}</option>`).join("")}</select>
    <label class="f">音標 IPA（可以留空）</label><input type="text" id="aipa" placeholder="/æmˈbɪʃəs/">
    <label class="f">例句（可以留空）</label><input type="text" id="aex" autocapitalize="sentences" placeholder="She is very ambitious.">
    <label class="f">例句中文（可以留空）</label><input type="text" id="aexzh">
    <label class="f">課 / 標籤</label><input type="text" id="alesson" list="lessonList" value="我自己加嘅字"><datalist id="lessonList">${lessons().map(l => `<option value="${esc(l)}">`).join("")}</datalist>
    <div id="aMsg" class="danger mt"></div>
    <button class="btn primary block mt" data-act="saveword">💾 儲存生字</button>
    <div class="mute mt">自己加嘅字會用瀏覽器語音讀出，並會包括喺「匯出進度」入面。</div></div>`;
}
$("#tab-bank").addEventListener("click", e => {
  const d = e.target.closest("[data-del]");
  if (d) {
    const id = d.dataset.del;
    if (bk.arm !== id) { bk.arm = id; renderBankList(); return; }
    S.custom = S.custom.filter(w => w.id !== id); delete S.p[id]; invalidate(); save(); bk.arm = null; bk.open = null;
    toast("已刪除"); renderBank(); return;
  }
  const a = e.target.closest("[data-act]");
  if (a && a.dataset.act === "add") { bk.adding = !bk.adding; renderBank(); return; }
  if (a && a.dataset.act === "saveword") {
    const v = id => $("#" + id).value.trim();
    if (!v("aw") || !v("azh")) { $("#aMsg").textContent = "英文同中文一定要填。"; return; }
    const w = { id: "u-" + Date.now().toString(36), word: v("aw"), ipa: v("aipa"), pos: $("#apos").value, zh: v("azh"),
      example: v("aex"), example_zh: v("aexzh"), lesson: v("alesson") || "我自己加嘅字", added: isoDay(today()) };
    S.custom.push(w); invalidate(); save(); fc.order = null;
    bk.adding = false; bk.open = w.id; bk.q = ""; toast("已加入：" + w.word); renderBank(); return;
  }
  const row = e.target.closest("[data-row]");
  if (row && !e.target.closest("button")) { bk.open = bk.open === row.dataset.row ? null : row.dataset.row; bk.arm = null; renderBankList(); }
});

/* ============ 進度 + 備份 ============ */
function renderStats() {
  const el = $("#tab-stats"), t = today(), total = allWords().length;
  const boxes = Array(8).fill(0); allWords().forEach(w => { boxes[S.p[w.id] ? S.p[w.id].b : 0]++; });
  const reviews = Object.values(S.p).reduce((s, p) => s + (p.r || 0), 0);
  const days = Array.from({ length: 14 }, (_, k) => t - 13 + k), mx = Math.max(1, ...days.map(d => (S.log[d] || {}).r || 0));
  const boxName = ["未學", "第 1 級（1 日）", "第 2 級（2 日）", "第 3 級（4 日）", "第 4 級（7 日）", "第 5 級（15 日）", "第 6 級（30 日）", "第 7 級（60 日）"];
  el.innerHTML = `
  <div class="grid3">
    <div class="stat"><b id="stStreak">${streak()}</b><small>🔥 連續日數</small></div>
    <div class="stat"><b>${learned()}</b><small>已學</small></div>
    <div class="stat"><b>${mastered()}</b><small>已掌握 (≥第4級)</small></div>
    <div class="stat"><b>${total}</b><small>字庫總數</small></div>
    <div class="stat"><b>${(S.log[t] || {}).r || 0}</b><small>今日溫咗</small></div>
    <div class="stat"><b>${reviews}</b><small>累計溫習</small></div>
  </div>
  <div class="panel mt"><h2>最近 14 日</h2>
    <div class="bars">${days.map(d => `<div class="${d === t ? "today" : ""}" style="height:${((S.log[d] || {}).r || 0) / mx * 100}%" title="${md(d)}：${(S.log[d] || {}).r || 0}"></div>`).join("")}</div>
    <div class="bars-x">${days.map(d => `<span>${new Date(d * DAY).getUTCDate()}</span>`).join("")}</div></div>
  <div class="panel"><h2>記憶等級</h2>${boxes.map((n, b) => n || b === 0 ? `<div class="row" style="justify-content:space-between"><span>${boxName[b]}</span><span class="mute">${n}</span></div><div class="meter"><i style="width:${n / Math.max(1, total) * 100}%;background:${b === 0 ? "#9aa8b8" : b < 4 ? "#e0a030" : "var(--ok)"}"></i></div>` : "").join("")}</div>
  <div class="panel"><h2>每課進度</h2>${lessons().map(l => { const ws = allWords().filter(w => w.lesson === l), k = ws.filter(w => S.p[w.id]).length, m = ws.filter(w => S.p[w.id] && S.p[w.id].b >= 4).length;
    return `<div class="row" style="justify-content:space-between"><span>${esc(l)}</span><span class="mute">學咗 ${k}/${ws.length}・掌握 ${m}</span></div><div class="meter"><i style="width:${k / ws.length * 100}%"></i></div>`; }).join("")}</div>
  <div class="panel"><h2>設定</h2>
    <label class="f">每日新字數目</label><div class="seg" id="setNew">${[5, 10, 15, 20].map(n => `<button data-v="${n}" class="${S.set.newPerDay === n ? "on" : ""}">${n}</button>`).join("")}</div>
    <label class="f">自動讀出生字</label><div class="seg" id="setAuto"><button data-v="1" class="${S.set.auto ? "on" : ""}">開</button><button data-v="0" class="${S.set.auto ? "" : "on"}">關</button></div></div>
  <div class="panel" id="backup"><h2>💾 備份 / 匯入進度</h2>
    <div class="mute" id="storeStatus">${store.mode === "ls" ? "✅ 進度自動儲存喺呢部機嘅瀏覽器。換手機或者換網址前，記得匯出進度碼。" : "⚠️ 呢個網址唔可以用瀏覽器儲存：進度暫時記喺網址（請加書籤）。換網址前一定要匯出進度碼！"}</div>
    <div class="grid2 mt"><button class="btn" data-act="export">📤 匯出進度碼</button><button class="btn" data-act="download">⬇️ 下載備份檔</button></div>
    <textarea id="exportBox" class="mt" readonly placeholder="撳「匯出進度碼」之後，進度碼會喺度出現" hidden></textarea>
    <button class="btn small mt" data-act="copy" id="copyBtn" hidden>📋 複製進度碼</button>
    <label class="f mt">匯入：貼上進度碼（或者揀備份檔），會同而家嘅進度合併</label>
    <textarea id="importBox" placeholder="喺度貼上 V1… 開頭嘅進度碼"></textarea>
    <div class="grid2 mt"><button class="btn primary" data-act="import">📥 匯入進度碼</button><label class="btn center" style="display:block">📂 揀備份檔<input type="file" id="importFile" accept=".txt,text/plain" hidden></label></div>
    <div id="bkMsg" class="mt"></div></div>
  <div class="panel"><h2>其他</h2>
    <button class="btn small ${statsArm ? "bad" : "ghost"}" data-act="reset">${statsArm ? "再撳一次：真係清除所有溫習進度" : "🗑 清除所有溫習進度"}</button>
    <p class="mute">字庫更新於 ${esc(BUILD.built)}・${WORDS.length} 個內置字（${Object.keys(AUDIO).length} 個有真人錄音，其餘用瀏覽器語音）・自己加咗 ${S.custom.length} 個</p></div>`;
  $("#setNew").onclick = e => { const b = e.target.closest("button"); if (b) { S.set.newPerDay = +b.dataset.v; save(); renderStats(); } };
  $("#setAuto").onclick = e => { const b = e.target.closest("button"); if (b) { S.set.auto = b.dataset.v === "1"; save(); renderStats(); } };
  $("#importFile").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { await doImport(await f.text()); } catch (err) { bkMsg("❌ " + err.message, true); }
  };
}
let statsArm = false;
function bkMsg(m, bad) { const el = $("#bkMsg"); if (el) { el.textContent = m; el.className = "mt " + (bad ? "danger" : ""); } toast(m); }
async function doImport(text) {
  const st = await decodeState(text);
  S = mergeState(S, st); invalidate(); fc.order = null; await flush();
  renderStats(); updateTop();
  bkMsg(`✅ 匯入成功：而家已學 ${learned()} 個字、連續 ${streak()} 日`);
}
$("#tab-stats").addEventListener("click", async e => {
  const a = e.target.closest("[data-act]"); if (!a) return;
  const act = a.dataset.act;
  if (act === "export") {
    const code = await encodeState(S), box = $("#exportBox");
    box.hidden = false; box.value = code; $("#copyBtn").hidden = false; box.focus(); box.select();
    bkMsg(`已產生進度碼（${code.length} 個字元）。撳「複製」或者長按全選複製，貼去 WhatsApp / 備忘錄保存。`);
  } else if (act === "copy") {
    const box = $("#exportBox"); let ok = false;
    try { await navigator.clipboard.writeText(box.value); ok = true; } catch (err) { }
    if (!ok) { try { box.select(); box.setSelectionRange(0, box.value.length); ok = document.execCommand("copy"); } catch (err) { } }
    bkMsg(ok ? "📋 已複製" : "自動複製唔到，請長按上面嘅文字 → 全選 → 複製", !ok);
  } else if (act === "download") {
    const code = await encodeState(S);
    try {
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(new Blob([code + "\n"], { type: "text/plain" }));
      a2.download = `vocab-progress-${isoDay(today())}.txt`; document.body.appendChild(a2); a2.click(); a2.remove();
      bkMsg("已嘗試下載。如果冇檔案出現（有啲網站會封鎖下載），請用「匯出進度碼」再複製。");
    } catch (err) { bkMsg("下載唔到，請用「匯出進度碼」。", true); }
  } else if (act === "import") {
    try { await doImport($("#importBox").value); } catch (err) { bkMsg("❌ " + err.message, true); }
  } else if (act === "reset") {
    if (!statsArm) { statsArm = true; renderStats(); setTimeout(() => { if (statsArm) { statsArm = false; if (cur === "stats") renderStats(); } }, 5000); return; }
    statsArm = false; const keep = S.custom, set = S.set; S = fresh(); S.custom = keep; S.set = set; invalidate(); ses = null; await flush();
    toast("已清除溫習進度（自己加嘅字保留咗）"); renderStats(); updateTop();
  }
});

/* ============ boot ============ */
(async function boot() {
  await load();
  showNotice();
  switchTab("home");
  window.__ready = true;
})();
