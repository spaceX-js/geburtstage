// Testet die Datumsberechnung der Anlässe.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as O from "../public/occasions.js";

test("Ostern, Muttertag und Vatertag", () => {
  assert.equal(O.easter(2025), "2025-04-20");
  assert.equal(O.easter(2026), "2026-04-05");
  assert.equal(O.easter(2027), "2027-03-28");
  assert.equal(O.holidayDate("muttertag", 2026), "2026-05-10");
  assert.equal(O.holidayDate("muttertag", 2027), "2027-05-09");
  assert.equal(O.holidayDate("vatertag", 2026), "2026-05-14");
  assert.equal(O.holidayDate("weihnachten", 2026), "2026-12-24");
});

test("29. Februar wird in normalen Jahren am 28. gefeiert", () => {
  assert.equal(O.dayInYear(29, 2, 2027), "2027-02-28");
  assert.equal(O.dayInYear(29, 2, 2028), "2028-02-29");
});

test("nächste Anlässe über den Jahreswechsel, mit Alter und rundem Geburtstag", () => {
  const p = [
    { id: "a", bday_day: 3, bday_month: 1, bday_year: 1997, holidays: ["weihnachten"], extra: [] },
    { id: "b", bday_day: 20, bday_month: 11, bday_year: null, holidays: [], extra: [{ id: "h", label: "Hochzeitstag", d: 1, m: 12, y: 2016 }] }
  ];
  const list = O.upcoming(p, "2026-11-15", 60);
  assert.deepEqual(list.map(o => [o.personId, o.key, o.date]), [
    ["b", "geburtstag", "2026-11-20"], ["b", "x:h", "2026-12-01"], ["a", "weihnachten", "2026-12-24"], ["a", "geburtstag", "2027-01-03"]
  ]);
  const bday = list.find(o => o.personId === "a" && o.key === "geburtstag");
  assert.equal(bday.age, 30); assert.equal(bday.round, true); assert.equal(bday.inDays, 49);
  assert.equal(O.occTitle(bday), "30. Geburtstag");
  assert.equal(list[0].age, null); assert.equal(O.occTitle(list[0]), "Geburtstag");
  const hz = list[1]; assert.equal(hz.age, 10); assert.equal(hz.round, true); assert.equal(O.occTitle(hz), "10. Hochzeitstag");
});

test("heute zählt mit, Alter heute", () => {
  const p = { id: "a", bday_day: 15, bday_month: 11, bday_year: 1990, holidays: [], extra: [] };
  assert.equal(O.upcoming([p], "2026-11-15", 10)[0].inDays, 0);
  assert.equal(O.ageOn(p, "2026-11-15"), 36);
  assert.equal(O.ageOn(p, "2026-11-14"), 35);
  assert.equal(O.fmtIn(0), "heute"); assert.equal(O.fmtIn(1), "morgen"); assert.equal(O.fmtIn(5), "in 5 Tagen");
});
