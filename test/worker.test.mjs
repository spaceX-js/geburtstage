// Testet den Worker gegen eine lokale SQLite-Datenbank, die sich wie D1 verhält.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { checkPerson, checkGift, cleanLink } from "../src/index.js";

function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../d1-schema.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a.map(v => v === undefined ? null : v)),
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async run() { return run(sql, args); }
  });
  function run(sql, args) {
    const p = db.prepare(sql);
    if (/returning|^\s*select/i.test(sql)) return { results: p.all(...args) };
    p.run(...args); return { results: [] };
  }
  return {
    raw: db, prepare: sql => stmt(sql),
    async batch(list) {
      db.exec("BEGIN");
      try { const out = list.map(s => run(s.sql, s.args)); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    }
  };
}
const ASSETS = { fetch: async req => new Response("<html>app " + new URL(req.url).pathname + "</html>", { headers: { "Content-Type": "text/html" } }) };
const env0 = () => ({ DB: makeD1(), ASSETS });
const call = (env, path, opts = {}) => worker.fetch(new Request("https://x.test" + path, opts), env);
const form = o => { const fd = new FormData(); for (const k in o) fd.set(k, o[k]); return fd; };
const cookieOf = res => { const c = res.headers.get("Set-Cookie"); return c && !c.includes("Max-Age=0") ? c.split(";")[0] : null; };
const post = (env, ck, path, body) => call(env, path, { method: "POST", headers: { Cookie: ck, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = (env, ck, path) => call(env, path, { headers: { Cookie: ck } });
async function ready() {
  const env = env0();
  const ck = cookieOf(await call(env, "/login", { method: "POST", body: form({ passwort: "geheim123", passwort2: "geheim123" }) }));
  return { env, ck };
}

test("erster Aufruf: Passwort festlegen, danach normal anmelden", async () => {
  const env = env0();
  assert.match(await (await call(env, "/")).text(), /Passwort festlegen/);
  let res = await call(env, "/login", { method: "POST", body: form({ passwort: "kurz", passwort2: "kurz" }) });
  assert.equal(res.headers.get("Location"), "/?fehler=kurz");
  res = await call(env, "/login", { method: "POST", body: form({ passwort: "geheim123", passwort2: "anders123" }) });
  assert.equal(res.headers.get("Location"), "/?fehler=ungleich");
  res = await call(env, "/login", { method: "POST", body: form({ passwort: "geheim123", passwort2: "geheim123" }) });
  const ck = cookieOf(res); assert.ok(ck);
  // jetzt gibt es ein Passwort: Festlegen geht nicht mehr, Anmelden schon
  assert.match(await (await call(env, "/")).text(), /Bitte gib euer Passwort ein/);
  res = await call(env, "/login", { method: "POST", body: form({ passwort: "neu12345", passwort2: "neu12345" }), headers: { "CF-Connecting-IP": "9.9.9.9" } });
  assert.equal(res.headers.get("Location"), "/?fehler=falsch");
  res = await call(env, "/login", { method: "POST", body: form({ passwort: "geheim123" }) });
  assert.ok(cookieOf(res));
});

test("ohne Anmeldung keine Daten", async () => {
  const { env } = await ready();
  assert.equal((await call(env, "/api/state")).status, 401);
  assert.equal((await call(env, "/app.js")).status, 302);
  assert.equal((await call(env, "/occasions.js")).status, 302);
  assert.equal((await call(env, "/icon.png")).status, 200);
});

test("Person, Idee und Geschenk anlegen, ändern, löschen", async () => {
  const { env, ck } = await ready();
  let st = await (await get(env, ck, "/api/state")).json();
  assert.deepEqual([st.persons.length, st.ideas.length, st.gifts.length], [0, 0, 0]);
  assert.deepEqual(st.people, ["Jonas", "Clara"]);

  let r = await post(env, ck, "/api/person", { id: "p1", name: "  Anna  Müller ", relation: "Familie", bday_day: 3, bday_month: 1, bday_year: 1997,
    holidays: ["weihnachten", "quatsch"], extra: [{ id: "h1", label: "Hochzeitstag", d: 1, m: 6, y: 2020 }], interests: ["Kochen", "kochen", "Wandern"],
    budget_min: 20, budget_max: 50, responsible: "Clara" });
  assert.equal(r.status, 200);
  r = await post(env, ck, "/api/idea", { id: "i1", person_id: "p1", text: "Kochkurs", price: 80, link: "javascript:alert(1)", added_by: "Jonas" });
  assert.equal(r.status, 200);
  r = await post(env, ck, "/api/gift", { id: "g1", person_id: "p1", occasion: "x:h1", year: 2026, title: "Kerze", price: 15, status: "ueberreicht", rating: 3, who: "Niemand" });
  assert.equal(r.status, 200);

  st = await (await get(env, ck, "/api/state")).json();
  const p = st.persons[0];
  assert.equal(p.name, "Anna Müller");
  assert.deepEqual(p.holidays, ["weihnachten"]);
  assert.deepEqual(p.interests, ["Kochen", "Wandern"]);
  assert.deepEqual(p.extra, [{ id: "h1", label: "Hochzeitstag", d: 1, m: 6, y: 2020 }]);
  assert.equal(p.responsible, "Clara");
  assert.equal(st.ideas[0].link, "");                 // gefährlicher Link wird verworfen
  assert.equal(st.gifts[0].who, "");
  assert.equal(st.gifts[0].rating, 3);

  // gleicher Stand → nur "same"
  const same = await (await get(env, ck, "/api/state?rev=" + st.rev)).json();
  assert.deepEqual(same, { rev: st.rev, same: true });

  // ändern
  await post(env, ck, "/api/gift", { id: "g1", person_id: "p1", occasion: "geburtstag", year: 2027, title: "Kerze", status: "gekauft" });
  st = await (await get(env, ck, "/api/state")).json();
  assert.equal(st.gifts.length, 1); assert.equal(st.gifts[0].status, "gekauft"); assert.equal(st.gifts[0].price, null);

  // Idee löschen
  await post(env, ck, "/api/idea/delete", { id: "i1" });
  st = await (await get(env, ck, "/api/state")).json();
  assert.equal(st.ideas.length, 0);

  // Person löschen nimmt alles mit
  await post(env, ck, "/api/idea", { id: "i2", person_id: "p1", text: "Buch" });
  await post(env, ck, "/api/person/delete", { id: "p1" });
  st = await (await get(env, ck, "/api/state")).json();
  assert.deepEqual([st.persons.length, st.ideas.length, st.gifts.length], [0, 0, 0]);
});

test("Prüfung der Eingaben", () => {
  assert.equal(checkPerson({ id: "p", name: "" }), null);
  assert.ok(checkPerson({ id: "p", name: "Ohne Geburtstag" }));
  assert.ok(checkPerson({ id: "p", name: "Ohne Jahr", bday_day: 12, bday_month: 3 }));
  assert.ok(checkPerson({ id: "p", name: "Schaltjahr ohne Jahr", bday_day: 29, bday_month: 2 }));
  assert.equal(checkPerson({ id: "p", name: "X", bday_day: 29, bday_month: 2, bday_year: 1999 }), null);
  assert.equal(checkPerson({ id: "p", name: "X", bday_day: 31, bday_month: 4 }), null);
  assert.equal(checkPerson({ id: "p", name: "X", bday_day: 3 }), null);
  assert.equal(checkPerson({ id: "p", name: "X", bday_year: 1990 }), null);
  assert.equal(checkPerson({ id: "p", name: "X", budget_min: 50, budget_max: 20 }), null);
  assert.equal(checkPerson({ id: "p", name: "X", bday_day: 1, bday_month: 1, bday_year: 2999 }), null);
  assert.equal(checkGift({ id: "g", person_id: "p", occasion: "irgendwas", year: 2026, title: "X" }), null);
  assert.equal(checkGift({ id: "g", person_id: "p", occasion: "geburtstag", year: 2026, title: "" }), null);
  assert.equal(checkGift({ id: "g", person_id: "p", occasion: "geburtstag", year: 2026, title: "X", status: "kaputt" }).status, "idee");
  assert.equal(cleanLink("https://example.com/a"), "https://example.com/a");
  assert.equal(cleanLink("ftp://x"), "");
});

test("ungültige Anfragen werden abgelehnt", async () => {
  const { env, ck } = await ready();
  assert.equal((await post(env, ck, "/api/person", { id: "a b", name: "X" })).status, 400);
  assert.equal((await post(env, ck, "/api/gift", { id: "g", person_id: "p", occasion: "geburtstag", year: 1800, title: "X" })).status, 400);
  assert.equal((await post(env, ck, "/api/idea/delete", {})).status, 400);
  assert.equal((await get(env, ck, "/api/gibtsnicht")).status, 404);
});

test("Passwort ändern", async () => {
  const { env, ck } = await ready();
  assert.equal((await post(env, ck, "/api/password", { old: "falsch", new: "neues-passwort" })).status, 400);
  const r = await post(env, ck, "/api/password", { old: "geheim123", new: "neues-passwort" });
  assert.equal(r.status, 200);
  const ck2 = cookieOf(r);
  assert.equal((await get(env, ck, "/api/state")).status, 401);       // alte Anmeldung gilt nicht mehr
  assert.equal((await get(env, ck2, "/api/state")).status, 200);
});
