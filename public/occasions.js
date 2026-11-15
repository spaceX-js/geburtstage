// Anlässe berechnen: Geburtstage, Feiertage und eigene Termine (Hochzeitstag, Namenstag …).
// Wird von der Oberfläche (public/app.js) und vom Worker (src/index.js, für Erinnerungen) gemeinsam benutzt.
// Alle Daten sind reine Kalendertage ("2026-12-24"), ohne Uhrzeit und ohne Zeitzone.

// Feiertage, die man pro Person zuschalten kann
export const HOLIDAYS = [
  { key: "weihnachten", label: "Weihnachten", short: "Weihnachten" },
  { key: "nikolaus", label: "Nikolaus", short: "Nikolaus" },
  { key: "ostern", label: "Ostern", short: "Ostern" },
  { key: "valentinstag", label: "Valentinstag", short: "Valentinstag" },
  { key: "muttertag", label: "Muttertag", short: "Muttertag" },
  { key: "vatertag", label: "Vatertag", short: "Vatertag" }
];
export const HOLIDAY_KEYS = HOLIDAYS.map(h => h.key);

export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const MONTHS_SHORT = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."];
export const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

const pad = n => String(n).padStart(2, "0");
export const iso = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);
export function parseIso(s) { const [y, m, d] = String(s).split("-").map(Number); return { y, m, d }; }
const utc = s => { const { y, m, d } = parseIso(s); return Date.UTC(y, m - 1, d); };
export function addDays(s, n) { const t = new Date(utc(s) + n * 86400000); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
export function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
export function weekday(s) { return new Date(utc(s)).getUTCDay(); }
export const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

// Heutiges Datum in einer Zeitzone (Standard: Deutschland)
export function todayIn(tz = "Europe/Berlin", now = new Date()) {
  try {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const g = t => p.find(x => x.type === t).value;
    return g("year") + "-" + g("month") + "-" + g("day");
  } catch (e) { return iso(now.getFullYear(), now.getMonth() + 1, now.getDate()); }
}

// Ostersonntag (gregorianischer Kalender)
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}
export function holidayDate(key, y) {
  switch (key) {
    case "weihnachten": return iso(y, 12, 24);
    case "nikolaus": return iso(y, 12, 6);
    case "valentinstag": return iso(y, 2, 14);
    case "ostern": return easter(y);
    case "vatertag": return addDays(easter(y), 39);          // Christi Himmelfahrt
    case "muttertag": { const first = iso(y, 5, 1); const off = (7 - weekday(first)) % 7; return addDays(first, off + 7); } // 2. Sonntag im Mai
    default: return null;
  }
}

// Tag und Monat in einem bestimmten Jahr; der 29. Februar wird in normalen Jahren am 28. gefeiert
export function dayInYear(d, m, y) {
  if (m === 2 && d === 29 && !isLeap(y)) return iso(y, 2, 28);
  return iso(y, m, Math.min(d, daysInMonth(y, m)));
}

// Runde Geburtstage: 18, 20, 30, 40 …
export const isRound = n => n > 0 && (n % 10 === 0 || n === 18);

// Alle Anlässe einer Person, die in einem Kalenderjahr liegen
export function occasionsInYear(p, y) {
  const out = [];
  if (p.bday_day && p.bday_month) {
    const age = p.bday_year ? y - p.bday_year : null;
    if (age === null || age >= 0) out.push({ key: "geburtstag", label: "Geburtstag", date: dayInYear(p.bday_day, p.bday_month, y), year: y, age, round: age !== null && isRound(age) });
  }
  for (const k of p.holidays || []) {
    const h = HOLIDAYS.find(x => x.key === k);
    if (h) out.push({ key: k, label: h.label, date: holidayDate(k, y), year: y, age: null, round: false });
  }
  for (const x of p.extra || []) {
    if (!x || !x.d || !x.m) continue;
    const n = x.y ? y - x.y : null;
    if (n !== null && n < 0) continue;
    out.push({ key: "x:" + x.id, label: x.label || "Termin", date: dayInYear(x.d, x.m, y), year: y, age: n, round: n !== null && n > 0 && (n % 5 === 0) });
  }
  return out;
}

// Anlässe aller Personen ab einem Tag (einschließlich) für eine bestimmte Anzahl Tage, nach Datum sortiert
export function upcoming(persons, from, days = 366) {
  const to = addDays(from, days - 1);
  const y0 = parseIso(from).y, y1 = parseIso(to).y;
  const out = [];
  for (const p of persons) {
    for (let y = y0; y <= y1; y++) {
      for (const o of occasionsInYear(p, y)) {
        if (o.date >= from && o.date <= to) out.push({ ...o, personId: p.id, inDays: daysBetween(from, o.date) });
      }
    }
  }
  out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.label.localeCompare(b.label));
  return out;
}

// Alter heute (oder null, wenn das Geburtsjahr fehlt)
export function ageOn(p, day) {
  if (!p.bday_year || !p.bday_month || !p.bday_day) return null;
  const { y } = parseIso(day);
  const bd = dayInYear(p.bday_day, p.bday_month, y);
  return y - p.bday_year - (day < bd ? 1 : 0);
}

// "Sa 24. Dez." bzw. "24. Dezember"
export function fmtDate(s, opt = {}) {
  const { y, m, d } = parseIso(s);
  const base = d + ". " + (opt.long ? MONTHS[m - 1] : MONTHS_SHORT[m - 1]);
  return (opt.weekday ? WEEKDAYS[weekday(s)] + " " : "") + base + (opt.year ? " " + y : "");
}
export function fmtDayMonth(d, m) { return d + ". " + MONTHS[m - 1]; }
export function fmtIn(n) {
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n < 0) return n === -1 ? "gestern" : "vor " + (-n) + " Tagen";
  if (n < 14) return "in " + n + " Tagen";
  if (n < 60) return "in " + Math.round(n / 7) + " Wochen";
  return "in " + Math.round(n / 30.4) + " Monaten";
}
// "30. Geburtstag", "5. Hochzeitstag" oder nur "Geburtstag"
export function occTitle(o) {
  if (o.age !== null && o.age !== undefined && o.age > 0) return o.age + ". " + o.label;
  return o.label;
}
