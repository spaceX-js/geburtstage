// Geburtstage – Oberfläche
// Zeigt die nächsten Geburtstage, alle Personen und (als Zusatz) Geschenk-Ideen und -Historie; speichert alles über /api/… in der Datenbank.
import * as O from "/occasions.js";

const VERSION = "0.5.0";
const CACHE_KEY = "geschenke.v1";
const POLL_MS = 5000;
const STATUS = [
  { key: "idee", label: "Idee" }, { key: "gekauft", label: "Gekauft" }, { key: "verpackt", label: "Verpackt" }, { key: "ueberreicht", label: "Überreicht" }
];
const STATUS_LABEL = { idee: "Idee", gekauft: "Gekauft", verpackt: "Verpackt", ueberreicht: "Überreicht", nichts: "Diesmal nichts" };
const RATINGS = [[1, "😐 Naja"], [2, "🙂 Gut"], [3, "🤩 Volltreffer"]];
const RELATIONS = ["Familie", "Freunde", "Partner/in", "Kollegen", "Nachbarn"];

const S = { loaded: false, online: true, rev: null, persons: [], ideas: [], gifts: [], people: ["Jonas", "Clara"], me: "",
  view: "upcoming", pid: null, filter: "alle", q: "", pending: 0, scroll: {}, settings: null, pushOn: false, pushHintOff: false };

/* ---------- Kleine Helfer ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowIso = () => new Date().toISOString();
const today = () => { const d = new Date(); return O.iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
const thisYear = () => new Date().getFullYear();
const person = id => S.persons.find(p => p.id === id);
const euro = n => (n === null || n === undefined || n === "") ? "" : n + " €";
const numOrNull = v => { const s = String(v == null ? "" : v).trim().replace(",", "."); if (!s) return null; const n = Math.round(Number(s)); return Number.isFinite(n) && n >= 0 ? n : NaN; };
// Budget einer Person für einen Anlass ("bis 100 €", "50–80 €" oder "")
function budgetText(p, key) {
  const b = p && p.budgets && p.budgets[key];
  if (!b) return "";
  const a = b.min ?? null, z = b.max ?? null;
  if (a != null && z != null) return a === z ? a + " €" : a + "–" + z + " €";
  if (z != null) return "bis " + z + " €";
  if (a != null) return "ab " + a + " €";
  return "";
}
// Geheimhaltung: Geschenke über mich selbst sehe ich nicht. Ist unklar, wem das Handy gehört, bleiben beide Ehepartner verborgen.
function isSecret(pid) {
  const p = person(pid);
  if (!p || !p.self) return false;
  return !S.me || p.self === S.me;
}
const myPid = () => { const p = S.persons.find(x => x.self && x.self === S.me); return p ? p.id : null; };
const partnerPid = () => O.partnerOf(S.persons, S.me);
const isCouple = () => S.persons.filter(p => p.self).length >= 2;
function occLabel(p, key) {
  if (key === "geburtstag") return "Geburtstag";
  const h = O.HOLIDAYS.find(x => x.key === key); if (h) return h.label;
  if (key.startsWith("x:")) { const x = (p && p.extra || []).find(e => "x:" + e.id === key); return x ? x.label : "Termin (gelöscht)"; }
  return key;
}
const initials = name => String(name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const stars = n => n ? '<span class="stars">' + "★".repeat(n) + "</span>" : "";
const whoText = w => w ? w : "beide";

function toast(msg, undo) {
  const t = $("toast");
  t.innerHTML = '<div class="toast"><span>' + esc(msg) + "</span>" + (undo ? '<button id="undo">Rückgängig</button>' : "") + "</div>";
  if (undo) $("undo").onclick = () => { t.innerHTML = ""; undo(); };
  clearTimeout(toast._t); toast._t = setTimeout(() => t.innerHTML = "", undo ? 5000 : 2600);
}

/* ---------- Zwischenspeicher auf dem Gerät ---------- */
function loadLocal() {
  try {
    const o = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (o) { S.persons = o.persons || []; S.ideas = o.ideas || []; S.gifts = o.gifts || []; S.me = o.me || ""; S.filter = o.filter || "alle"; S.settings = o.settings || null; S.pushHintOff = !!o.pushHintOff;
      if (Array.isArray(o.people) && o.people.length) S.people = o.people; if (S.persons.length) S.loaded = true; }
  } catch (e) {}
}
function saveLocal() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ persons: S.persons, ideas: S.ideas, gifts: S.gifts, people: S.people, me: S.me, filter: S.filter, settings: S.settings, pushHintOff: S.pushHintOff })); } catch (e) {}
}

/* ---------- Server ---------- */
async function api(method, path, body) {
  let res;
  try { res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin", cache: "no-store" }); }
  catch (e) { setOnline(false); throw new Error("Keine Internetverbindung."); }
  if (res.status === 401) { location.replace("/"); throw new Error("Bitte neu anmelden."); }
  let data = null; try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.error) || "Fehler vom Server (" + res.status + ").");
  setOnline(true); return data;
}
function setOnline(on) { if (S.online === on) return; S.online = on; renderHead(); }
async function refresh(force) {
  if (S.pending) return;
  try {
    const d = await api("GET", "/api/state" + (S.rev != null && !force ? "?rev=" + S.rev : ""));
    if (S.pending) return;
    if (d.same) { S.rev = d.rev; return; }
    S.rev = d.rev; S.persons = d.persons || []; S.ideas = d.ideas || []; S.gifts = d.gifts || []; S.loaded = true;
    if (Array.isArray(d.people) && d.people.length) S.people = d.people;
    if (d.settings) S.settings = d.settings;
    saveLocal();
    if (!$("modal").innerHTML) render();
  } catch (e) { if (!S.loaded) { S.loaded = true; render(); } }
}
// Änderung speichern. Bis sie durch ist, werden keine Server-Stände übernommen (sonst springt etwas zurück).
async function send(path, body) {
  S.pending++;
  try { await api("POST", path, body); return true; }
  catch (e) { toast(e.message || "Speichern fehlgeschlagen – bitte nochmal versuchen."); return false; }
  finally { S.pending--; if (!S.pending) refresh(true); }
}
function upsert(list, obj) { const i = list.findIndex(x => x.id === obj.id); if (i >= 0) list[i] = { ...list[i], ...obj }; else list.unshift(obj); saveLocal(); return obj; }
function savePerson(p) { upsert(S.persons, p); S.persons.sort((a, b) => a.name.localeCompare(b.name, "de")); send("/api/person", p); }
function saveIdea(i) { upsert(S.ideas, i); send("/api/idea", i); }
function saveGift(g) { upsert(S.gifts, g); send("/api/gift", g); }
function deleteIdea(id, quiet) {
  const it = S.ideas.find(i => i.id === id); if (!it) return;
  S.ideas = S.ideas.filter(i => i.id !== id); saveLocal(); send("/api/idea/delete", { id });
  if (!quiet) toast("Idee gelöscht", () => { saveIdea(it); render(); });
}
function deleteGift(id) {
  const g = S.gifts.find(x => x.id === id); if (!g) return;
  S.gifts = S.gifts.filter(x => x.id !== id); saveLocal(); send("/api/gift/delete", { id });
  toast("„" + g.title + "“ gelöscht", () => { saveGift(g); render(); });
}
function deletePerson(id) {
  S.persons = S.persons.filter(p => p.id !== id); S.ideas = S.ideas.filter(i => i.person_id !== id); S.gifts = S.gifts.filter(g => g.person_id !== id);
  saveLocal(); send("/api/person/delete", { id });
}

/* ---------- Auswertung ---------- */
const giftsFor = (pid, key, year) => S.gifts.filter(g => g.person_id === pid && g.occasion === key && g.year === year);
// Stand eines Anlasses: weitester Status der Geschenke (Idee < Gekauft < Verpackt < Überreicht)
function stateOf(pid, key, year) {
  const gs = giftsFor(pid, key, year);
  if (!gs.length) return { key: "none", label: "Noch nichts geplant" };
  const real = gs.filter(g => g.status !== "nichts");
  if (!real.length) return { key: "nichts", label: "Diesmal nichts" };
  const order = ["idee", "gekauft", "verpackt", "ueberreicht"];
  const best = real.reduce((m, g) => order.indexOf(g.status) > order.indexOf(m) ? g.status : m, "idee");
  return { key: best, label: STATUS_LABEL[best] + (real.length > 1 ? " (" + real.length + ")" : "") };
}
// Wer kümmert sich: am Geschenk eingetragen, sonst die Voreinstellung der Person (leer = beide)
function responsibleFor(o) {
  const gs = giftsFor(o.personId, o.key, o.year).filter(g => g.who);
  if (gs.length) return gs[0].who;
  const p = person(o.personId); return p ? p.responsible : "";
}
function upcomingList(days = 365) {
  let list = O.upcoming(S.persons, today(), days).filter(o => !isSecret(o.personId));
  if (S.filter === "meine" && S.me) list = list.filter(o => { const r = responsibleFor(o); return !r || r === S.me; });
  return list;
}
const pill = st => '<span class="pill s-' + st.key + '">' + esc(st.label) + "</span>";

/* ---------- Kopf ---------- */
const ICON_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
function renderHead() {
  const net = S.online ? "" : '<span class="net">offline</span>';
  if (S.view === "person") {
    const p = person(S.pid);
    $("head").innerHTML = '<div class="title"><button class="backbtn" data-act="back">‹ Zurück</button>' +
      '<button class="iconbtn" data-act="edit-person" aria-label="Bearbeiten">' + ICON_EDIT + "</button></div>" +
      '<div class="title" style="margin-bottom:0"><h1>' + esc(p ? p.name : "") + net + "</h1></div>";
    return;
  }
  const tab = (v, l) => '<button data-act="view" data-v="' + v + '" class="' + (S.view === v ? "on" : "") + '">' + l + "</button>";
  $("head").innerHTML = '<div class="title"><h1>Geburtstage' + net + '</h1><button class="iconbtn" data-act="menu" aria-label="Einstellungen">' + ICON_GEAR + "</button></div>" +
    '<div class="seg">' + tab("upcoming", "Demnächst") + tab("cal", "Kalender") + tab("all", "Alle") + tab("gifts", "Geschenke") + "</div>" +
    (S.view === "all" ? '<input class="searchbox" id="q" type="search" placeholder="Suchen …" value="' + esc(S.q) + '" autocomplete="off">' : "");
  const q = $("q"); if (q) q.oninput = () => { S.q = q.value; renderBody(); };
}

/* ---------- Ansichten ---------- */
function render() { renderHead(); renderBody(); }
function renderBody() {
  if (!S.loaded) return;
  $("fab").innerHTML = (S.view === "upcoming" || S.view === "all" || S.view === "cal") && S.persons.length ? '<button class="fab" data-act="new-person">+ Person</button>' : "";
  if (S.view === "person") return renderPerson();
  if (S.view === "all") return renderAll();
  if (S.view === "gifts") return renderGifts();
  if (S.view === "cal") return renderCalendar();
  renderUpcoming();
}

function whoBox() {
  if (S.me) return "";
  return '<div class="whobox"><b>Wem gehört dieses Handy?</b><div class="small">Damit Erinnerungen stimmen und Geschenke für dich eine Überraschung bleiben.</div><div class="chips">' +
    S.people.map(p => '<button data-act="me" data-p="' + esc(p) + '">' + esc(p) + "</button>").join("") + "</div></div>";
}
// Hinweis, solange auf diesem Handy keine Erinnerungen ankommen
function pushHint() {
  if (!S.me || S.pushOn || S.pushHintOff || !S.persons.length) return "";
  return '<div class="hint"><span>🔔 Erinnerungen auf diesem Handy einschalten?</span><button class="btn sm" data-act="menu">Einrichten</button><button class="x" data-act="hint-off" aria-label="Ausblenden">✕</button></div>';
}
const birthdayOcc = o => !O.HOLIDAY_KEYS.includes(o.key);
// Kleiner Geschenk-Hinweis an einer Zeile – nur wenn schon etwas geplant ist
function giftMark(o) {
  if (o.couple) { const m = o.members.find(x => x.personId === partnerPid()); if (!m) return ""; o = { ...o, personId: m.personId, key: m.key }; }
  if (isSecret(o.personId)) return "";
  const st = stateOf(o.personId, o.key, o.year);
  if (st.key === "none") return "";
  return ' <span class="pill s-' + st.key + '">🎁 ' + esc(st.label) + "</span>";
}
function emptyStart() {
  return whoBox() + '<div class="empty" style="padding-top:50px">🎂<br><b>Noch keine Geburtstage</b><br>Tragt Freunde und Familie ein –<br>die App erinnert euch rechtzeitig.<br>' +
    '<button class="btn" data-act="new-person">Ersten Geburtstag eintragen</button></div>';
}

// Demnächst: Geburtstage und eigene Termine der nächsten 12 Monate
function renderUpcoming() {
  if (!S.persons.length) { $("app").innerHTML = emptyStart(); return; }
  const list = O.mergeCouple(O.upcoming(S.persons, today(), 365).filter(birthdayOcc), S.persons);
  let h = whoBox() + pushHint();
  const todays = list.filter(o => o.inDays === 0);
  if (todays.length) {
    h += '<div class="sec"><b>Heute 🎉</b></div>' + todays.map(o => {
      const p = person(o.personId);
      const t = o.couple ? (o.members.some(m => m.personId === myPid()) ? "Heute ist euer " + esc(O.occTitle(o)) + "!" : esc(O.occTitle(o)) + " von " + esc(coupleNames(o)))
        : o.key === "geburtstag" ? (o.age ? esc(p.name) + " wird heute " + o.age + "!" : esc(p.name) + " hat heute Geburtstag!") : esc(O.occTitle(o)) + " von " + esc(p.name);
      return '<button class="today" data-act="person" data-pid="' + esc(rowTarget(o)) + '"><span class="big">' + (o.key === "geburtstag" ? "🎂" : o.couple ? "💍" : "⭐") + "</span><span><b>" + t + "</b>" +
        '<small>Gratulieren nicht vergessen' + giftMark(o) + "</small></span></button>";
    }).join("");
  }
  const rest = list.filter(o => o.inDays > 0);
  if (!list.length) h += '<div class="empty">Noch kein Geburtstag eingetragen.<br>Tippe auf eine Person unter „Alle“ und ergänze das Datum.</div>';
  const y = thisYear();
  let month = "";
  for (const o of rest) {
    const ym = o.date.slice(0, 7);
    if (ym !== month) {
      if (month) h += "</div>";
      month = ym; const { y: yy, m } = O.parseIso(o.date);
      h += '<div class="sec"><b>' + O.MONTHS[m - 1] + (yy !== y ? " " + yy : "") + '</b></div><div class="list">';
    }
    h += bdayRow(o);
  }
  if (month) h += "</div>";
  $("app").innerHTML = h;
}
const coupleNames = o => o.members.map(m => (person(m.personId) || {}).name).join(" & ");
// Ein Ehepaar-Termin führt zum Partner (dort plane ich mein Geschenk)
const rowTarget = o => o.couple ? ((o.members.find(m => m.personId === partnerPid()) || o.members[0]).personId) : o.personId;
function bdayRow(o) {
  const p = person(o.personId);
  if (o.couple) {
    const { d } = O.parseIso(o.date);
    return '<button class="row" data-act="person" data-pid="' + esc(rowTarget(o)) + '">' +
      '<div class="date' + (o.inDays <= 7 ? " soon" : "") + '"><b>' + d + "</b><small>" + O.WEEKDAYS[O.weekday(o.date)] + "</small></div>" +
      '<div class="main"><div class="n">💍 ' + esc(coupleNames(o)) + (o.round ? '<span class="pill round">Jubiläum</span>' : "") + '</div><div class="d">' + esc(O.occTitle(o)) + " · " + O.fmtIn(o.inDays) + giftMark(o) + "</div></div>" +
      '<span class="chev">›</span></button>';
  }
  const { d } = O.parseIso(o.date);
  const round = o.round ? '<span class="pill round">' + (o.key === "geburtstag" ? "rund" : "Jubiläum") + "</span>" : "";
  const what = o.key === "geburtstag" ? (o.age ? "wird " + o.age : "Geburtstag") : esc(O.occTitle(o));
  return '<button class="row" data-act="person" data-pid="' + esc(o.personId) + '">' +
    '<div class="date' + (o.inDays <= 7 ? " soon" : "") + '"><b>' + d + "</b><small>" + O.WEEKDAYS[O.weekday(o.date)] + "</small></div>" +
    '<div class="main"><div class="n">' + esc(p.name) + round + '</div><div class="d">' + what + " · " + O.fmtIn(o.inDays) + giftMark(o) + "</div></div>" +
    '<span class="chev">›</span></button>';
}

/* ---------- Kalender: Monat und Jahr ---------- */
// Alle Geburtstage und eigenen Termine eines Jahres (Ehepaar-Termine nur einmal), nach Datum
function calYear(y) {
  const t = today();
  const list = [];
  for (const p of S.persons) for (const o of O.occasionsInYear(p, y)) if (birthdayOcc(o)) list.push({ ...o, personId: p.id, inDays: O.daysBetween(t, o.date) });
  list.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.label.localeCompare(b.label));
  return O.mergeCouple(list, S.persons);
}
function calState() {
  if (!S.cal) { const { y, m } = O.parseIso(today()); S.cal = { mode: "month", y, m, day: null }; }
  return S.cal;
}
const calName = o => o.couple ? "💍 " + coupleNames(o) : (person(o.personId) || {}).name || "";
const firstName = s => String(s).replace(/^💍\s*/, "").split(" ")[0];
function renderCalendar() {
  const c = calState(), t = today();
  const items = calYear(c.y);
  const head = (label, act) => '<div class="calnav"><button class="iconbtn" data-act="cal-prev" aria-label="Zurück">‹</button><button class="calttl" data-act="' + act + '">' + label + '</button><button class="iconbtn" data-act="cal-next" aria-label="Weiter">›</button></div>';
  let h = '<div class="seg" style="margin-top:12px"><button data-act="cal-mode" data-m="month" class="' + (c.mode === "month" ? "on" : "") + '">Monat</button>' +
    '<button data-act="cal-mode" data-m="year" class="' + (c.mode === "year" ? "on" : "") + '">Jahr</button></div>';
  if (c.mode === "year") {
    h += head(String(c.y), "cal-today");
    h += '<div class="yeargrid">';
    for (let m = 1; m <= 12; m++) {
      const mi = items.filter(o => O.parseIso(o.date).m === m);
      const days = new Set(mi.map(o => O.parseIso(o.date).d));
      h += '<button class="mini" data-act="cal-month" data-m="' + m + '"><b>' + O.MONTHS[m - 1] + (mi.length ? ' <span class="cnt">' + mi.length + "</span>" : "") + "</b>" + gridHtml(c.y, m, d => {
        const iso = O.iso(c.y, m, d);
        return '<i class="' + (days.has(d) ? "ev" : "") + (iso === t ? " now" : "") + '">' + d + "</i>";
      }, true) + "</button>";
    }
    h += "</div>";
    if (!items.length) h += '<div class="empty">In diesem Jahr ist nichts eingetragen.</div>';
    $("app").innerHTML = h;
    return;
  }
  // Monat
  const mi = items.filter(o => O.parseIso(o.date).m === c.m);
  const byDay = new Map();
  for (const o of mi) { const d = O.parseIso(o.date).d; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(o); }
  h += head(O.MONTHS[c.m - 1] + " " + c.y, "cal-today");
  h += '<div class="month">' + gridHtml(c.y, c.m, d => {
    const iso = O.iso(c.y, c.m, d), ev = byDay.get(d) || [];
    const cls = [ev.length ? "ev" : "", iso === t ? "now" : "", c.day === d ? "sel" : ""].filter(Boolean).join(" ");
    return '<button class="' + cls + '" data-act="cal-day" data-d="' + d + '"><span class="dn">' + d + "</span>" +
      ev.slice(0, 2).map(o => '<span class="who">' + (o.key === "geburtstag" ? "" : o.couple ? "💍" : "⭐") + esc(o.couple ? "Ihr" : firstName(calName(o))) + "</span>").join("") +
      (ev.length > 2 ? '<span class="who more">+' + (ev.length - 2) + "</span>" : "") + "</button>";
  }, false) + "</div>";
  const shown = c.day ? (byDay.get(c.day) || []) : mi;
  h += '<div class="sec"><b>' + (c.day ? c.day + ". " + O.MONTHS[c.m - 1] : "Im " + O.MONTHS[c.m - 1]) + "</b>" + (c.day ? '<button class="linkbtn" data-act="cal-day" data-d="0">Ganzer Monat</button>' : "") + "</div>";
  h += shown.length ? '<div class="list">' + shown.map(calRow).join("") + "</div>" : '<div class="card small">' + (c.day ? "An diesem Tag ist nichts eingetragen." : "In diesem Monat hat niemand Geburtstag.") + "</div>";
  $("app").innerHTML = h;
}
// Monatsraster (Montag zuerst); cell(d) liefert das HTML für einen Tag
function gridHtml(y, m, cell, mini) {
  const first = (O.weekday(O.iso(y, m, 1)) + 6) % 7, n = O.daysInMonth(y, m);
  let h = '<div class="' + (mini ? "mgrid" : "grid") + '">' + (mini ? "" : ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map(w => '<span class="wd">' + w + "</span>").join(""));
  for (let i = 0; i < first; i++) h += "<span></span>";
  for (let d = 1; d <= n; d++) h += cell(d);
  return h + "</div>";
}
function calRow(o) {
  const { d } = O.parseIso(o.date);
  const what = o.key === "geburtstag" ? (o.age ? (o.inDays < 0 ? "wurde " : "wird ") + o.age : "Geburtstag") : esc(O.occTitle(o));
  return '<button class="row" data-act="person" data-pid="' + esc(rowTarget(o)) + '">' +
    '<div class="date' + (o.inDays === 0 ? " soon" : "") + '"><b>' + d + "</b><small>" + O.WEEKDAYS[O.weekday(o.date)] + "</small></div>" +
    '<div class="main"><div class="n">' + esc(calName(o)) + (o.round ? '<span class="pill round">' + (o.key === "geburtstag" ? "rund" : "Jubiläum") + "</span>" : "") +
    '</div><div class="d">' + what + " · " + O.fmtIn(o.inDays) + giftMark(o) + '</div></div><span class="chev">›</span></button>';
}

// Ausgaben: was wir pro Jahr, Person und Anlass für Geschenke ausgeben (Geschenke für mich selbst zählen nicht mit – geheim)
const SPENT = ["gekauft", "verpackt", "ueberreicht"];
function renderSpending() {
  if (!S.spendYear) S.spendYear = thisYear();
  const y = S.spendYear;
  const visible = S.gifts.filter(g => !isSecret(g.person_id) && g.status !== "nichts");
  const inYear = visible.filter(g => g.year === y);
  const spent = inYear.filter(g => SPENT.includes(g.status)), planned = inYear.filter(g => g.status === "idee");
  const sum = list => list.reduce((a, g) => a + (g.price || 0), 0);
  const noPrice = inYear.filter(g => g.price == null).length;
  let h = '<div class="calnav"><button class="iconbtn" data-act="spend-prev" aria-label="Voriges Jahr">‹</button><span class="calttl">' + y +
    '</span><button class="iconbtn" data-act="spend-next" aria-label="Nächstes Jahr">›</button></div>';
  h += '<div class="stats"><div><small>Ausgegeben</small><b>' + euroFmt(sum(spent)) + "</b><span>" + spent.length + (spent.length === 1 ? " Geschenk" : " Geschenke") + "</span></div>" +
    "<div><small>Noch geplant</small><b>" + euroFmt(sum(planned)) + "</b><span>" + planned.length + (planned.length === 1 ? " Idee" : " Ideen") + "</span></div></div>";
  if (noPrice) h += '<div class="small" style="margin:8px 4px 0">' + noPrice + (noPrice === 1 ? " Geschenk ist" : " Geschenke sind") + " ohne Preis eingetragen und fehlen in der Summe.</div>";
  if (myPid()) h += '<div class="small" style="margin:4px 4px 0">🤫 Geschenke für dich sind nicht mitgezählt.</div>';
  if (!inYear.length) {
    h += '<div class="empty">' + y + " sind noch keine Geschenke eingetragen.</div>";
  } else {
    // pro Person
    const byP = new Map();
    for (const g of inYear) { const e = byP.get(g.person_id) || { spent: 0, planned: 0, n: 0 }; if (SPENT.includes(g.status)) e.spent += g.price || 0; else e.planned += g.price || 0; e.n++; byP.set(g.person_id, e); }
    const rows = [...byP.entries()].map(([pid, e]) => ({ p: person(pid), ...e })).filter(r => r.p).sort((a, b) => (b.spent + b.planned) - (a.spent + a.planned));
    const max = Math.max(1, ...rows.map(r => r.spent + r.planned));
    h += '<div class="sec"><b>Pro Person</b></div><div class="list">' + rows.map(r =>
      '<button class="row" data-act="person" data-pid="' + esc(r.p.id) + '"><div class="main"><div class="n">' + esc(r.p.name) + '</div>' +
      '<div class="bar"><i style="width:' + (r.spent / max * 100).toFixed(1) + '%"></i><i class="pl" style="width:' + (r.planned / max * 100).toFixed(1) + '%"></i></div>' +
      '<div class="d">' + euroFmt(r.spent) + (r.planned ? " · geplant " + euroFmt(r.planned) : "") + " · " + r.n + (r.n === 1 ? " Geschenk" : " Geschenke") + '</div></div><span class="chev">›</span></button>').join("") + "</div>";
    // pro Anlass
    const byO = new Map();
    for (const g of inYear) { const k = g.occasion.startsWith("x:") ? occLabel(person(g.person_id), g.occasion) : occLabel(null, g.occasion); byO.set(k, (byO.get(k) || 0) + (g.price || 0)); }
    h += '<div class="sec"><b>Pro Anlass</b></div><div class="card">' + [...byO.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => '<div class="kv"><span>' + esc(k) + "</span><b>" + euroFmt(v) + "</b></div>").join("") + "</div>";
    // Budget überschritten?
    const over = [];
    const groups = new Map();
    for (const g of inYear) { const k = g.person_id + "|" + g.occasion; groups.set(k, (groups.get(k) || 0) + (g.price || 0)); }
    for (const [k, v] of groups) {
      const [pid, occ] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
      const p = person(pid), b = p && p.budgets && p.budgets[occ];
      if (b && b.max != null && v > b.max) over.push('<div class="kv"><span>' + esc(p.name) + " · " + esc(occLabel(p, occ)) + "</span><b>" + euroFmt(v) + ' <small class="small">(Budget ' + b.max + " €)</small></b></div>");
    }
    if (over.length) h += '<div class="sec"><b>Über Budget</b></div><div class="card">' + over.join("") + "</div>";
  }
  // Jahresvergleich
  const years = [];
  for (let k = y - 4; k <= y; k++) years.push([k, sum(visible.filter(g => g.year === k && SPENT.includes(g.status)))]);
  if (years.some(([, v]) => v > 0)) {
    const mx = Math.max(1, ...years.map(([, v]) => v));
    h += '<div class="sec"><b>Jahresvergleich (ausgegeben)</b></div><div class="card yearbars">' + years.map(([k, v]) =>
      '<button data-act="spend-year" data-y="' + k + '" class="' + (k === y ? "on" : "") + '"><span class="yv">' + (v ? euroFmt(v) : "–") + '</span><span class="yb"><i style="height:' + (v / mx * 100).toFixed(1) + '%"></i></span><span class="yl">' + k + "</span></button>").join("") + "</div>";
  }
  return h;
}
const euroFmt = n => (Math.round(n) || 0).toLocaleString("de-DE") + " €";

// Alle: nach Geburtsmonat sortiert (Januar bis Dezember), Personen ohne Geburtstag am Ende
function renderAll() {
  if (!S.persons.length) { $("app").innerHTML = emptyStart(); return; }
  const q = S.q.trim().toLowerCase();
  const list = S.persons.filter(p => !q || p.name.toLowerCase().includes(q) || (p.relation || "").toLowerCase().includes(q));
  if (!list.length) { $("app").innerHTML = '<div class="empty">Niemand gefunden.</div>'; return; }
  const t = today();
  const next = new Map(O.upcoming(list, t, 365).filter(o => o.key === "geburtstag").map(o => [o.personId, o]));
  const withB = list.filter(p => p.bday_day).sort((a, b) => a.bday_month - b.bday_month || a.bday_day - b.bday_day || a.name.localeCompare(b.name, "de"));
  const without = list.filter(p => !p.bday_day);
  let h = "", month = 0;
  for (const p of withB) {
    if (p.bday_month !== month) { if (month) h += "</div>"; month = p.bday_month; h += '<div class="sec"><b>' + O.MONTHS[month - 1] + '</b></div><div class="list">'; }
    const o = next.get(p.id);
    const d = [];
    if (p.relation) d.push(esc(p.relation));
    if (o) d.push((o.age ? "wird " + o.age + " " : "") + O.fmtIn(o.inDays));
    h += '<button class="row" data-act="person" data-pid="' + esc(p.id) + '"><div class="date"><b>' + p.bday_day + "</b><small>" + O.MONTHS_SHORT[p.bday_month - 1].replace(".", "") + "</small></div>" +
      '<div class="main"><div class="n">' + esc(p.name) + (p.remind === "aus" ? ' <span class="small">🔕</span>' : "") + '</div><div class="d">' + d.join(" · ") + '</div></div><span class="chev">›</span></button>';
  }
  if (month) h += "</div>";
  if (without.length) h += '<div class="sec"><b>Ohne Geburtstag</b></div><div class="list">' + without.map(p =>
    '<button class="row" data-act="person" data-pid="' + esc(p.id) + '"><div class="avatar">' + esc(initials(p.name)) + '</div><div class="main"><div class="n">' + esc(p.name) +
    '</div><div class="d">' + (p.relation ? esc(p.relation) + " · " : "") + 'Datum fehlt</div></div><span class="chev">›</span></button>').join("") + "</div>";
  $("app").innerHTML = h;
}

// Geschenke: alle Anlässe inkl. Feiertage mit Stand der Geschenke
function renderGifts() {
  if (!S.persons.length) { $("app").innerHTML = emptyStart(); return; }
  const modeSeg = '<div class="seg" style="margin-top:12px"><button data-act="gmode" data-m="plan" class="' + (S.gmode !== "spend" ? "on" : "") + '">Planen</button>' +
    '<button data-act="gmode" data-m="spend" class="' + (S.gmode === "spend" ? "on" : "") + '">Ausgaben</button></div>';
  if (S.gmode === "spend") { $("app").innerHTML = modeSeg + renderSpending(); return; }
  const list = upcomingList();
  const open30 = list.filter(o => o.inDays <= 30 && stateOf(o.personId, o.key, o.year).key === "none").length;
  let h = modeSeg + '<div class="small" style="margin:12px 4px 0">Hier plant ihr Geschenke – für Geburtstage und, wenn bei einer Person eingeschaltet, für Weihnachten & Co.</div>';
  if (S.me) h += '<div class="seg" style="margin-top:12px"><button data-act="filter" data-f="alle" class="' + (S.filter !== "meine" ? "on" : "") + '">Alle</button>' +
    '<button data-act="filter" data-f="meine" class="' + (S.filter === "meine" ? "on" : "") + '">Kümmere ich mich (' + esc(S.me) + ")</button></div>";
  if (open30) h += '<div class="alert">' + (open30 === 1 ? "1 Anlass" : open30 + " Anlässe") + " in den nächsten 30 Tagen ohne Geschenk.</div>";
  if (!list.length) h += '<div class="empty">In den nächsten 12 Monaten steht nichts an.' + (S.filter === "meine" ? "<br>(Filter ist an.)" : "") + "</div>";
  const y = thisYear();
  let month = "";
  for (const o of list) {
    const ym = o.date.slice(0, 7);
    if (ym !== month) {
      if (month) h += "</div>";
      month = ym; const { y: yy, m } = O.parseIso(o.date);
      h += '<div class="sec"><b>' + O.MONTHS[m - 1] + (yy !== y ? " " + yy : "") + '</b></div><div class="list">';
    }
    h += occRow(o);
  }
  if (month) h += "</div>";
  $("app").innerHTML = h;
}

function occRow(o, showName = true) {
  const p = person(o.personId);
  const st = stateOf(o.personId, o.key, o.year);
  const { d } = O.parseIso(o.date);
  const round = o.round ? '<span class="pill round">' + (o.key === "geburtstag" ? "rund" : "Jubiläum") + "</span>" : "";
  const name = showName ? esc(p.name) + round : esc(O.occTitle(o)) + round;
  const bt = budgetText(p, o.key);
  const sub = (showName ? esc(O.occTitle(o)) + " · " : "") + O.fmtIn(o.inDays) + (bt ? " · " + bt : "");
  return '<button class="row" data-act="occ" data-pid="' + esc(o.personId) + '" data-key="' + esc(o.key) + '" data-year="' + o.year + '">' +
    '<div class="date' + (o.inDays <= 7 ? " soon" : "") + '"><b>' + d + "</b><small>" + O.WEEKDAYS[O.weekday(o.date)] + "</small></div>" +
    '<div class="main"><div class="n">' + name + '</div><div class="d">' + sub + " " + pill(st) + "</div></div>" +
    '<span class="chev">›</span></button>';
}

const REMIND_OPTS = [["", "Standard"], ["tag", "Nur am Tag selbst"], ["aus", "Aus"]];
function renderPerson() {
  const p = person(S.pid);
  if (!p) { S.view = S.back || "upcoming"; return render(); }
  const t = today();
  const all = O.upcoming([p], t, 365);
  const bdays = all.filter(birthdayOcc);
  const nb = bdays.find(o => o.key === "geburtstag");
  const ideas = S.ideas.filter(i => i.person_id === p.id);
  const gifts = S.gifts.filter(g => g.person_id === p.id).sort((a, b) => b.year - a.year || (b.created_at || "").localeCompare(a.created_at || ""));
  let h = "";

  // Geburtstag groß
  const age = O.ageOn(p, t);
  if (p.bday_day) {
    h += '<div class="hero"><div class="big">🎂</div><div><b>' + O.fmtDayMonth(p.bday_day, p.bday_month) + (p.bday_year ? " " + p.bday_year : "") + "</b>" +
      '<span class="hs">' + (nb ? (nb.inDays === 0 ? (nb.age ? "Wird heute " + nb.age + " 🎉" : "Hat heute Geburtstag 🎉") : (nb.age ? "Wird " + nb.age + " " : "Geburtstag ") + O.fmtIn(nb.inDays) + " (" + O.fmtDate(nb.date, { weekday: true }) + ")") : "") +
      (age !== null && nb && nb.inDays !== 0 ? " · jetzt " + age : "") + (nb && nb.round ? ' <span class="pill round">rund</span>' : "") + "</span></div></div>";
  } else {
    h += '<div class="hero"><div class="big">🎂</div><div><b>Kein Geburtstag eingetragen</b><span class="hs"><button class="linkbtn" style="padding:0" data-act="edit-person">Datum ergänzen</button></span></div></div>';
  }
  // weitere Termine
  const extras = bdays.filter(o => o.key !== "geburtstag");
  if (extras.length) h += '<div class="list" style="margin-bottom:12px">' + extras.map(o => '<div class="row" style="cursor:default"><div class="date"><b>' + O.parseIso(o.date).d + "</b><small>" +
    O.MONTHS_SHORT[O.parseIso(o.date).m - 1].replace(".", "") + '</small></div><div class="main"><div class="n">' + esc(O.occTitle(o)) + (o.round ? ' <span class="pill round">Jubiläum</span>' : "") +
    '</div><div class="d">' + O.fmtIn(o.inDays) + "</div></div></div>").join("") + "</div>";
  const partnerOfP = p.self ? S.persons.find(x => x.self && x.self !== p.self) : null;
  const rel = [p.relation ? esc(p.relation) : "", partnerOfP ? "💍 verheiratet mit " + esc(partnerOfP.name) : ""].filter(Boolean).join(" · ");
  if (rel) h += '<div class="small" style="margin:-4px 4px 12px">' + rel + "</div>";

  // Erinnerungen
  h += '<div class="card"><div class="flab">Erinnerungen für ' + esc(p.name.split(" ")[0]) + '</div>' + chipRow("p_remind", REMIND_OPTS, p.remind || "") +
    '<div class="small" style="margin-top:8px">' + remindText(p.remind) + "</div></div>";

  // Geschenke (Zusatz) – über mich selbst geheim
  if (isSecret(p.id)) {
    h += '<div class="gifthead">🎁 Geschenke</div><div class="card small" style="margin-top:10px">' +
      (S.me ? "Was " + esc(S.me === p.self ? "du" : p.name) + " geschenkt bekommst, bleibt hier verborgen – damit es eine Überraschung bleibt. 🤫"
        : "Bitte zuerst in den Einstellungen auswählen, wem dieses Handy gehört. Bis dahin bleiben Geschenke für Jonas und Clara verborgen.") + "</div>";
    $("app").innerHTML = h;
    singleChips("p_remind", k => { savePerson({ ...p, remind: k }); renderPerson(); toast(k === "aus" ? "Keine Erinnerungen für " + p.name : "Gespeichert"); });
    return;
  }
  h += '<div class="gifthead">🎁 Geschenke</div>';
  const giftOcc = all.slice(0, 4);
  h += '<div class="sec" style="margin-top:8px"><b>Nächste Anlässe</b></div>';
  h += giftOcc.length ? '<div class="list">' + giftOcc.map(o => occRow(o, false)).join("") + "</div>" : '<div class="card small">Kein Anlass eingetragen.</div>';

  h += '<div class="sec"><b>Ideen-Notizbuch</b><span class="small">' + (ideas.length || "") + "</span></div>";
  h += '<form class="add" id="ideaform"><input id="ideatext" placeholder="Idee notieren …" maxlength="300" autocomplete="off"><button type="submit" aria-label="Hinzufügen">+</button></form>';
  if (ideas.length) h += '<div class="list ideas">' + ideas.map(i => {
    const d = [];
    if (i.price != null) d.push("ca. " + euro(i.price));
    if (i.link) d.push('<a href="' + esc(i.link) + '" target="_blank" rel="noopener noreferrer">Link ↗</a>');
    if (i.added_by && i.added_by !== S.me) d.push('<span class="by">von ' + esc(i.added_by) + "</span>");
    return '<div class="row"><div class="main"><div class="n" style="font-weight:500;white-space:normal">' + esc(i.text) + "</div>" + (d.length ? '<div class="d">' + d.join(" · ") + "</div>" : "") +
      '</div><button class="more" data-act="idea" data-id="' + esc(i.id) + '" aria-label="Mehr">⋯</button></div>';
  }).join("") + "</div>";
  else h += '<div class="small" style="margin:0 4px">Wenn ' + esc(p.name.split(" ")[0]) + " unterm Jahr etwas erwähnt: hier notieren.</div>";

  h += '<div class="sec"><b>Bisherige Geschenke</b><button class="linkbtn" data-act="past-gift">+ Eintragen</button></div>';
  if (!gifts.length) h += '<div class="card small">Noch keine Geschenke eingetragen. Trage auch frühere ein – so wiederholt sich nichts.</div>';
  let yr = null;
  for (const g of gifts) {
    if (g.year !== yr) { if (yr !== null) h += "</div>"; yr = g.year; h += '<div class="yr">' + yr + '</div><div class="list">'; }
    const d = [esc(occLabel(p, g.occasion))]; if (g.price != null) d.push(euro(g.price));
    h += '<button class="row" data-act="gift" data-id="' + esc(g.id) + '"><div class="main"><div class="n">' + esc(g.title) + '</div><div class="d">' + d.join(" · ") + " " +
      pill({ key: g.status, label: STATUS_LABEL[g.status] }) + " " + stars(g.rating) + '</div></div><span class="chev">›</span></button>';
  }
  if (yr !== null) h += "</div>";

  h += '<div class="sec"><b>Was wir wissen</b><button class="linkbtn" data-act="edit-person">Bearbeiten</button></div><div class="card">';
  const rows = [];
  const budgets = Object.keys(p.budgets || {}).map(k => occLabel(p, k) + " " + budgetText(p, k)).filter(x => !/ $/.test(x));
  if (budgets.length) rows.push('<div class="kv"><span>Budget</span><b>' + esc(budgets.join(", ")) + "</b></div>");
  if (p.responsible) rows.push('<div class="kv"><span>Kümmert sich</span><b>' + esc(p.responsible) + "</b></div>");
  if ((p.holidays || []).length) rows.push('<div class="kv"><span>Auch schenken an</span><b>' + esc(p.holidays.map(k => occLabel(p, k)).join(", ")) + "</b></div>");
  const know = [];
  if (rows.length) know.push(rows.join(""));
  if ((p.interests || []).length) know.push('<div class="lab">Interessen</div><div class="tags">' + p.interests.map(i => '<span class="tag">' + esc(i) + "</span>").join("") + "</div>");
  if (p.dislikes) know.push('<div class="lab">Mag nicht / hat schon</div><div class="txt">' + esc(p.dislikes) + "</div>");
  if (p.notes) know.push('<div class="lab">Notizen</div><div class="txt">' + esc(p.notes) + "</div>");
  h += know.length ? know.join("") : '<div class="small">Interessen, Größen, Wünsche – hilft beim Schenken. Alles freiwillig. Ein Budget legt ihr pro Anlass fest: Anlass oben antippen.</div>';
  h += "</div>";
  $("app").innerHTML = h;

  singleChips("p_remind", k => { savePerson({ ...p, remind: k }); renderPerson(); toast(k === "aus" ? "Keine Erinnerungen für " + p.name : "Gespeichert"); });
  $("ideaform").onsubmit = e => {
    e.preventDefault();
    const v = $("ideatext").value.trim(); if (!v) return;
    saveIdea({ id: uid("i"), person_id: p.id, text: v.slice(0, 300), link: "", price: null, added_by: S.me, created_at: nowIso() });
    renderPerson(); $("ideatext").focus(); toast("Idee notiert");
  };
}
function remindText(mode) {
  const cfg = S.settings || {};
  const days = (cfg.remind_days || [30, 15, 7, 0]);
  if (mode === "aus") return "Für diese Person kommen keine Erinnerungen.";
  if (mode === "tag") return "Nur am Tag selbst um " + (cfg.remind_hour ?? 9) + " Uhr.";
  return "Wie in den Einstellungen: " + daysText(days) + ", jeweils um " + (cfg.remind_hour ?? 9) + " Uhr.";
}
function daysText(days) {
  const parts = days.slice().sort((a, b) => b - a).map(d => d === 0 ? "am Tag selbst" : d === 1 ? "1 Tag vorher" : d + " Tage vorher");
  return parts.length > 1 ? parts.slice(0, -1).join(", ") + " und " + parts[parts.length - 1] : (parts[0] || "nie");
}

/* ---------- Dialoge ---------- */
function closeModal() { $("modal").innerHTML = ""; render(); }
function sheet(inner) {
  $("modal").innerHTML = '<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true">' + inner + "</div></div>";
  $("scrim").onclick = e => { if (e.target.id === "scrim") closeModal(); };
  return $("modal").querySelector(".sheet");
}
const chipRow = (id, opts, cur) => '<div class="chips" id="' + id + '">' + opts.map(([k, l]) => '<button type="button" data-k="' + esc(k) + '" class="' + (k === cur ? "on" : "") + '">' + esc(l) + "</button>").join("") + "</div>";
function chipValue(id) { const b = $(id) && $(id).querySelector("button.on"); return b ? b.dataset.k : ""; }
function singleChips(id, onChange) {
  const box = $(id); if (!box) return;
  box.onclick = e => { const b = e.target.closest("button"); if (!b) return; box.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); if (onChange) onChange(b.dataset.k); };
}
const peopleOpts = () => [["", "Beide"]].concat(S.people.map(p => [p, p]));

// Person anlegen / bearbeiten
function openPersonForm(id) {
  const old = id ? person(id) : null;
  const p = old ? JSON.parse(JSON.stringify(old)) : { id: uid("p"), name: "", relation: "", bday_day: null, bday_month: null, bday_year: null, holidays: [], extra: [],
    interests: [], dislikes: "", notes: "", budgets: {}, responsible: "", remind: "", self: "" };
  const hasGiftInfo = p.responsible || (p.holidays || []).length || (p.interests || []).length || p.dislikes || p.notes;
  const secret = old && isSecret(p.id);
  let extra = (p.extra || []).map(x => ({ ...x }));
  const dayOpts = sel => '<option value="">Tag</option>' + Array.from({ length: 31 }, (_, i) => '<option' + (sel === i + 1 ? " selected" : "") + ">" + (i + 1) + "</option>").join("");
  const monOpts = sel => '<option value="">Monat</option>' + O.MONTHS.map((m, i) => '<option value="' + (i + 1) + '"' + (sel === i + 1 ? " selected" : "") + ">" + m + "</option>").join("");
  const m = sheet(
    "<h3>" + (old ? "Person bearbeiten" : "Neuer Geburtstag") + '</h3><div class="sub">Nur der Name ist Pflicht.</div>' +
    '<label class="f"><span>Name</span><input id="f_name" maxlength="80" value="' + esc(p.name) + '" autocomplete="off"></label>' +
    '<div class="flab">Geburtstag (Jahr freiwillig – dann zeigt die App das Alter)</div><div class="three" style="margin-bottom:12px">' +
    '<select id="f_d">' + dayOpts(p.bday_day) + '</select><select id="f_m">' + monOpts(p.bday_month) + "</select>" +
    '<input id="f_y" inputmode="numeric" maxlength="4" placeholder="Jahr" value="' + esc(p.bday_year || "") + '"></div>' +
    '<label class="f"><span>Beziehung</span><input id="f_rel" list="rels" maxlength="40" value="' + esc(p.relation) + '" placeholder="z. B. Familie, Freunde"><datalist id="rels">' +
    RELATIONS.map(r => '<option value="' + r + '">').join("") + "</datalist></label>" +
    '<div class="flab">Weitere Termine (Hochzeitstag, Namenstag …)</div><div id="f_extra"></div>' +
    '<button type="button" class="linkbtn" id="f_addx">+ Termin hinzufügen</button>' +
    '<div class="flab" style="margin-top:12px">Erinnerungen</div>' + chipRow("f_remind", REMIND_OPTS, p.remind || "") +
    '<div class="flab" style="margin-top:12px">Ist das einer von euch beiden?</div>' + chipRow("f_self", [["", "Nein"]].concat(S.people.map(n => [n, n])), p.self || "") +
    (secret ? "" : '<details class="more-sec"' + (hasGiftInfo ? " open" : "") + '><summary>🎁 Für Geschenke (optional)</summary>' +
    '<div class="flab">Wer kümmert sich normalerweise ums Geschenk?</div>' + chipRow("f_resp", peopleOpts(), p.responsible || "") +
    '<div class="flab" style="margin-top:14px">Auch an diesen Tagen schenken</div><div class="chips" id="f_hol">' +
    O.HOLIDAYS.map(h => '<button type="button" data-k="' + h.key + '" class="' + ((p.holidays || []).includes(h.key) ? "on" : "") + '">' + h.label + "</button>").join("") + "</div>" +
    '<label class="f" style="margin-top:14px"><span>Interessen (mit Komma trennen)</span><input id="f_int" value="' + esc((p.interests || []).join(", ")) + '" placeholder="z. B. Kochen, Wandern, Krimis"></label>' +
    '<label class="f"><span>Mag nicht / hat schon</span><textarea id="f_dis" maxlength="1000">' + esc(p.dislikes) + "</textarea></label>" +
    '<label class="f"><span>Notizen (Größen, Wünsche, Lieblingsfarbe …)</span><textarea id="f_notes" maxlength="3000">' + esc(p.notes) + "</textarea></label>" +
    '<div class="small" style="margin-bottom:10px">Das Budget legt ihr pro Anlass fest (Geburtstag, Weihnachten …): auf der Personenseite den Anlass antippen.</div>' +
    "</details>") +
    '<div class="acts"><button class="btn ghost" id="f_cancel">Abbrechen</button><button class="btn" id="f_save">Speichern</button></div>' +
    (old ? '<button class="btn danger block" id="f_del" style="margin-top:14px">Person löschen</button>' : "")
  );
  singleChips("f_resp"); singleChips("f_remind"); singleChips("f_self");
  if ($("f_hol")) $("f_hol").onclick = e => { const b = e.target.closest("button"); if (b) b.classList.toggle("on"); };
  function syncExtra() {
    extra = extra.map((x, i) => ({ id: x.id, label: ($("x_l" + i) || {}).value || "", d: Number(($("x_d" + i) || {}).value) || null, m: Number(($("x_m" + i) || {}).value) || null,
      y: numOrNull(($("x_y" + i) || {}).value) }));
  }
  function drawExtra() {
    $("f_extra").innerHTML = extra.map((x, i) => '<div class="xrow"><input id="x_l' + i + '" placeholder="z. B. Hochzeitstag" maxlength="40" value="' + esc(x.label) + '">' +
      '<select id="x_d' + i + '">' + dayOpts(x.d) + '</select><select id="x_m' + i + '">' + monOpts(x.m) + "</select>" +
      '<input id="x_y' + i + '" inputmode="numeric" maxlength="4" placeholder="Jahr" value="' + esc(x.y || "") + '"><button type="button" data-rm="' + i + '" aria-label="Entfernen">✕</button></div>').join("");
  }
  drawExtra();
  $("f_extra").onclick = e => { const b = e.target.closest("[data-rm]"); if (!b) return; syncExtra(); extra.splice(Number(b.dataset.rm), 1); drawExtra(); };
  $("f_addx").onclick = () => { syncExtra(); extra.push({ id: uid("x"), label: "", d: null, m: null, y: null }); drawExtra(); };
  $("f_cancel").onclick = closeModal;
  if (!old) setTimeout(() => $("f_name").focus(), 50);
  if (old) $("f_del").onclick = e => {
    if (e.target.dataset.sure) { deletePerson(p.id); $("modal").innerHTML = ""; S.view = "persons"; render(); toast("„" + p.name + "“ gelöscht"); return; }
    e.target.dataset.sure = "1"; e.target.textContent = "Wirklich löschen? Ideen und Geschenke gehen mit verloren.";
  };
  $("f_save").onclick = () => {
    syncExtra();
    const name = $("f_name").value.trim();
    if (!name) { toast("Bitte einen Namen eingeben."); $("f_name").focus(); return; }
    const d = Number($("f_d").value) || null, mo = Number($("f_m").value) || null, y = numOrNull($("f_y").value);
    if ((d === null) !== (mo === null)) { toast("Beim Geburtstag bitte Tag und Monat auswählen."); return; }
    if (Number.isNaN(y) || (y !== null && (y < 1900 || y > thisYear()))) { toast("Das Geburtsjahr sieht nicht richtig aus."); return; }
    if (y !== null && d === null) { toast("Ein Geburtsjahr geht nur zusammen mit Tag und Monat."); return; }
    if (d && d > O.daysInMonth(y || 2000, mo)) { toast("Diesen Tag gibt es in dem Monat nicht."); return; }
    const ex = [];
    for (const x of extra) {
      if (!x.label.trim() && !x.d && !x.m) continue;
      if (!x.d || !x.m) { toast("Bei „" + (x.label || "Termin") + "“ fehlen Tag oder Monat."); return; }
      if (Number.isNaN(x.y) || (x.y !== null && (x.y < 1900 || x.y > thisYear() + 1))) { toast("Bei „" + (x.label || "Termin") + "“ stimmt das Jahr nicht."); return; }
      if (x.d > O.daysInMonth(x.y || 2000, x.m)) { toast("Bei „" + (x.label || "Termin") + "“ gibt es diesen Tag nicht."); return; }
      ex.push(x.y ? { id: x.id, label: x.label.trim() || "Termin", d: x.d, m: x.m, y: x.y } : { id: x.id, label: x.label.trim() || "Termin", d: x.d, m: x.m });
    }
    const out = { ...p, name: name.slice(0, 80), relation: $("f_rel").value.trim().slice(0, 40), bday_day: d, bday_month: mo, bday_year: y, extra: ex,
      remind: chipValue("f_remind"), self: chipValue("f_self") };
    if (!secret) Object.assign(out, { holidays: [...$("f_hol").querySelectorAll("button.on")].map(b => b.dataset.k),
      interests: $("f_int").value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean).slice(0, 30),
      dislikes: $("f_dis").value.trim(), notes: $("f_notes").value.trim(), responsible: chipValue("f_resp") });
    // „Das bin ich“ gibt es nur einmal pro Person
    if (out.self) for (const q of S.persons) if (q.id !== out.id && q.self === out.self) q.self = "";
    savePerson(out);
    $("modal").innerHTML = "";
    if (!old) return goPerson(out.id, "angelegt");
    render(); toast("Gespeichert");
  };
}

// Ein Anlass: Geschenke dafür, Ideen übernehmen, früher Geschenktes
function openOccasion(pid, key, year) {
  const p = person(pid); if (!p || isSecret(pid)) return;
  const o = O.occasionsInYear(p, year).find(x => x.key === key) || { key, label: occLabel(p, key), date: null, year, age: null };
  const gs = giftsFor(pid, key, year);
  const ideas = S.ideas.filter(i => i.person_id === pid);
  const past = S.gifts.filter(g => g.person_id === pid && !(g.occasion === key && g.year === year) && g.status !== "nichts")
    .sort((a, b) => b.year - a.year).slice(0, 6);
  const sub = [];
  if (o.date) sub.push(O.fmtDate(o.date, { weekday: true, long: true, year: true }) + " · " + O.fmtIn(O.daysBetween(today(), o.date)));
  let h = "<h3>" + esc(p.name) + " – " + esc(O.occTitle(o)) + (o.round ? ' <span class="pill round">rund</span>' : "") + '</h3><div class="sub">' + esc(sub.join(" · ")) + "</div>";
  const bt = budgetText(p, key), bud = (p.budgets || {})[key] || {};
  h += '<div class="budget" id="o_budget"><span>💶 Budget für ' + esc(occLabel(p, key)) + ": <b>" + (bt || "keins") + '</b></span><button class="linkbtn" id="o_bedit">' + (bt ? "Ändern" : "Festlegen") + "</button></div>" +
    '<div class="budget-edit" id="o_bform" style="display:none"><div class="two"><input id="o_bmin" inputmode="numeric" placeholder="von €" value="' + esc(bud.min ?? "") + '">' +
    '<input id="o_bmax" inputmode="numeric" placeholder="bis €" value="' + esc(bud.max ?? "") + '"></div><div class="small" style="margin:6px 0">Gilt jedes Jahr für ' + esc(occLabel(p, key)) + ".</div>" +
    '<button class="btn sm" id="o_bsave">Budget speichern</button></div>';
  if (!gs.length) h += '<div class="small" style="margin:0 0 12px">Noch nichts geplant.</div>';
  for (const g of gs) {
    if (g.status === "nichts") {
      h += '<div class="gift"><div class="top"><b>Diesmal nichts</b><button class="linkbtn" data-undo-nothing="' + esc(g.id) + '">Doch schenken</button></div></div>';
      continue;
    }
    const d = []; if (g.price != null) d.push(euro(g.price)); d.push("kümmert sich: " + whoText(g.who)); if (g.note) d.push(esc(g.note));
    h += '<div class="gift"><div class="top"><div><b>' + esc(g.title) + '</b><div class="d">' + d.join(" · ") + '</div></div><button class="linkbtn" data-edit="' + esc(g.id) + '">Ändern</button></div>' +
      '<div class="steps">' + STATUS.map(s => '<button data-gid="' + esc(g.id) + '" data-st="' + s.key + '" class="' + (g.status === s.key ? "on" : "") + '">' + s.label + "</button>").join("") + "</div>" +
      (g.status === "ueberreicht" ? '<div class="flab" style="margin-top:10px">Wie kam es an?</div><div class="chips">' +
        RATINGS.map(([k, l]) => '<button data-gid="' + esc(g.id) + '" data-rate="' + k + '" class="' + (g.rating === k ? "on" : "") + '">' + l + "</button>").join("") + "</div>" : "") +
      "</div>";
  }
  h += '<div class="acts" style="margin-top:4px"><button class="btn" id="o_add">+ Geschenk eintragen</button>' + (gs.length ? "" : '<button class="btn ghost" id="o_none">Diesmal nichts</button>') + "</div>";
  // KI-Vorschläge
  const sk = pid + "|" + key + "|" + year, sg = (S.sugg || {})[sk];
  h += '<div class="aibox"><div class="flab">✨ Geschenkideen vorschlagen lassen</div>' +
    '<div class="two"><input id="o_wish" maxlength="200" placeholder="Wunsch, z. B. „eher ein Erlebnis“" value="' + esc(sg ? sg.wish : "") + '"><button class="btn sm" id="o_ai">' + (sg ? "Neue Ideen" : "Vorschlagen") + "</button></div>" +
    '<div class="small" style="margin-top:6px">Nutzt Interessen, Notizen, frühere Geschenke und das Budget. Kostenlos über Cloudflare.</div>' +
    (sg ? '<div class="sugglist">' + sg.list.map((x, i) =>
      '<div class="sugg"><div><b>' + esc(x.title) + "</b>" + (x.price != null ? ' <span class="small">ca. ' + x.price + " €</span>" : "") + (x.why ? '<div class="small">' + esc(x.why) + "</div>" : "") +
      '</div><div class="sb"><button class="btn sm" data-sugg="' + i + '" data-to="gift">Nehmen</button><button class="btn ghost sm" data-sugg="' + i + '" data-to="idea">Merken</button></div></div>').join("") + "</div>" : "") +
    "</div>";
  if (ideas.length) h += '<div class="flab" style="margin-top:18px">Aus dem Ideen-Notizbuch übernehmen</div><div class="picklist">' +
    ideas.map(i => '<button data-idea="' + esc(i.id) + '"><span>' + esc(i.text) + "</span><small>" + (i.price != null ? "ca. " + euro(i.price) : "übernehmen") + "</small></button>").join("") + "</div>";
  if (past.length) h += '<div class="flab" style="margin-top:18px">Früher geschenkt</div><div class="list">' + past.map(g =>
    '<div class="row" style="cursor:default"><div class="main"><div class="n" style="font-weight:500">' + esc(g.title) + '</div><div class="d">' + g.year + " · " + esc(occLabel(p, g.occasion)) +
    (g.price != null ? " · " + euro(g.price) : "") + " " + stars(g.rating) + "</div></div></div>").join("") + "</div>";
  h += '<div class="acts"><button class="btn ghost" id="o_person">Zu ' + esc(p.name.split(" ")[0]) + '</button><button class="btn ghost" id="o_close">Schließen</button></div>';
  const m = sheet(h);
  const again = () => openOccasion(pid, key, year);
  m.onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.st) { const g = S.gifts.find(x => x.id === b.dataset.gid); if (g) { saveGift({ ...g, status: b.dataset.st }); again(); } }
    else if (b.dataset.rate) { const g = S.gifts.find(x => x.id === b.dataset.gid); if (g) { const r = Number(b.dataset.rate); saveGift({ ...g, rating: g.rating === r ? 0 : r }); again(); } }
    else if (b.dataset.edit) openGiftForm(b.dataset.edit, null, again);
    else if (b.dataset.undoNothing) { deleteGift(b.dataset.undoNothing); again(); }
    else if (b.dataset.sugg) {
      const x = ((S.sugg || {})[sk] || { list: [] }).list[Number(b.dataset.sugg)]; if (!x) return;
      if (b.dataset.to === "gift") { saveGift({ id: uid("g"), person_id: pid, occasion: key, year, title: x.title, price: x.price, status: "idee", rating: 0, note: x.why || "", who: defaultWho(p), created_at: nowIso() }); toast("Als Geschenk-Idee eingetragen"); }
      else { saveIdea({ id: uid("i"), person_id: pid, text: x.title + (x.why ? " – " + x.why : ""), link: "", price: x.price, added_by: S.me, created_at: nowIso() }); toast("Im Ideen-Notizbuch gemerkt"); }
      S.sugg[sk].list.splice(Number(b.dataset.sugg), 1); again();
    }
    else if (b.dataset.idea) {
      const i = S.ideas.find(x => x.id === b.dataset.idea); if (!i) return;
      saveGift({ id: uid("g"), person_id: pid, occasion: key, year, title: i.text.slice(0, 160), price: i.price, status: "idee", rating: 0,
        note: i.link || "", who: defaultWho(p), created_at: nowIso() });
      deleteIdea(i.id, true); again(); toast("Idee übernommen");
    }
  };
  $("o_add").onclick = () => openGiftForm(null, { person_id: pid, occasion: key, year }, again);
  $("o_ai").onclick = async e => {
    const btn = e.target, wish = $("o_wish").value.trim();
    btn.disabled = true; btn.textContent = "Denkt nach …";
    try {
      const r = await api("POST", "/api/suggest", { person_id: pid, occasion: key, year, wish });
      S.sugg = S.sugg || {}; S.sugg[sk] = { wish, list: r.suggestions || [] };
      if ($("modal").innerHTML) again();
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = "Vorschlagen"; }
  };
  $("o_bedit").onclick = () => { $("o_bform").style.display = ""; $("o_budget").style.display = "none"; $("o_bmax").focus(); };
  $("o_bsave").onclick = () => {
    const mn = numOrNull($("o_bmin").value), mx = numOrNull($("o_bmax").value);
    if (Number.isNaN(mn) || Number.isNaN(mx)) { toast("Bitte nur Zahlen eingeben."); return; }
    if (mn != null && mx != null && mn > mx) { toast("„von“ ist größer als „bis“."); return; }
    const budgets = { ...(p.budgets || {}) };
    if (mn == null && mx == null) delete budgets[key]; else budgets[key] = mn == null ? { max: mx } : mx == null ? { min: mn } : { min: mn, max: mx };
    savePerson({ ...p, budgets }); toast("Budget gespeichert"); again();
  };
  if ($("o_none")) $("o_none").onclick = () => { saveGift({ id: uid("g"), person_id: pid, occasion: key, year, title: "Diesmal nichts", price: null, status: "nichts", rating: 0, note: "", who: "", created_at: nowIso() }); again(); };
  $("o_close").onclick = closeModal;
  $("o_person").onclick = () => { $("modal").innerHTML = ""; goPerson(pid); };
}

// Geschenk eintragen / bearbeiten. after = was danach angezeigt wird (z. B. zurück zum Anlass)
function openGiftForm(id, defaults, after) {
  const old = id ? S.gifts.find(g => g.id === id) : null;
  const g = old ? { ...old } : { id: uid("g"), person_id: defaults.person_id, occasion: defaults.occasion || "geburtstag", year: defaults.year || thisYear(), title: "", price: null,
    status: defaults.status || "idee", rating: 0, note: "", who: defaultWho(person(defaults.person_id)), created_at: nowIso() };
  const p = person(g.person_id); if (!p || isSecret(p.id)) return;
  const occs = [];
  if (p.bday_day) occs.push(["geburtstag", "Geburtstag"]);
  for (const x of p.extra || []) occs.push(["x:" + x.id, x.label]);
  for (const h of O.HOLIDAYS) occs.push([h.key, h.label]);
  if (!occs.some(([k]) => k === g.occasion)) occs.unshift([g.occasion, occLabel(p, g.occasion)]);
  const done = () => { $("modal").innerHTML = ""; if (after) after(); else render(); };
  const m = sheet(
    "<h3>" + (old ? "Geschenk bearbeiten" : "Geschenk eintragen") + '</h3><div class="sub">für ' + esc(p.name) + (budgetText(p, g.occasion) ? " · Budget " + budgetText(p, g.occasion) : "") + "</div>" +
    '<label class="f"><span>Was?</span><input id="g_title" maxlength="160" value="' + esc(g.title === "Diesmal nichts" ? "" : g.title) + '" placeholder="z. B. Kochkurs für zwei"></label>' +
    '<div class="two"><label class="f"><span>Anlass</span><select id="g_occ">' + occs.map(([k, l]) => '<option value="' + esc(k) + '"' + (k === g.occasion ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select></label>" +
    '<label class="f"><span>Jahr</span><input id="g_year" inputmode="numeric" maxlength="4" value="' + g.year + '"></label></div>' +
    '<label class="f"><span>Preis in Euro</span><input id="g_price" inputmode="numeric" value="' + esc(g.price ?? "") + '" placeholder="freiwillig"></label>' +
    '<div class="flab">Stand</div>' + chipRow("g_status", STATUS.map(s => [s.key, s.label]), g.status === "nichts" ? "idee" : g.status) +
    '<div id="g_ratebox" style="margin-top:12px' + (g.status === "ueberreicht" ? "" : ";display:none") + '"><div class="flab">Wie kam es an?</div>' + chipRow("g_rate", RATINGS.map(([k, l]) => [String(k), l]), String(g.rating || "")) + "</div>" +
    '<div class="flab" style="margin-top:12px">Wer kümmert sich?</div>' + chipRow("g_who", peopleOpts(), g.who || "") +
    '<label class="f" style="margin-top:12px"><span>Notiz (wo gekauft, Link …)</span><textarea id="g_note" maxlength="1000">' + esc(g.note) + "</textarea></label>" +
    '<div class="acts"><button class="btn ghost" id="g_cancel">Abbrechen</button><button class="btn" id="g_save">Speichern</button></div>' +
    (old ? '<button class="btn danger block" id="g_del" style="margin-top:14px">Geschenk löschen</button>' : "")
  );
  singleChips("g_status", k => { $("g_ratebox").style.display = k === "ueberreicht" ? "" : "none"; });
  $("g_rate").onclick = e => { const b = e.target.closest("button"); if (!b) return; const on = b.classList.contains("on"); $("g_rate").querySelectorAll("button").forEach(x => x.classList.remove("on")); if (!on) b.classList.add("on"); };
  singleChips("g_who");
  if (!old) setTimeout(() => $("g_title").focus(), 50);
  $("g_cancel").onclick = done;
  if (old) $("g_del").onclick = () => { deleteGift(g.id); done(); };
  $("g_save").onclick = () => {
    const title = $("g_title").value.trim();
    if (!title) { toast("Bitte eintragen, was es ist."); $("g_title").focus(); return; }
    const year = numOrNull($("g_year").value);
    if (!year || year < 1950 || year > thisYear() + 2) { toast("Das Jahr sieht nicht richtig aus."); return; }
    const price = numOrNull($("g_price").value);
    if (Number.isNaN(price)) { toast("Beim Preis bitte nur eine Zahl eingeben."); return; }
    const status = chipValue("g_status") || "idee";
    saveGift({ ...g, title, occasion: $("g_occ").value, year, price, status, rating: status === "ueberreicht" ? Number(chipValue("g_rate")) || 0 : g.rating,
      who: chipValue("g_who"), note: $("g_note").value.trim() });
    toast("Gespeichert"); done();
  };
}

// Idee bearbeiten oder für einen Anlass einplanen
function openIdea(id) {
  const i = S.ideas.find(x => x.id === id); if (!i) return;
  const p = person(i.person_id);
  const occ = p ? O.upcoming([p], today(), 365) : [];
  const m = sheet(
    '<h3>Idee</h3><div class="sub">für ' + esc(p ? p.name : "") + (i.added_by ? " · notiert von " + esc(i.added_by) : "") + "</div>" +
    '<label class="f"><span>Idee</span><textarea id="i_text" maxlength="300">' + esc(i.text) + "</textarea></label>" +
    '<div class="two"><label class="f"><span>Preis ca. (€)</span><input id="i_price" inputmode="numeric" value="' + esc(i.price ?? "") + '"></label>' +
    '<label class="f"><span>Link</span><input id="i_link" type="url" inputmode="url" value="' + esc(i.link) + '" placeholder="https://…"></label></div>' +
    '<div class="acts"><button class="btn ghost" id="i_cancel">Abbrechen</button><button class="btn" id="i_save">Speichern</button></div>' +
    (occ.length ? '<div class="hr"></div><div class="flab">Für einen Anlass einplanen</div><div class="two"><select id="i_occ">' +
      occ.map(o => '<option value="' + esc(o.key + "|" + o.year) + '">' + esc(O.occTitle(o)) + " · " + O.fmtDate(o.date) + (o.year !== thisYear() ? " " + o.year : "") + "</option>").join("") +
      '</select><button class="btn" id="i_plan">Einplanen</button></div>' : "") +
    '<button class="btn danger block" id="i_del" style="margin-top:16px">Idee löschen</button>'
  );
  const read = () => {
    const text = $("i_text").value.trim(); const price = numOrNull($("i_price").value); const linkRaw = $("i_link").value.trim();
    if (!text) { toast("Die Idee ist leer."); return null; }
    if (Number.isNaN(price)) { toast("Beim Preis bitte nur eine Zahl eingeben."); return null; }
    let link = "";
    if (linkRaw) { try { const u = new URL(/^https?:\/\//i.test(linkRaw) ? linkRaw : "https://" + linkRaw); link = u.href; } catch (e) { toast("Der Link sieht nicht richtig aus."); return null; } }
    return { ...i, text, price, link };
  };
  $("i_cancel").onclick = closeModal;
  $("i_save").onclick = () => { const v = read(); if (!v) return; saveIdea(v); closeModal(); toast("Gespeichert"); };
  $("i_del").onclick = () => { $("modal").innerHTML = ""; deleteIdea(i.id); render(); };
  if ($("i_plan")) $("i_plan").onclick = () => {
    const v = read(); if (!v) return;
    const [key, year] = $("i_occ").value.split("|");
    saveGift({ id: uid("g"), person_id: i.person_id, occasion: key, year: Number(year), title: v.text.slice(0, 160), price: v.price, status: "idee", rating: 0,
      note: v.link || "", who: defaultWho(p), created_at: nowIso() });
    deleteIdea(i.id, true);
    openOccasion(i.person_id, key, Number(year)); toast("Eingeplant");
  };
}

// Einstellungen: wem gehört das Handy, Erinnerungen (Push, E-Mail, Kalender), Passwort
const LEAD_OPTS = [0, 1, 3, 7, 14, 15, 30, 60];
function openMenu() {
  const cfg = S.settings || { remind_days: [30, 15, 7, 0], remind_hour: 9, remind_holidays: true };
  const usesHolidays = S.persons.some(p => (p.holidays || []).length);
  const m = sheet(
    "<h3>Einstellungen</h3>" + '<div class="sub">Geburtstage v' + VERSION + "</div>" +
    '<div class="flab">Dieses Handy gehört</div>' + chipRow("m_me", S.people.map(p => [p, p]), S.me) +
    '<div class="hr"></div><h4>🔔 Erinnerungen</h4>' +
    '<div class="flab">Wann erinnern? (gilt für euch beide)</div><div class="chips" id="m_days">' +
    LEAD_OPTS.map(d => '<button type="button" data-k="' + d + '" class="' + (cfg.remind_days.includes(d) ? "on" : "") + '">' + (d === 0 ? "Am Tag selbst" : d === 1 ? "1 Tag vorher" : d + " Tage vorher") + "</button>").join("") + "</div>" +
    '<div class="two" style="margin-top:12px;align-items:center"><span class="flab" style="margin:0">Uhrzeit</span><select id="m_hour">' +
    Array.from({ length: 17 }, (_, i) => i + 6).map(h => '<option value="' + h + '"' + (h === cfg.remind_hour ? " selected" : "") + ">" + h + ":00 Uhr</option>").join("") + "</select></div>" +
    (usesHolidays ? '<label class="check"><input type="checkbox" id="m_hol"' + (cfg.remind_holidays ? " checked" : "") + "> Auch vor Weihnachten & Co. erinnern (für Geschenke)</label>" : "") +
    '<div class="flab" style="margin-top:16px">Push-Nachricht auf diesem Handy</div><div id="pushbox" class="small">Wird geprüft …</div>' +
    '<div class="flab" style="margin-top:16px">Im Handy-Kalender anzeigen</div><div id="calbox"><button class="btn ghost block" id="m_cal">Kalender-Abo einrichten</button></div>' +
    '<div class="hr"></div><div class="flab">Passwort ändern</div>' +
    '<input id="m_old" type="password" autocomplete="current-password" placeholder="Aktuelles Passwort" style="margin-bottom:8px">' +
    '<input id="m_new" type="password" autocomplete="new-password" placeholder="Neues Passwort (mind. 8 Zeichen)" style="margin-bottom:8px">' +
    '<button class="btn ghost block" id="m_pw">Passwort ändern</button>' +
    '<div class="hr"></div><a class="btn danger block" href="/logout" style="text-align:center;text-decoration:none">Abmelden</a>' +
    '<button class="btn ghost block" id="m_close">Schließen</button>'
  );
  singleChips("m_me", k => { setMe(k); toast("Dieses Handy gehört " + k); openMenu(); });
  $("m_close").onclick = closeModal;
  const saveSettings = async body => {
    try { const r = await api("POST", "/api/settings", body); S.settings = r.settings; saveLocal(); toast("Gespeichert"); return true; }
    catch (err) { toast(err.message); return false; }
  };
  $("m_days").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    const on = [...$("m_days").querySelectorAll("button.on")].map(x => Number(x.dataset.k));
    const k = Number(b.dataset.k);
    const next = on.includes(k) ? on.filter(x => x !== k) : on.concat(k);
    if (next.length > 6) { toast("Höchstens 6 Zeitpunkte"); return; }
    b.classList.toggle("on");
    saveSettings({ remind_days: next });
  };
  $("m_hour").onchange = () => saveSettings({ remind_hour: Number($("m_hour").value) });
  if ($("m_hol")) $("m_hol").onchange = () => saveSettings({ remind_holidays: $("m_hol").checked });
  $("m_cal").onclick = () => showCalendar(false);
  $("m_pw").onclick = async e => {
    const b = e.target; b.disabled = true;
    try { await api("POST", "/api/password", { old: $("m_old").value, new: $("m_new").value }); toast("Passwort geändert"); $("m_old").value = ""; $("m_new").value = ""; }
    catch (err) { toast(err.message); } finally { b.disabled = false; }
  };
  drawPush();
}
async function showCalendar(fresh) {
  const box = $("calbox"); if (!box) return;
  try {
    const { url } = await api(fresh ? "POST" : "GET", fresh ? "/api/calendar/new" : "/api/calendar", fresh ? {} : undefined);
    const webcal = url.replace(/^https:/, "webcal:");
    box.innerHTML = '<a class="btn block" href="' + esc(webcal) + '" style="text-align:center;text-decoration:none">Im Kalender abonnieren</a>' +
      '<div class="small">Alle Geburtstage erscheinen dann automatisch im Kalender (iPhone & Mac: Antippen genügt). Für Google Kalender den Link kopieren und dort unter „Andere Kalender → Per URL“ einfügen.</div>' +
      '<div class="two" style="margin-top:8px"><button class="btn ghost sm" id="c_copy">Link kopieren</button><button class="btn ghost sm" id="c_new">Neuer Link</button></div>' +
      '<div class="small" style="margin-top:6px">„Neuer Link“ macht den alten ungültig – falls ihn jemand Falsches bekommen hat.</div>';
    $("c_copy").onclick = async () => { try { await navigator.clipboard.writeText(url); toast("Link kopiert"); } catch (e) { prompt("Link kopieren:", url); } };
    $("c_new").onclick = () => { showCalendar(true); toast("Neuer Link erstellt – bitte neu abonnieren"); };
  } catch (err) { toast(err.message); }
}

/* ---------- Wer bin ich & Push ---------- */
function setMe(p) { S.me = p; saveLocal(); if (S.pushOn) enablePush(true).catch(() => {}); }
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
function keyBytes(b64) { const s = b64.replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(s + "===".slice((s.length + 3) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); }
async function swReg() { return navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready); }
async function currentSub() { if (!pushSupported()) return null; try { const r = await navigator.serviceWorker.getRegistration("/"); return r ? await r.pushManager.getSubscription() : null; } catch (e) { return null; } }
async function enablePush(silent) {
  if (!S.me) throw new Error("Bitte zuerst auswählen, wem dieses Handy gehört.");
  const reg = await swReg();
  if (Notification.permission !== "granted") {
    const p = await Notification.requestPermission();
    if (p !== "granted") throw new Error("Benachrichtigungen wurden nicht erlaubt. Du kannst sie in den Einstellungen des Handys erlauben.");
  }
  const { key } = await api("GET", "/api/push/key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const j = sub.toJSON();
  await api("POST", "/api/push/subscribe", { endpoint: j.endpoint, keys: j.keys, person: S.me });
  S.pushOn = true;
  if (!silent) await api("POST", "/api/push/test", { endpoint: j.endpoint });
}
async function disablePush() {
  const sub = await currentSub(); if (!sub) { S.pushOn = false; return; }
  try { await api("POST", "/api/push/unsubscribe", { endpoint: sub.endpoint }); } catch (e) {}
  await sub.unsubscribe(); S.pushOn = false;
}
async function checkPush() {
  const sub = await currentSub();
  S.pushOn = !!sub && pushSupported() && Notification.permission === "granted";
  return S.pushOn;
}
async function drawPush() {
  const box = $("pushbox"); if (!box) return;
  if (!pushSupported()) {
    box.innerHTML = isIOS && !isStandalone()
      ? 'Auf dem iPhone kommen Push-Nachrichten nur, wenn die App auf dem Home-Bildschirm liegt: unten auf <b>Teilen</b> → <b>Zum Home-Bildschirm</b>, dann die App von dort öffnen und hier einschalten.'
      : "Dieser Browser kann keine Push-Nachrichten empfangen. Nutzt dann das Kalender-Abo unten.";
    return;
  }
  await checkPush();
  box.innerHTML = S.pushOn
    ? "✓ An – dieses Handy bekommt die Erinnerungen." + '<div class="acts" style="margin-top:8px"><button class="btn ghost" id="p_test">Testen</button><button class="btn danger" id="p_off">Ausschalten</button></div>'
    : 'Aus.<button class="btn block" style="margin-top:8px" id="p_on">Push-Nachrichten einschalten</button>';
  const busy = (b, t) => { b.disabled = true; b.textContent = t; };
  if ($("p_on")) $("p_on").onclick = e => { busy(e.target, "Wird eingeschaltet …"); enablePush().then(() => { toast("Eingeschaltet – eine Test-Nachricht ist unterwegs"); drawPush(); }).catch(err => { toast(err.message || "Hat nicht geklappt"); drawPush(); }); };
  if ($("p_test")) $("p_test").onclick = e => { busy(e.target, "Gesendet …"); currentSub().then(s => api("POST", "/api/push/test", { endpoint: s.endpoint })).then(() => toast("Test-Nachricht ist unterwegs")).catch(err => toast(err.message)).finally(drawPush); };
  if ($("p_off")) $("p_off").onclick = e => { busy(e.target, "…"); disablePush().then(() => { toast("Push-Nachrichten aus"); drawPush(); }); };
}

// Wer sich normalerweise ums Geschenk kümmert: beim Ehepartner der andere, sonst die Voreinstellung der Person
const defaultWho = p => p ? (p.self ? (S.people.find(n => n !== p.self) || "") : (p.responsible || "")) : "";

// Personenseite öffnen; „Zurück“ führt zur Ansicht, von der man kam
function goPerson(pid, created) {
  if (S.view !== "person") { S.back = S.view; S.scroll[S.view] = window.scrollY; }
  S.view = "person"; S.pid = pid; window.scrollTo(0, 0); render();
  if (created) { const p = person(pid); toast("„" + (p ? p.name : "") + "“ angelegt"); }
}
// Links aus Erinnerungen: /#p=<id> öffnet die Person, /#geschenke die Geschenke-Übersicht
function handleHash() {
  const h = location.hash;
  if (!h) return;
  const m = h.match(/^#p=([A-Za-z0-9_-]+)$/);
  history.replaceState(null, "", location.pathname);
  if (m && person(m[1])) { $("modal").innerHTML = ""; S.view = "upcoming"; goPerson(m[1]); }
  else if (h === "#geschenke") { $("modal").innerHTML = ""; S.view = "gifts"; render(); }
}

/* ---------- Klicks in der Hauptansicht ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.closest("#modal")) return;
  const a = b.dataset.act;
  if (a === "view") { S.view = b.dataset.v; window.scrollTo(0, 0); render(); }
  else if (a.startsWith("cal-")) {
    const c = calState();
    if (a === "cal-mode") { c.mode = b.dataset.m; c.day = null; }
    else if (a === "cal-prev" || a === "cal-next") {
      const dir = a === "cal-prev" ? -1 : 1; c.day = null;
      if (c.mode === "year") c.y += dir; else { c.m += dir; if (c.m < 1) { c.m = 12; c.y--; } if (c.m > 12) { c.m = 1; c.y++; } }
    }
    else if (a === "cal-today") { const t = O.parseIso(today()); c.y = t.y; c.m = t.m; c.day = null; }
    else if (a === "cal-month") { c.mode = "month"; c.m = Number(b.dataset.m); c.day = null; window.scrollTo(0, 0); }
    else if (a === "cal-day") { const d = Number(b.dataset.d); c.day = !d || c.day === d ? null : d; }
    renderBody();
  }
  else if (a === "gmode") { S.gmode = b.dataset.m; renderBody(); }
  else if (a === "spend-prev" || a === "spend-next") { S.spendYear = (S.spendYear || thisYear()) + (a === "spend-prev" ? -1 : 1); renderBody(); }
  else if (a === "spend-year") { S.spendYear = Number(b.dataset.y); renderBody(); }
  else if (a === "filter") { S.filter = b.dataset.f; saveLocal(); renderBody(); renderHead(); }
  else if (a === "me") { setMe(b.dataset.p); render(); }
  else if (a === "menu") openMenu();
  else if (a === "hint-off") { S.pushHintOff = true; saveLocal(); renderBody(); }
  else if (a === "new-person") openPersonForm(null);
  else if (a === "edit-person") openPersonForm(S.pid);
  else if (a === "person") goPerson(b.dataset.pid);
  else if (a === "back") { S.view = S.back || "upcoming"; render(); window.scrollTo(0, S.scroll[S.view] || 0); }
  else if (a === "occ") openOccasion(b.dataset.pid, b.dataset.key, Number(b.dataset.year));
  else if (a === "idea") openIdea(b.dataset.id);
  else if (a === "gift") openGiftForm(b.dataset.id, null, null);
  else if (a === "past-gift") openGiftForm(null, { person_id: S.pid, occasion: "geburtstag", year: thisYear() - 1, status: "ueberreicht" }, null);
});

/* ---------- Start ---------- */
loadLocal();
render();
refresh(true).then(handleHash);
if (pushSupported()) { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {}); checkPush().then(() => { if (S.view !== "person") renderBody(); }); }
window.addEventListener("hashchange", handleHash);
setInterval(() => { if (document.visibilityState === "visible" && !$("modal").innerHTML) refresh(); }, POLL_MS);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
