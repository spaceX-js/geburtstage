// Erinnerungen: welche fällig sind, Push-Nachrichten, E-Mail und Kalender-Abo.
// runReminders() läuft stündlich (Cron in wrangler.jsonc) und verschickt ab der eingestellten Uhrzeit alles, was heute fällig ist.
import * as O from "../public/occasions.js";
import { generateVapid, sendPush } from "./push.js";

export const DEFAULT_DAYS = [30, 15, 7, 0];
export const DEFAULT_HOUR = 9;
export const TZ = "Europe/Berlin";

/* ---------- Einstellungen ---------- */
export function reminderConfig(s) {
  let days = DEFAULT_DAYS;
  try { const d = JSON.parse(s.remind_days || "null"); if (Array.isArray(d)) days = checkDays(d) || DEFAULT_DAYS; } catch (e) {}
  const h = Number(s.remind_hour);
  let emails = {};
  try { const e = JSON.parse(s.emails || "{}"); if (e && typeof e === "object") emails = e; } catch (e) {}
  return { days, hour: Number.isInteger(h) && h >= 0 && h <= 23 && s.remind_hour !== undefined ? h : DEFAULT_HOUR,
    holidays: s.remind_holidays !== "0", emails };
}
// Vorlauf in Tagen: 0 (am Tag selbst) bis 90, höchstens 6 verschiedene
export function checkDays(list) {
  if (!Array.isArray(list) || list.length > 6) return null;
  const out = [];
  for (const v of list) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 90) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => b - a);
}
export const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,180}\.[A-Za-z]{2,24}$/;

/* ---------- Welche Erinnerungen sind heute fällig? ---------- */
const HOL = new Set(O.HOLIDAY_KEYS);
function giftLine(p, o, gifts, ideas, inDays) {
  const gs = gifts.filter(g => g.person_id === p.id && g.occasion === o.key && g.year === o.year);
  const real = gs.filter(g => g.status !== "nichts");
  const label = { idee: "Idee", gekauft: "gekauft", verpackt: "verpackt", ueberreicht: "überreicht" };
  if (real.length) return "Geschenk: " + real.map(g => g.title + " (" + (label[g.status] || g.status) + ")").join(", ");
  if (gs.length) return "";
  const n = ideas.filter(i => i.person_id === p.id).length;
  if (n) return "Noch kein Geschenk – " + (n === 1 ? "1 Idee" : n + " Ideen") + " notiert";
  const usesGifts = p.budget_min != null || p.budget_max != null || gifts.some(g => g.person_id === p.id);
  return usesGifts && inDays >= 3 ? "Noch kein Geschenk geplant" : "";
}
const inText = n => n === 0 ? "heute" : n === 1 ? "morgen" : "in " + n + " Tagen";

export function dueReminders(persons, gifts, ideas, cfg, today) {
  const max = Math.max(0, ...cfg.days);
  const list = O.upcoming(persons, today, max + 1);
  const out = [], holGroups = new Map();
  for (const o of list) {
    const p = persons.find(x => x.id === o.personId);
    if (!p || p.remind === "aus") continue;
    if (HOL.has(o.key)) {
      if (!cfg.holidays || o.inDays === 0 || !cfg.days.includes(o.inDays)) continue;
      const k = o.key + "|" + o.date;
      if (!holGroups.has(k)) holGroups.set(k, { o, persons: [] });
      holGroups.get(k).persons.push(p);
      continue;
    }
    const leads = p.remind === "tag" ? [0] : cfg.days;
    if (!leads.includes(o.inDays)) continue;
    const n = o.inDays, bday = o.key === "geburtstag";
    let title;
    if (bday) title = n === 0 ? (o.age ? "🎂 Heute wird " + p.name + " " + o.age : "🎂 Heute hat " + p.name + " Geburtstag")
      : n === 1 ? "🎂 Morgen hat " + p.name + " Geburtstag" : p.name + " hat in " + n + " Tagen Geburtstag";
    else title = (n === 0 ? "Heute: " : "") + O.occTitle(o) + " von " + p.name + (n === 0 ? "" : " " + inText(n));
    const parts = [];
    if (n > 0) parts.push(O.fmtDate(o.date, { weekday: true }) + (bday && o.age ? " · wird " + o.age : ""));
    if (o.round) parts.push(bday ? "Runder Geburtstag!" : "Jubiläum!");
    if (n === 0 && bday) parts.push("Gratulieren nicht vergessen 🎉");
    const g = giftLine(p, o, gifts, ideas, n); if (g) parts.push(g);
    out.push({ key: p.id + "|" + o.key + "|" + o.date + "|" + n, title, body: parts.join("\n"), url: "/#p=" + p.id, tag: "gb-" + p.id + "-" + o.key, date: o.date, inDays: n });
  }
  for (const { o, persons: ps } of holGroups.values()) {
    const planned = ps.filter(p => gifts.some(g => g.person_id === p.id && g.occasion === o.key && g.year === o.year)).length;
    out.push({ key: "hol|" + o.key + "|" + o.date + "|" + o.inDays, title: "🎁 " + o.label + " " + inText(o.inDays),
      body: "Geschenke für " + ps.map(p => p.name).join(", ") + " · " + planned + " von " + ps.length + " geplant",
      url: "/#geschenke", tag: "gb-" + o.key, date: o.date, inDays: o.inDays });
  }
  out.sort((a, b) => a.inDays - b.inDays || a.title.localeCompare(b.title));
  return out;
}

/* ---------- Push ---------- */
async function getSettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
  const s = {}; for (const r of results) s[r.key] = r.value; return s;
}
export async function ensureVapid(env, settings) {
  if (settings.vapid_public && settings.vapid_private) return { publicKey: settings.vapid_public, privateJwk: JSON.parse(settings.vapid_private) };
  const v = await generateVapid();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_public', ?)").bind(v.publicKey),
    env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_private', ?)").bind(JSON.stringify(v.privateJwk))
  ]);
  const s = await getSettings(env);
  return { publicKey: s.vapid_public, privateJwk: JSON.parse(s.vapid_private) };
}
export async function deliver(env, subs, message, origin) {
  const vapid = await ensureVapid(env, await getSettings(env));
  return Promise.all(subs.map(async sub => {
    let status = 0;
    try { status = await sendPush(sub, message, vapid, origin, env.PUSH_FETCH || fetch); } catch (e) { status = 0; }
    if (status === 404 || status === 410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(sub.endpoint).run();
    return status;
  }));
}

/* ---------- E-Mail ---------- */
// Braucht in wrangler.jsonc eine send_email-Bindung „EMAIL“ und die Variable MAIL_FROM (Absender auf einer eigenen Domain bei Cloudflare).
export const emailReady = env => !!(env.EMAIL && env.MAIL_FROM);
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function buildEmail(items, origin) {
  const plain = t => t.replace(/^\p{Extended_Pictographic}️?\s*/u, "");
  const subject = items.length === 1 ? plain(items[0].title) : items.length + " Erinnerungen: " + items.map(i => plain(i.title)).join(" · ");
  const text = items.map(i => "• " + i.title + (i.body ? "\n  " + i.body.replace(/\n/g, "\n  ") : "")).join("\n\n") + "\n\n" + (origin ? "Zur App: " + origin + "/" : "");
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.45;color:#1f1b18">' +
    items.map(i => '<p style="margin:0 0 14px"><b>' + escHtml(i.title) + "</b>" + (i.body ? "<br>" + escHtml(i.body).replace(/\n/g, "<br>") : "") + "</p>").join("") +
    (origin ? '<p style="margin:18px 0 0"><a href="' + escHtml(origin) + '/" style="color:#b4493a">Geburtstage öffnen</a></p>' : "") + "</div>";
  return { subject: subject.slice(0, 200), text, html };
}
export async function sendMail(env, to, mail) {
  await env.EMAIL.send({ to, from: env.MAIL_FROM, subject: mail.subject, text: mail.text, html: mail.html });
}

/* ---------- Stündlicher Lauf ---------- */
function hourIn(tz, now) {
  try { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now)); } catch (e) { return now.getUTCHours(); }
}
export async function runReminders(env, now = new Date(), loadState) {
  const settings = await getSettings(env);
  const cfg = reminderConfig(settings);
  if (hourIn(TZ, now) < cfg.hour) return [];
  const today = O.todayIn(TZ, now);
  const { persons, gifts, ideas } = await loadState(env);
  const items = dueReminders(persons, gifts, ideas, cfg, today);
  if (!items.length) return [];
  // schon verschickte aussortieren
  const done = new Set();
  for (let i = 0; i < items.length; i += 50) {
    const part = items.slice(i, i + 50).map(x => x.key);
    const { results } = await env.DB.prepare("SELECT key FROM reminders_sent WHERE key IN (" + part.map(() => "?").join(",") + ")").bind(...part).all();
    for (const r of results) done.add(r.key);
  }
  const fresh = items.filter(x => !done.has(x.key));
  if (!fresh.length) return [];
  const at = now.toISOString();
  await env.DB.batch(fresh.map(x => env.DB.prepare("INSERT OR IGNORE INTO reminders_sent (key, at) VALUES (?, ?)").bind(x.key, at)));
  const origin = settings.origin || "";
  // Push an alle angemeldeten Geräte (beide)
  const subs = (await env.DB.prepare("SELECT endpoint, p256dh, auth, person FROM push_subs").all()).results;
  if (subs.length) for (const x of fresh) await deliver(env, subs, { title: x.title, body: x.body, tag: x.tag, url: x.url }, origin || "https://geburtstage.app");
  // E-Mail: eine Sammel-Mail pro Adresse
  if (emailReady(env)) {
    const mail = buildEmail(fresh, origin);
    for (const addr of Object.values(cfg.emails)) {
      if (typeof addr === "string" && EMAIL_RE.test(addr)) { try { await sendMail(env, addr, mail); } catch (e) { console.log("E-Mail an " + addr + " fehlgeschlagen: " + (e && e.message)); } }
    }
  }
  await env.DB.prepare("DELETE FROM reminders_sent WHERE at < ?").bind(new Date(now.getTime() - 400 * 86400000).toISOString()).run();
  return fresh;
}

/* ---------- Kalender-Abo (iCal) ---------- */
const icsEsc = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line) {
  // Zeilen über 75 Byte umbrechen (iCal-Regel), ohne UTF-8-Zeichen zu zerteilen
  const enc = new TextEncoder(); const out = []; let cur = "", len = 0;
  for (const ch of line) {
    const l = enc.encode(ch).length;
    if (len + l > (out.length ? 74 : 75)) { out.push(cur); cur = ""; len = 0; }
    cur += ch; len += l;
  }
  out.push(cur);
  return out.join("\r\n ");
}
export function buildIcs(persons, today, now = new Date()) {
  const from = O.addDays(today, -60);
  const list = O.upcoming(persons, from, 60 + 731).filter(o => !HOL.has(o.key));
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Geburtstage//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Geburtstage", "X-WR-TIMEZONE:Europe/Berlin", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const o of list) {
    const p = persons.find(x => x.id === o.personId);
    const d = o.date.replace(/-/g, ""), next = O.addDays(o.date, 1).replace(/-/g, "");
    const summary = o.key === "geburtstag" ? "🎂 " + p.name + (o.age ? " (" + o.age + ")" : "") : "⭐ " + p.name + ": " + O.occTitle(o);
    lines.push("BEGIN:VEVENT", "UID:" + p.id + "-" + o.key.replace(":", "-") + "-" + o.year + "@geburtstage", "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + d, "DTEND;VALUE=DATE:" + next, "SUMMARY:" + icsEsc(summary), "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
