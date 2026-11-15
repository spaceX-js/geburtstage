// Geschenke – Cloudflare Worker
// Bindungen: DB (D1-Datenbank „geschenke-db“) und ASSETS (Ordner public/).
// Das Passwort liegt nur als Hash in der Datenbank (Tabelle settings).
// Beim allerersten Aufruf (noch kein Passwort gespeichert) legt man das gemeinsame Passwort fest.
import { HOLIDAY_KEYS } from "../public/occasions.js";

const COOKIE = "gs_session";
const ITER = 100000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OCC_RE = /^(geburtstag|weihnachten|nikolaus|ostern|valentinstag|muttertag|vatertag|x:[A-Za-z0-9_-]{1,40})$/;
const STATUS = ["idee", "gekauft", "verpackt", "ueberreicht", "nichts"];
const PEOPLE_DEFAULT = ["Jonas", "Clara"];

export default {
  async fetch(request, env, ctx) {
    try {
      if (!env.DB) return text("Einrichtung unvollständig: Die Datenbank-Verbindung „DB“ fehlt.", 500);
      const url = new URL(request.url);
      const path = url.pathname;

      // Öffentlich: Icon und Manifest (für „Zum Home-Bildschirm“)
      if (path === "/icon.png" || path === "/icon-512.png" || path === "/manifest.webmanifest") return env.ASSETS.fetch(request);

      const settings = await getSettings(env);
      if (path === "/login" && request.method === "POST") return settings.pw_hash ? login(request, env, settings) : setup(request, env, settings);
      if (path === "/logout") return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });

      const authed = await isAuthed(request, settings);

      if (path.startsWith("/api/")) {
        if (!authed) return json({ error: "Nicht angemeldet." }, 401);
        return await api(request, env, settings, url);
      }
      if (!authed) {
        if (path === "/" || path === "/index.html") return html(loginPage(url.searchParams.get("fehler"), !settings.pw_hash));
        return new Response(null, { status: 302, headers: { Location: "/" } });
      }
      // Angemeldet: Seite und Skripte aus dem Ordner public/ (immer frisch, damit Updates sofort ankommen)
      const res = await env.ASSETS.fetch(path === "/index.html" ? new Request(new URL("/", url), request) : request);
      return withHeaders(res, { "Cache-Control": "no-cache", ...SEC });
    } catch (e) {
      return json({ error: "Serverfehler: " + (e && e.message ? e.message : e) }, 500);
    }
  }
};

/* ---------- API ---------- */
async function api(request, env, settings, url) {
  const path = url.pathname, method = request.method;

  if (path === "/api/state" && method === "GET") {
    const rev = Number(settings.rev || 0);
    if (url.searchParams.get("rev") === String(rev)) return json({ rev, same: true });
    const [p, i, g] = await env.DB.batch([
      env.DB.prepare("SELECT * FROM persons ORDER BY name COLLATE NOCASE"),
      env.DB.prepare("SELECT * FROM ideas ORDER BY created_at DESC"),
      env.DB.prepare("SELECT * FROM gifts ORDER BY year DESC, created_at DESC")
    ]);
    return json({ rev, people: people(settings), persons: p.results.map(personOut), ideas: i.results.map(ideaOut), gifts: g.results.map(giftOut) });
  }

  if (path === "/api/person" && method === "POST") {
    const p = checkPerson(await readJson(request), people(settings));
    if (!p) return json({ error: "Ungültige Angaben zur Person." }, 400);
    const now = new Date().toISOString();
    const res = await env.DB.batch([
      env.DB.prepare(`INSERT INTO persons (id, name, relation, bday_day, bday_month, bday_year, holidays, extra, interests, dislikes, notes, budget_min, budget_max, responsible, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, relation = excluded.relation, bday_day = excluded.bday_day, bday_month = excluded.bday_month,
          bday_year = excluded.bday_year, holidays = excluded.holidays, extra = excluded.extra, interests = excluded.interests, dislikes = excluded.dislikes,
          notes = excluded.notes, budget_min = excluded.budget_min, budget_max = excluded.budget_max, responsible = excluded.responsible, updated_at = excluded.updated_at`)
        .bind(p.id, p.name, p.relation, p.bday_day, p.bday_month, p.bday_year, p.holidays.join("|"), JSON.stringify(p.extra), p.interests.join("|"), p.dislikes, p.notes,
          p.budget_min, p.budget_max, p.responsible, now, now),
      bumpRev(env)
    ]);
    return json({ ok: true, rev: revOf(res[1]) });
  }

  if (path === "/api/person/delete" && method === "POST") {
    const id = idOf(await readJson(request));
    if (!id) return json({ error: "Ungültige Anfrage." }, 400);
    const res = await env.DB.batch([
      env.DB.prepare("DELETE FROM gifts WHERE person_id = ?").bind(id),
      env.DB.prepare("DELETE FROM ideas WHERE person_id = ?").bind(id),
      env.DB.prepare("DELETE FROM persons WHERE id = ?").bind(id),
      bumpRev(env)
    ]);
    return json({ ok: true, rev: revOf(res[3]) });
  }

  if (path === "/api/idea" && method === "POST") {
    const it = checkIdea(await readJson(request), people(settings));
    if (!it) return json({ error: "Ungültige Idee." }, 400);
    const now = new Date().toISOString();
    const res = await env.DB.batch([
      env.DB.prepare(`INSERT INTO ideas (id, person_id, text, link, price, added_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET person_id = excluded.person_id, text = excluded.text, link = excluded.link, price = excluded.price, updated_at = excluded.updated_at`)
        .bind(it.id, it.person_id, it.text, it.link, it.price, it.added_by, it.created_at || now, now),
      bumpRev(env)
    ]);
    return json({ ok: true, rev: revOf(res[1]) });
  }

  if (path === "/api/gift" && method === "POST") {
    const g = checkGift(await readJson(request), people(settings));
    if (!g) return json({ error: "Ungültiges Geschenk." }, 400);
    const now = new Date().toISOString();
    const res = await env.DB.batch([
      env.DB.prepare(`INSERT INTO gifts (id, person_id, occasion, year, title, price, status, rating, note, who, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET person_id = excluded.person_id, occasion = excluded.occasion, year = excluded.year, title = excluded.title, price = excluded.price,
          status = excluded.status, rating = excluded.rating, note = excluded.note, who = excluded.who, updated_at = excluded.updated_at`)
        .bind(g.id, g.person_id, g.occasion, g.year, g.title, g.price, g.status, g.rating, g.note, g.who, g.created_at || now, now),
      bumpRev(env)
    ]);
    return json({ ok: true, rev: revOf(res[1]) });
  }

  for (const [kind, table] of [["idea", "ideas"], ["gift", "gifts"]]) {
    if (path === "/api/" + kind + "/delete" && method === "POST") {
      const id = idOf(await readJson(request));
      if (!id) return json({ error: "Ungültige Anfrage." }, 400);
      const res = await env.DB.batch([env.DB.prepare("DELETE FROM " + table + " WHERE id = ?").bind(id), bumpRev(env)]);
      return json({ ok: true, rev: revOf(res[1]) });
    }
  }

  if (path === "/api/password" && method === "POST") {
    const b = await readJson(request);
    if (!b || typeof b.new !== "string" || b.new.length < 8) return json({ error: "Das neue Passwort braucht mindestens 8 Zeichen." }, 400);
    if (!(await checkPassword(String(b.old || ""), settings))) { await sleep(1000); return json({ error: "Das aktuelle Passwort stimmt nicht." }, 400); }
    const salt = randomHex(16), hash = await pbkdf2(b.new, salt), secret = randomHex(32);
    await env.DB.batch([setSetting(env, "pw_salt", salt), setSetting(env, "pw_hash", hash), setSetting(env, "session_secret", secret)]);
    return json({ ok: true }, 200, { "Set-Cookie": cookie(await sessionToken(secret)) });
  }

  return json({ error: "Nicht gefunden." }, 404);
}

/* ---------- Ausgabe ---------- */
const split = v => String(v || "").split("|").map(x => x.trim()).filter(Boolean);
function parseExtra(v) { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function personOut(r) {
  return { id: r.id, name: r.name, relation: r.relation || "", bday_day: r.bday_day ?? null, bday_month: r.bday_month ?? null, bday_year: r.bday_year ?? null,
    holidays: split(r.holidays), extra: parseExtra(r.extra), interests: split(r.interests), dislikes: r.dislikes || "", notes: r.notes || "",
    budget_min: r.budget_min ?? null, budget_max: r.budget_max ?? null, responsible: r.responsible || "", created_at: r.created_at, updated_at: r.updated_at };
}
function ideaOut(r) { return { id: r.id, person_id: r.person_id, text: r.text, link: r.link || "", price: r.price ?? null, added_by: r.added_by || "", created_at: r.created_at }; }
function giftOut(r) {
  return { id: r.id, person_id: r.person_id, occasion: r.occasion, year: r.year, title: r.title, price: r.price ?? null, status: r.status, rating: r.rating || 0,
    note: r.note || "", who: r.who || "", created_at: r.created_at, updated_at: r.updated_at };
}

/* ---------- Prüfen ---------- */
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/\s+/g, " ");
function intOrNull(v, min, max) {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;   // undefined = ungültig
}
function validDay(d, m, y) {
  if (!d || !m) return false;
  const max = new Date(Date.UTC(y || 2000, m, 0)).getUTCDate();       // ohne Jahr: Schaltjahr annehmen, damit der 29.2. geht
  return d >= 1 && d <= max;
}
const idOf = b => (b && typeof b.id === "string" && ID_RE.test(b.id)) ? b.id : null;
const isoOrNull = v => (typeof v === "string" && v.length <= 40 && !isNaN(Date.parse(v))) ? new Date(v).toISOString() : null;
const thisYear = () => new Date().getUTCFullYear();

export function checkPerson(b, names = PEOPLE_DEFAULT) {
  if (!idOf(b)) return null;
  const name = oneLine(b.name, 80);
  if (!name) return null;
  const day = intOrNull(b.bday_day, 1, 31), month = intOrNull(b.bday_month, 1, 12), year = intOrNull(b.bday_year, 1900, thisYear());
  if (day === undefined || month === undefined || year === undefined) return null;
  if ((day === null) !== (month === null)) return null;                // Tag und Monat nur zusammen
  if (day !== null && !validDay(day, month, year)) return null;
  if (day === null && year !== null) return null;
  const bmin = intOrNull(b.budget_min, 0, 100000), bmax = intOrNull(b.budget_max, 0, 100000);
  if (bmin === undefined || bmax === undefined) return null;
  if (bmin !== null && bmax !== null && bmin > bmax) return null;
  const holidays = [...new Set((Array.isArray(b.holidays) ? b.holidays : []).filter(h => HOLIDAY_KEYS.includes(h)))];
  const extra = [];
  const seen = new Set();
  for (const x of Array.isArray(b.extra) ? b.extra.slice(0, 10) : []) {
    if (!x || typeof x.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(x.id) || seen.has(x.id)) return null;
    const d = intOrNull(x.d, 1, 31), m = intOrNull(x.m, 1, 12), y = intOrNull(x.y, 1900, thisYear() + 1);
    if (!d || !m || y === undefined || !validDay(d, m, y)) return null;
    const label = oneLine(x.label, 40) || "Termin";
    seen.add(x.id); extra.push(y ? { id: x.id, label, d, m, y } : { id: x.id, label, d, m });
  }
  const interests = [];
  for (const t of Array.isArray(b.interests) ? b.interests.slice(0, 30) : []) {
    const c = oneLine(t, 40).replace(/\|/g, "/");
    if (c && !interests.some(i => i.toLowerCase() === c.toLowerCase())) interests.push(c);
  }
  return {
    id: b.id, name, relation: oneLine(b.relation, 40), bday_day: day, bday_month: month, bday_year: year, holidays, extra, interests,
    dislikes: clean(b.dislikes, 1000), notes: clean(b.notes, 3000), budget_min: bmin, budget_max: bmax,
    responsible: names.includes(b.responsible) ? b.responsible : ""
  };
}

export function checkIdea(b, names = PEOPLE_DEFAULT) {
  if (!idOf(b) || typeof b.person_id !== "string" || !ID_RE.test(b.person_id)) return null;
  const text = clean(b.text, 300);
  if (!text) return null;
  const price = intOrNull(b.price, 0, 100000);
  if (price === undefined) return null;
  return { id: b.id, person_id: b.person_id, text, link: cleanLink(b.link), price, added_by: names.includes(b.added_by) ? b.added_by : "", created_at: isoOrNull(b.created_at) };
}

export function checkGift(b, names = PEOPLE_DEFAULT) {
  if (!idOf(b) || typeof b.person_id !== "string" || !ID_RE.test(b.person_id)) return null;
  if (typeof b.occasion !== "string" || !OCC_RE.test(b.occasion)) return null;
  const year = intOrNull(b.year, 1950, thisYear() + 2);
  if (!year) return null;
  const title = oneLine(b.title, 160);
  if (!title) return null;
  const price = intOrNull(b.price, 0, 100000);
  if (price === undefined) return null;
  const status = STATUS.includes(b.status) ? b.status : "idee";
  const rating = intOrNull(b.rating, 0, 3) || 0;
  return { id: b.id, person_id: b.person_id, occasion: b.occasion, year, title, price, status, rating, note: clean(b.note, 1000),
    who: names.includes(b.who) ? b.who : "", created_at: isoOrNull(b.created_at) };
}
// Nur echte Web-Adressen (http/https) zulassen
export function cleanLink(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s || s.length > 600) return "";
  try { const u = new URL(s); return (u.protocol === "https:" || u.protocol === "http:") ? u.href : ""; } catch (e) { return ""; }
}

function people(settings) { try { const p = JSON.parse(settings.people || "null"); if (Array.isArray(p) && p.length) return p.map(String); } catch (e) {} return PEOPLE_DEFAULT; }

/* ---------- Anmeldung ---------- */
// Erster Aufruf: gemeinsames Passwort festlegen (nur solange noch keins gespeichert ist)
async function setup(request, env, settings) {
  const form = await request.formData();
  const pw = String(form.get("passwort") || ""), pw2 = String(form.get("passwort2") || "");
  if (pw.length < 8) return redirect("/?fehler=kurz");
  if (pw !== pw2) return redirect("/?fehler=ungleich");
  const salt = randomHex(16), hash = await pbkdf2(pw, salt), secret = randomHex(32);
  // INSERT OR IGNORE: Wenn gleichzeitig jemand anderes ein Passwort festlegt, gewinnt das erste
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('pw_salt', ?)").bind(salt),
    env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('pw_hash', ?)").bind(hash),
    env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('session_secret', ?)").bind(secret)
  ]);
  const s = await getSettings(env);
  if (s.pw_hash !== hash) return redirect("/?fehler=falsch");
  return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": cookie(await sessionToken(s.session_secret)) } });
}
async function login(request, env, settings) {
  const form = await request.formData();
  const pw = String(form.get("passwort") || "");
  const ip = request.headers.get("CF-Connecting-IP") || "unbekannt";
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts > ?").bind(ip, since).first();
  if (row && row.n >= 10) return redirect("/?fehler=gesperrt");
  if (!(await checkPassword(pw, settings))) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_attempts (ip, ts) VALUES (?, ?)").bind(ip, new Date().toISOString()),
      env.DB.prepare("DELETE FROM login_attempts WHERE ts < ?").bind(new Date(Date.now() - 86400000).toISOString())
    ]);
    await sleep(800);
    return redirect("/?fehler=falsch");
  }
  return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": cookie(await sessionToken(settings.session_secret)) } });
}
function cookie(token) { return `${COOKIE}=${token}; Path=/; Max-Age=34560000; HttpOnly; Secure; SameSite=Lax`; }
async function isAuthed(request, settings) {
  if (!settings.session_secret) return false;
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([a-f0-9]+)"));
  return !!m && safeEqual(m[1], await sessionToken(settings.session_secret));
}
async function checkPassword(pw, s) {
  if (!s.pw_salt || !s.pw_hash) return false;
  return safeEqual(await pbkdf2(pw, s.pw_salt), s.pw_hash);
}
export async function pbkdf2(pw, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations: ITER }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}
async function sessionToken(secretHex) {
  const key = await crypto.subtle.importKey("raw", hexToBytes(secretHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("geschenke-session-v1"));
  return bytesToHex(new Uint8Array(sig));
}

/* ---------- Datenbank ---------- */
async function getSettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
  const s = {}; for (const r of results) s[r.key] = r.value; return s;
}
function setSetting(env, k, v) { return env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v); }
function bumpRev(env) { return env.DB.prepare("INSERT INTO settings (key, value) VALUES ('rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) RETURNING value"); }
function revOf(res) { const r = res && res.results && res.results[0]; return r ? Number(r.value) : null; }

/* ---------- Hilfsfunktionen ---------- */
const SEC = { "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
function withHeaders(res, h) { const r = new Response(res.body, res); for (const [k, v] of Object.entries(h)) r.headers.set(k, v); return r; }
function html(body) { return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SEC } }); }
function json(o, status = 200, extra = {}) { return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SEC, ...extra } }); }
function text(t, status = 200) { return new Response(t, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
function redirect(to) { return new Response(null, { status: 303, headers: { Location: to } }); }
async function readJson(req) { try { return await req.json(); } catch (e) { return null; } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomHex(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return bytesToHex(b); }
function bytesToHex(b) { return Array.from(b, x => x.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(h) { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
function safeEqual(a, b) { if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

function loginPage(fehler, first) {
  const msgs = { falsch: "Das Passwort stimmt nicht.", gesperrt: "Zu viele Versuche. Bitte in 15 Minuten nochmal probieren.",
    kurz: "Das Passwort braucht mindestens 8 Zeichen.", ungleich: "Die beiden Passwörter sind nicht gleich." };
  const msg = msgs[fehler] || "";
  const form = first
    ? `<p>Willkommen! Legt einmalig euer gemeinsames Passwort fest (mindestens 8 Zeichen).</p>${msg ? `<div class="err">${msg}</div>` : ""}
<form method="post" action="/login"><input type="password" name="passwort" autocomplete="new-password" placeholder="Neues Passwort" minlength="8" required autofocus>
<input type="password" name="passwort2" autocomplete="new-password" placeholder="Passwort wiederholen" minlength="8" required>
<button type="submit">Passwort festlegen</button></form>`
    : `<p>Bitte gib euer Passwort ein.</p>${msg ? `<div class="err">${msg}</div>` : ""}
<form method="post" action="/login"><input type="password" name="passwort" autocomplete="current-password" placeholder="Passwort" required autofocus>
<button type="submit">Anmelden</button></form>`;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Geschenke"><meta name="robots" content="noindex, nofollow">
<link rel="apple-touch-icon" href="/icon.png"><link rel="icon" href="/icon.png"><link rel="manifest" href="/manifest.webmanifest">
<title>Geschenke – Anmelden</title>
<style>
:root{--bg:#f4f0ec;--card:#fff;--ink:#1f1b18;--mute:#72675f;--line:#e8e0d8;--acc:#b4493a;--acc-ink:#fff;--bad:#b3261e}
@media (prefers-color-scheme: dark){:root{--bg:#161312;--card:#211c1a;--ink:#f3ede8;--mute:#a89d95;--line:#3a322e;--acc:#f0927f;--acc-ink:#2a120d;--bad:#f28b82}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:400px;margin:0 auto;padding:calc(env(safe-area-inset-top) + 60px) 24px 40px;text-align:center}
img{width:76px;height:76px;border-radius:18px}h1{font-size:26px;margin:16px 0 6px}p{color:var(--mute);margin:0 0 24px;font-size:15px}
input{width:100%;font-size:17px;padding:13px 14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);margin-bottom:12px;-webkit-appearance:none}
input:focus{outline:2px solid var(--acc);outline-offset:-1px}
button{width:100%;min-height:50px;border:0;border-radius:13px;background:var(--acc);color:var(--acc-ink);font:600 17px -apple-system,sans-serif}
.err{color:var(--bad);font-size:15px;margin:0 0 12px}
</style></head><body><main>
<img src="/icon.png" alt=""><h1>Geschenke</h1>
${form}</main></body></html>`;
}
