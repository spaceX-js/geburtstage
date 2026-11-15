// Testet Erinnerungen, Push-Versand und Kalender-Abo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { loadState } from "../src/index.js";
import { dueReminders, runReminders, buildIcs, reminderConfig, checkDays } from "../src/notify.js";
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
  const sent = [];
  const env = { DB: makeD1(), ASSETS, PUSH_FETCH: async (u, o) => { sent.push({ u, o }); return new Response(null, { status: 201 }); }, ...extra };
  const res = await call(env, "/login", { method: "POST", body: form({ passwort: "geheim123", passwort2: "geheim123" }) });
  return { env, ck: res.headers.get("Set-Cookie").split(";")[0], sent };
}
async function fakeSub() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { endpoint: "https://push.example.com/abc", keys: { p256dh: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
}

const P = (o) => ({ id: "p", name: "Anna", bday_day: null, bday_month: null, bday_year: null, holidays: [], extra: [], remind: "", budgets: {}, self: "", ...o });
const cfg = { days: [30, 15, 7, 0], hour: 9, holidays: true };

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
  assert.deepEqual(reminderConfig({}), { days: [30, 15, 7, 0], hour: 9, holidays: true });
  assert.deepEqual(reminderConfig({ remind_days: "[1,3]", remind_hour: "7", remind_holidays: "0" }).days, [3, 1]);
  assert.equal(checkDays([1, 2, 3, 4, 5, 6, 7]), null);
  assert.equal(checkDays([-1]), null);
  assert.deepEqual(checkDays([0, 7, 7]), [7, 0]);
});

async function fakeSubAt(path) { const s = await fakeSub(); s.endpoint = "https://push.example.com/" + path; return s; }

test("stündlicher Lauf: erst ab der Uhrzeit, jede Erinnerung nur einmal", async () => {
  const { env, ck, sent } = await ready();
  await post(env, ck, "/api/person", { id: "a", name: "Anna", bday_day: 22, bday_month: 11, bday_year: 1996 });
  await post(env, ck, "/api/person", { id: "b", name: "Ben", bday_day: 15, bday_month: 11 });
  await post(env, ck, "/api/push/subscribe", { ...(await fakeSubAt("j")), person: "Jonas" });

  // 15.11.2026, 7:30 Uhr in Berlin (6:30 UTC) – noch zu früh
  assert.equal((await runReminders(env, new Date("2026-11-15T06:30:00Z"), loadState)).length, 0);
  // 9:05 Uhr in Berlin
  let out = await runReminders(env, new Date("2026-11-15T08:05:00Z"), loadState);
  assert.equal(out.length, 2);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].o.headers["Content-Encoding"], "aes128gcm");
  // eine Stunde später: nichts doppelt
  out = await runReminders(env, new Date("2026-11-15T09:05:00Z"), loadState);
  assert.equal(out.length, 0); assert.equal(sent.length, 2);
  // Uhrzeit ändern → am nächsten Tag erst ab 18 Uhr
  await post(env, ck, "/api/settings", { remind_hour: 18, remind_days: [6, 0] });
  assert.equal((await runReminders(env, new Date("2026-11-16T10:00:00Z"), loadState)).length, 0);
  out = await runReminders(env, new Date("2026-11-16T17:00:00Z"), loadState);
  assert.deepEqual(out.map(x => x.title), ["Anna hat in 6 Tagen Geburtstag"]);
});

test("Ehepaar: Geschenke bleiben geheim, eigener Geburtstag ohne Erinnerung, Hochzeitstag nur einmal", () => {
  const hz = (id) => [{ id, label: "Hochzeitstag", d: 22, m: 11, y: 2024 }];
  const persons = [
    P({ id: "j", name: "Jonas", self: "Jonas", bday_day: 22, bday_month: 11, holidays: ["weihnachten"], extra: hz("hj"), budgets: { geburtstag: { max: 100 } } }),
    P({ id: "c", name: "Clara", self: "Clara", bday_day: 22, bday_month: 11, holidays: ["weihnachten"], extra: hz("hc") })
  ];
  const gifts = [
    { person_id: "j", occasion: "geburtstag", year: 2026, title: "Uhr", status: "gekauft" },          // Claras Geschenk für Jonas
    { person_id: "c", occasion: "x:hc", year: 2026, title: "Blumen", status: "idee" }                 // Jonas' Geschenk für Clara
  ];
  const forJonas = dueReminders(persons, gifts, [], cfg, "2026-11-15", "Jonas");
  assert.deepEqual(forJonas.map(x => x.title).sort(), ["Clara hat in 7 Tagen Geburtstag", "💍 Euer 2. Hochzeitstag in 7 Tagen"]);
  assert.doesNotMatch(JSON.stringify(forJonas), /Uhr/);                 // sein eigenes Geschenk sieht er nicht
  const hzJ = forJonas.find(x => /Hochzeitstag/.test(x.title));
  assert.match(hzJ.body, /Geschenk: Blumen/);                           // seins für Clara schon
  assert.equal(hzJ.url, "/#p=c");
  const forClara = dueReminders(persons, gifts, [], cfg, "2026-11-15", "Clara");
  assert.match(forClara.find(x => x.title.startsWith("Jonas")).body, /Geschenk: Uhr \(gekauft\)/);
  assert.doesNotMatch(JSON.stringify(forClara), /Blumen/);
  // unbekanntes Handy: keine Geschenk-Infos über die beiden
  const anon = dueReminders(persons, gifts, [], cfg, "2026-11-15", "");
  assert.doesNotMatch(JSON.stringify(anon), /Uhr|Blumen|Budget/);
  assert.equal(anon.filter(x => /Hochzeitstag/.test(x.title)).length, 1);
  assert.match(anon.find(x => /Hochzeitstag/.test(x.title)).title, /von Jonas & Clara/);
  // Weihnachten: Jonas sieht nur Clara in der Liste
  const xmas = dueReminders(persons, gifts, [], cfg, "2026-11-24", "Jonas");
  assert.equal(xmas[0].body, "Geschenke für Clara · 0 von 1 geplant");
});

test("Budget je Anlass in der Erinnerung", () => {
  const p = P({ id: "a", name: "Anna", bday_day: 22, bday_month: 11, budgets: { geburtstag: { min: 20, max: 40 } } });
  const r = dueReminders([p], [], [], cfg, "2026-11-15", "Jonas");
  assert.match(r[0].body, /Noch kein Geschenk geplant · Budget 20–40 €/);
});

test("Push geht je Person mit eigener Fassung raus", async () => {
  const { env, ck, sent } = await ready();
  await post(env, ck, "/api/person", { id: "j", name: "Jonas", self: "Jonas", bday_day: 22, bday_month: 11 });
  await post(env, ck, "/api/push/subscribe", { ...(await fakeSubAt("jonas")), person: "Jonas" });
  await post(env, ck, "/api/push/subscribe", { ...(await fakeSubAt("clara")), person: "Clara" });
  const out = await runReminders(env, new Date("2026-11-15T09:00:00Z"), loadState);
  assert.deepEqual(out.map(x => x.viewer), ["Clara"]);                  // Jonas wird nicht an seinen eigenen Geburtstag erinnert
  assert.deepEqual(sent.map(x => x.u), ["https://push.example.com/clara"]);
});

test("Test-Push", async () => {
  const { env, ck, sent } = await ready();
  const sub = await fakeSub();
  assert.equal((await post(env, ck, "/api/push/test", { endpoint: sub.endpoint })).status, 400);
  await post(env, ck, "/api/push/subscribe", { ...sub, person: "Clara" });
  assert.equal((await post(env, ck, "/api/push/test", { endpoint: sub.endpoint })).status, 200);
  assert.equal(sent.length, 1);
});

test("Kalender-Abo: nur mit geheimem Link, neuer Link macht alten ungültig", async () => {
  const { env, ck } = await ready();
  await post(env, ck, "/api/person", { id: "j", name: "Jonas", self: "Jonas", extra: [{ id: "h1", label: "Hochzeitstag", d: 5, m: 4, y: 2024 }] });
  await post(env, ck, "/api/person", { id: "c", name: "Clara", self: "Clara", extra: [{ id: "h2", label: "Hochzeitstag", d: 5, m: 4, y: 2024 }] });
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
  assert.equal((ics.match(/SUMMARY:💍 (Jonas & Clara|Clara & Jonas): 3\. Hochzeitstag/g) || []).length, 1);
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
