// Erinnerungen: welche fällig sind, Push-Nachrichten und Kalender-Abo.
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
  return { days, hour: Number.isInteger(h) && h >= 0 && h <= 23 && s.remind_hour !== undefined ? h : DEFAULT_HOUR,
    holidays: s.remind_holidays !== "0" };
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

/* ---------- Welche Erinnerungen sind heute fällig? ---------- */
const HOL = new Set(O.HOLIDAY_KEYS);
// Budget einer Person für einen Anlass als Text ("bis 100 €", "50–80 €") oder ""
export function budgetFor(p, key) {
  const b = p && p.budgets && p.budgets[key];
  if (!b) return "";
  const a = b.min ?? null, z = b.max ?? null;
  if (a != null && z != null) return a === z ? a + " €" : a + "–" + z + " €";
  if (z != null) return "bis " + z + " €";
  if (a != null) return "ab " + a + " €";
  return "";
}
function giftLine(p, key, year, gifts, ideas, inDays) {
  const gs = gifts.filter(g => g.person_id === p.id && g.occasion === key && g.year === year);
  const real = gs.filter(g => g.status !== "nichts");
  const label = { idee: "Idee", gekauft: "gekauft", verpackt: "verpackt", ueberreicht: "überreicht" };
  if (real.length) return "Geschenk: " + real.map(g => g.title + " (" + (label[g.status] || g.status) + ")").join(", ");
  if (gs.length) return "";
  const budget = budgetFor(p, key);
  const n = ideas.filter(i => i.person_id === p.id).length;
  if (n) return "Noch kein Geschenk – " + (n === 1 ? "1 Idee" : n + " Ideen") + " notiert" + (budget ? " · Budget " + budget : "");
  const usesGifts = budget || gifts.some(g => g.person_id === p.id);
  return usesGifts && inDays >= 3 ? "Noch kein Geschenk geplant" + (budget ? " · Budget " + budget : "") : "";
}
const inText = n => n === 0 ? "heute" : n === 1 ? "morgen" : "in " + n + " Tagen";

// Fällige Erinnerungen für einen Empfänger („viewer“ = "Jonas", "Clara" oder "" wenn unbekannt).
// Geschenk-Infos über den Empfänger selbst bleiben geheim; an den eigenen Geburtstag wird man nicht erinnert.
export function dueReminders(persons, gifts, ideas, cfg, today, viewer = "") {
  const max = Math.max(0, ...cfg.days);
  const list = O.mergeCouple(O.upcoming(persons, today, max + 1), persons);
  const me = persons.find(p => p.self && p.self === viewer);
  const partnerId = O.partnerOf(persons, viewer);
  // Geschenke über diese Personen darf der Empfänger nicht sehen (ohne bekannten Empfänger: über beide Ehepartner nicht)
  const secret = new Set(persons.filter(p => p.self && (!viewer || p.self === viewer)).map(p => p.id));
  const out = [], holGroups = new Map();
  for (const o of list) {
    const p = persons.find(x => x.id === o.personId);
    if (!p || p.remind === "aus") continue;
    if (HOL.has(o.key)) {
      if (!cfg.holidays || o.inDays === 0 || !cfg.days.includes(o.inDays) || secret.has(p.id)) continue;
      const k = o.key + "|" + o.date;
      if (!holGroups.has(k)) holGroups.set(k, { o, persons: [] });
      holGroups.get(k).persons.push(p);
      continue;
    }
    if (me && o.key === "geburtstag" && p.id === me.id) continue;
    const leads = p.remind === "tag" ? [0] : cfg.days;
    if (!leads.includes(o.inDays)) continue;
    const n = o.inDays, bday = o.key === "geburtstag";
    let title, giftP = p, giftKey = o.key, url = "/#p=" + p.id;
    if (o.couple) {
      const ours = me && o.members.some(m => m.personId === me.id);
      const names = o.members.map(m => persons.find(x => x.id === m.personId).name).join(" & ");
      title = ours ? "💍 " + (n === 0 ? "Heute ist euer " : "Euer ") + O.occTitle(o) + (n === 0 ? "" : " " + inText(n)) : (n === 0 ? "Heute: " : "") + O.occTitle(o) + " von " + names + (n === 0 ? "" : " " + inText(n));
      const pm = o.members.find(m => m.personId === partnerId);
      giftP = pm ? persons.find(x => x.id === pm.personId) : null; giftKey = pm ? pm.key : null;
      url = pm ? "/#p=" + pm.personId : url;
    } else if (bday) title = n === 0 ? (o.age ? "🎂 Heute wird " + p.name + " " + o.age : "🎂 Heute hat " + p.name + " Geburtstag")
      : n === 1 ? "🎂 Morgen hat " + p.name + " Geburtstag" : p.name + " hat in " + n + " Tagen Geburtstag";
    else title = (n === 0 ? "Heute: " : "") + O.occTitle(o) + " von " + p.name + (n === 0 ? "" : " " + inText(n));
    const parts = [];
    if (n > 0) parts.push(O.fmtDate(o.date, { weekday: true }) + (bday && o.age ? " · wird " + o.age : ""));
    if (o.round) parts.push(bday ? "Runder Geburtstag!" : "Jubiläum!");
    if (n === 0 && bday) parts.push("Gratulieren nicht vergessen 🎉");
    if (giftP && !secret.has(giftP.id)) { const g = giftLine(giftP, giftKey, o.year, gifts, ideas, n); if (g) parts.push(g); }
    out.push({ key: (o.couple ? "paar" : p.id) + "|" + o.key + "|" + o.date + "|" + n + "|" + (viewer || "-"), title, body: parts.join("\n"), url,
      tag: "gb-" + p.id + "-" + o.key, date: o.date, inDays: n });
  }
  for (const { o, persons: ps } of holGroups.values()) {
    const planned = ps.filter(p => gifts.some(g => g.person_id === p.id && g.occasion === o.key && g.year === o.year)).length;
    out.push({ key: "hol|" + o.key + "|" + o.date + "|" + o.inDays + "|" + (viewer || "-"), title: "🎁 " + o.label + " " + inText(o.inDays),
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

/* ---------- Stündlicher Lauf ---------- */
function hourIn(tz, now) {
  try { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now)); } catch (e) { return now.getUTCHours(); }
}
export async function runReminders(env, now = new Date(), loadState) {
  const settings = await getSettings(env);
  const cfg = reminderConfig(settings);
  if (hourIn(TZ, now) < cfg.hour) return [];
  const subs = (await env.DB.prepare("SELECT endpoint, p256dh, auth, person FROM push_subs").all()).results;
  if (!subs.length) return [];
  const today = O.todayIn(TZ, now);
  const { persons, gifts, ideas } = await loadState(env);
  const origin = settings.origin || "";
  const sentNow = [];
  // Jede Person bekommt ihre eigene Fassung (ohne Geschenk-Infos über sich selbst)
  const viewers = [...new Set(subs.map(s => s.person || ""))];
  for (const viewer of viewers) {
    const items = dueReminders(persons, gifts, ideas, cfg, today, viewer);
    if (!items.length) continue;
    const done = new Set();
    for (let i = 0; i < items.length; i += 50) {
      const part = items.slice(i, i + 50).map(x => x.key);
      const { results } = await env.DB.prepare("SELECT key FROM reminders_sent WHERE key IN (" + part.map(() => "?").join(",") + ")").bind(...part).all();
      for (const r of results) done.add(r.key);
    }
    const fresh = items.filter(x => !done.has(x.key));
    if (!fresh.length) continue;
    await env.DB.batch(fresh.map(x => env.DB.prepare("INSERT OR IGNORE INTO reminders_sent (key, at) VALUES (?, ?)").bind(x.key, now.toISOString())));
    const mine = subs.filter(s => (s.person || "") === viewer);
    for (const x of fresh) await deliver(env, mine, { title: x.title, body: x.body, tag: x.tag, url: x.url }, origin || "https://geburtstage.app");
    sentNow.push(...fresh.map(x => ({ ...x, viewer })));
  }
  await env.DB.prepare("DELETE FROM reminders_sent WHERE at < ?").bind(new Date(now.getTime() - 400 * 86400000).toISOString()).run();
  return sentNow;
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
  const list = O.mergeCouple(O.upcoming(persons, from, 60 + 731).filter(o => !HOL.has(o.key)), persons);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Geburtstage//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Geburtstage", "X-WR-TIMEZONE:Europe/Berlin", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const o of list) {
    const p = persons.find(x => x.id === o.personId);
    const d = o.date.replace(/-/g, ""), next = O.addDays(o.date, 1).replace(/-/g, "");
    const summary = o.key === "geburtstag" ? "🎂 " + p.name + (o.age ? " (" + o.age + ")" : "")
      : o.couple ? "💍 " + o.members.map(m => persons.find(x => x.id === m.personId).name).join(" & ") + ": " + O.occTitle(o)
      : "⭐ " + p.name + ": " + O.occTitle(o);
    lines.push("BEGIN:VEVENT", "UID:" + p.id + "-" + o.key.replace(":", "-") + "-" + o.year + "@geburtstage", "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + d, "DTEND;VALUE=DATE:" + next, "SUMMARY:" + icsEsc(summary), "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
