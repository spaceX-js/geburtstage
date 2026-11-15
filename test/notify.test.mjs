// Testet Erinnerungen, Push-Versand, E-Mail und Kalender-Abo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { loadState } from "../src/index.js";
import { dueReminders, runReminders, buildIcs, reminderConfig, checkDays, buildEmail } from "../src/notify.js";
import { b64u } from "../src/push.js";

function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../d1-schema.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({ sql, args, bind: (...a) => stmt(sql, a.map(v => v === undefined ? null : v)),
    async all() { return { results: db.prepare(sql).all(...args) }; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async run() { return run(sql, args); } });
  function run(sql, args) { const p = db.prepare(sql); if (/returning|^\s*select/i.test(sql)) return { results: p.all(...args) }; p.run(...args); return { results: [] }; }
  return { raw: db, prepare: sql => stmt(sql), async batch(l) { db.exec("BEGIN"); try { const o = l.map(s => run(s.sql, s.args)); db.exec("COMMIT"); return o; } catch (e) { db.exec("ROLLBACK"); throw e; } } };
}
const ASSETS = { fetch: async req => new Response("x " + new URL(req.url).pathname) };
const call = (env, path, opts = {}) => worker.fetch(new Request("https://gb.test" + path, opts), env, { waitUntil() {} });
const form = o => { const fd = new FormData(); for (const k in o) fd.set(k, o[k]); return fd; };
const post = (env, ck, path, body) => call(env, path, { method: "POST", headers: { Cookie: ck, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = (env, ck, path) => call(env, path, { headers: { Cookie: ck } });
async function ready(extra = {}) {
  const sent = [], mails = [];
  const env = { DB: makeD1(), ASSETS, PUSH_FETCH: async (u, o) => { sent.push({ u, o }); return new Response(null, { status: 201 }); },
    EMAIL: { send: async m => { mails.push(m); return { messageId: "1" }; } }, MAIL_FROM: "gb@example.org", ...extra };
  const res = await call(env, "/login", { method: "POST", body: form({ passwort: "geheim123", passwort2: "geheim123" }) });
  return { env, ck: res.headers.get("Set-Cookie").split(";")[0], sent, mails };
}
async function fakeSub() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { endpoint: "https://push.example.com/abc", keys: { p256dh: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
}

const P = (o) => ({ id: "p", name: "Anna", bday_day: null, bday_month: null, bday_year: null, holidays: [], extra: [], remind: "", budget_min: null, budget_max: null, ...o });
const cfg = { days: [30, 15, 7, 0], hour: 9, holidays: true, emails: {} };

test("fällige Erinnerungen: Vorlauf, am Tag selbst, nur am Tag, aus", () => {
  const persons = [
    P({ id: "a", name: "Anna", bday_day: 22, bday_month: 11, bday_year: 1996 }),          // in 7 Tagen, wird 30
    P({ id: "b", name: "Ben", bday_day: 15, bday_month: 11 }),                            // heute
    P({ id: "c", name: "Cleo", bday_day: 22, bday_month: 11, remind: "tag" }),           // in 7 Tagen, aber nur am Tag
    P({ id: "d", name: "Dora", bday_day: 15, bday_month: 11, remind: "aus" }),           // aus
    P({ id: "e", name: "Emil", bday_day: 16, bday_month: 11 })                            // morgen – 1 ist kein Vorlauf
  ];
  const r = dueReminders(persons, [], [], cfg, "2026-11-15");
  assert.deepEqual(r.map(x => x.title), ["🎂 Heute hat Ben Geburtstag", "Anna hat in 7 Tagen Geburtstag"]);
  assert.match(r[1].body, /So 22\. Nov\. · wird 30/);
  assert.match(r[1].body, /Runder Geburtstag/);
  assert.equal(r[1].url, "/#p=a");
});

test("Geschenk-Zeile und Feiertage", () => {
  const persons = [P({ id: "a", name: "Anna", bday_day: 22, bday_month: 11, holidays: ["weihnachten"] }), P({ id: "b", name: "Ben", holidays: ["weihnachten"] })];
  const gifts = [{ person_id: "a", occasion: "geburtstag", year: 2026, title: "Kochkurs", status: "gekauft" }, { person_id: "b", occasion: "weihnachten", year: 2026, title: "Buch", status: "idee" }];
  let r = dueReminders(persons, gifts, [], cfg, "2026-11-15");
  assert.match(r[0].body, /Geschenk: Kochkurs \(gekauft\)/);
  r = dueReminders(persons, gifts, [], cfg, "2026-11-24");    // 30 Tage vor Weihnachten
  assert.equal(r.length, 1);
  assert.equal(r[0].title, "🎁 Weihnachten in 30 Tagen");
  assert.equal(r[0].body, "Geschenke für Anna, Ben · 1 von 2 geplant");
  assert.equal(dueReminders(persons, gifts, [], { ...cfg, holidays: false }, "2026-11-24").length, 0);
  // Ideen, aber noch kein Geschenk
  r = dueReminders([P({ id: "x", name: "Xa", bday_day: 22, bday_month: 11 })], [], [{ person_id: "x" }, { person_id: "x" }], cfg, "2026-11-15");
  assert.match(r[0].body, /Noch kein Geschenk – 2 Ideen notiert/);
});

test("eigene Termine", () => {
  const r = dueReminders([P({ id: "a", name: "Anna", extra: [{ id: "h", label: "Hochzeitstag", d: 15, m: 11, y: 2016 }] })], [], [], cfg, "2026-11-15");
  assert.equal(r[0].title, "Heute: 10. Hochzeitstag von Anna");
});

test("Einstellungen lesen", () => {
  assert.deepEqual(reminderConfig({}), { days: [30, 15, 7, 0], hour: 9, holidays: true, emails: {} });
  assert.deepEqual(reminderConfig({ remind_days: "[1,3]", remind_hour: "7", remind_holidays: "0" }).days, [3, 1]);
  assert.equal(checkDays([1, 2, 3, 4, 5, 6, 7]), null);
  assert.equal(checkDays([-1]), null);
  assert.deepEqual(checkDays([0, 7, 7]), [7, 0]);
  assert.equal(buildEmail([{ title: "🎂 Heute hat Ben Geburtstag", body: "" }], "").subject, "Heute hat Ben Geburtstag");
});

test("stündlicher Lauf: erst ab der Uhrzeit, jede Erinnerung nur einmal, Push und E-Mail", async () => {
  const { env, ck, sent, mails } = await ready();
  await post(env, ck, "/api/person", { id: "a", name: "Anna", bday_day: 22, bday_month: 11, bday_year: 1996 });
  await post(env, ck, "/api/person", { id: "b", name: "Ben", bday_day: 15, bday_month: 11 });
  await post(env, ck, "/api/push/subscribe", { ...(await fakeSub()), person: "Jonas" });
  let r = await post(env, ck, "/api/settings", { email: { person: "Clara", address: "clara@example.org" } });
  assert.equal(r.status, 200);
  assert.equal((await post(env, ck, "/api/settings", { email: { person: "Clara", address: "kaputt" } })).status, 400);

  // 15.11.2026, 7:30 Uhr in Berlin (6:30 UTC) – noch zu früh
  assert.equal((await runReminders(env, new Date("2026-11-15T06:30:00Z"), loadState)).length, 0);
  // 9:05 Uhr in Berlin
  let out = await runReminders(env, new Date("2026-11-15T08:05:00Z"), loadState);
  assert.equal(out.length, 2);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].o.headers["Content-Encoding"], "aes128gcm");
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, "clara@example.org");
  assert.equal(mails[0].from, "gb@example.org");
  assert.match(mails[0].subject, /^2 Erinnerungen: Heute hat Ben Geburtstag · Anna hat in 7 Tagen Geburtstag$/);
  // eine Stunde später: nichts doppelt
  out = await runReminders(env, new Date("2026-11-15T09:05:00Z"), loadState);
  assert.equal(out.length, 0); assert.equal(sent.length, 2);
  // Uhrzeit ändern → am nächsten Tag erst ab 18 Uhr
  await post(env, ck, "/api/settings", { remind_hour: 18, remind_days: [6, 0] });
  assert.equal((await runReminders(env, new Date("2026-11-16T10:00:00Z"), loadState)).length, 0);
  out = await runReminders(env, new Date("2026-11-16T17:00:00Z"), loadState);
  assert.deepEqual(out.map(x => x.title), ["Anna hat in 6 Tagen Geburtstag"]);
});

test("ohne E-Mail-Einrichtung: nur Push, Test-Mail meldet Fehler", async () => {
  const { env, ck, mails } = await ready({ EMAIL: undefined });
  const st = await (await get(env, ck, "/api/state")).json();
  assert.equal(st.settings.email_ready, false);
  assert.deepEqual(st.settings.remind_days, [30, 15, 7, 0]);
  await post(env, ck, "/api/settings", { email: { person: "Jonas", address: "j@example.org" } });
  assert.equal((await post(env, ck, "/api/email/test", { person: "Jonas" })).status, 400);
  await post(env, ck, "/api/person", { id: "b", name: "Ben", bday_day: 15, bday_month: 11 });
  assert.equal((await runReminders(env, new Date("2026-11-15T10:00:00Z"), loadState)).length, 1);
  assert.equal(mails.length, 0);
});

test("Test-Push und Test-Mail", async () => {
  const { env, ck, sent, mails } = await ready();
  const sub = await fakeSub();
  assert.equal((await post(env, ck, "/api/push/test", { endpoint: sub.endpoint })).status, 400);
  await post(env, ck, "/api/push/subscribe", { ...sub, person: "Clara" });
  assert.equal((await post(env, ck, "/api/push/test", { endpoint: sub.endpoint })).status, 200);
  assert.equal(sent.length, 1);
  await post(env, ck, "/api/settings", { email: { person: "Jonas", address: "j@example.org" } });
  assert.equal((await post(env, ck, "/api/email/test", { person: "Jonas" })).status, 200);
  assert.equal(mails[0].to, "j@example.org");
});

test("Kalender-Abo: nur mit geheimem Link, neuer Link macht alten ungültig", async () => {
  const { env, ck } = await ready();
  await post(env, ck, "/api/person", { id: "a", name: "Anna, die Große", bday_day: 3, bday_month: 12, bday_year: 1996, holidays: ["weihnachten"] });
  const { url } = await (await get(env, ck, "/api/calendar")).json();
  assert.match(url, /^https:\/\/gb\.test\/kalender\/[a-f0-9]{32}\.ics$/);
  const again = await (await get(env, ck, "/api/calendar")).json();
  assert.equal(again.url, url);
  const path = new URL(url).pathname;
  const res = await call(env, path);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /text\/calendar/);
  const ics = await res.text();
  assert.match(ics, /SUMMARY:🎂 Anna\\, die Große \(\d+\)/);
  assert.doesNotMatch(ics, /Weihnachten/);
  assert.equal((await call(env, "/kalender/" + "0".repeat(32) + ".ics")).status, 404);
  const neu = await (await post(env, ck, "/api/calendar/new", {})).json();
  assert.notEqual(neu.url, url);
  assert.equal((await call(env, path)).status, 404);
});

test("iCal: Zeilen höchstens 75 Byte, CRLF", () => {
  const ics = buildIcs([P({ id: "a", name: "Ein sehr langer Name mit Ümlauten ".repeat(3), bday_day: 1, bday_month: 1 })], "2026-11-15", new Date("2026-11-15T00:00:00Z"));
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.match(ics, /DTSTART;VALUE=DATE:20270101/);
});

test("Erinnerungs-Einstellung an der Person", async () => {
  const { env, ck } = await ready();
  await post(env, ck, "/api/person", { id: "a", name: "Anna", remind: "tag" });
  await post(env, ck, "/api/person", { id: "b", name: "Ben", remind: "quatsch" });
  const st = await (await get(env, ck, "/api/state")).json();
  assert.deepEqual(st.persons.map(p => p.remind), ["tag", ""]);
});
