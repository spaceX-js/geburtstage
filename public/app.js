// Geschenke – Oberfläche
// Zeigt die nächsten Anlässe, die Personen mit Ideen und Geschenk-Historie und speichert alles über /api/… in der Datenbank.
import * as O from "/occasions.js";

const VERSION = "0.1.0";
const CACHE_KEY = "geschenke.v1";
const POLL_MS = 5000;
const STATUS = [
  { key: "idee", label: "Idee" }, { key: "gekauft", label: "Gekauft" }, { key: "verpackt", label: "Verpackt" }, { key: "ueberreicht", label: "Überreicht" }
];
const STATUS_LABEL = { idee: "Idee", gekauft: "Gekauft", verpackt: "Verpackt", ueberreicht: "Überreicht", nichts: "Diesmal nichts" };
const RATINGS = [[1, "😐 Naja"], [2, "🙂 Gut"], [3, "🤩 Volltreffer"]];
const RELATIONS = ["Familie", "Freunde", "Partner/in", "Kollegen", "Nachbarn"];

const S = { loaded: false, online: true, rev: null, persons: [], ideas: [], gifts: [], people: ["Jonas", "Clara"], me: "",
  view: "upcoming", pid: null, filter: "alle", q: "", pending: 0, scroll: {} };

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
function budgetText(p) {
  if (!p) return "";
  const a = p.budget_min, b = p.budget_max;
  if (a != null && b != null) return a === b ? a + " €" : a + "–" + b + " €";
  if (b != null) return "bis " + b + " €";
  if (a != null) return "ab " + a + " €";
  return "";
}
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
    if (o) { S.persons = o.persons || []; S.ideas = o.ideas || []; S.gifts = o.gifts || []; S.me = o.me || ""; S.filter = o.filter || "alle";
      if (Array.isArray(o.people) && o.people.length) S.people = o.people; if (S.persons.length) S.loaded = true; }
  } catch (e) {}
}
function saveLocal() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ persons: S.persons, ideas: S.ideas, gifts: S.gifts, people: S.people, me: S.me, filter: S.filter })); } catch (e) {}
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
function upcomingList(days = 366) {
  let list = O.upcoming(S.persons, today(), days);
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
  $("head").innerHTML = '<div class="title"><h1>Geschenke' + net + '</h1><button class="iconbtn" data-act="menu" aria-label="Einstellungen">' + ICON_GEAR + "</button></div>" +
    '<div class="seg"><button data-act="view" data-v="upcoming" class="' + (S.view === "upcoming" ? "on" : "") + '">Demnächst</button>' +
    '<button data-act="view" data-v="persons" class="' + (S.view === "persons" ? "on" : "") + '">Personen' + (S.persons.length ? " (" + S.persons.length + ")" : "") + "</button></div>" +
    (S.view === "persons" ? '<input class="searchbox" id="q" type="search" placeholder="Suchen …" value="' + esc(S.q) + '" autocomplete="off">' : "");
  const q = $("q"); if (q) q.oninput = () => { S.q = q.value; renderBody(); };
}

/* ---------- Ansichten ---------- */
function render() { renderHead(); renderBody(); }
function renderBody() {
  if (!S.loaded) return;
  $("fab").innerHTML = S.view === "persons" || (S.view === "upcoming" && S.persons.length) ? '<button class="fab" data-act="new-person">+ Person</button>' : "";
  if (S.view === "person") return renderPerson();
  if (S.view === "persons") return renderPersons();
  renderUpcoming();
}

function whoBox() {
  if (S.me) return "";
  return '<div class="whobox"><b>Wem gehört dieses Handy?</b><div class="small">Damit „Meine“ Anlässe und „von …“ stimmen.</div><div class="chips">' +
    S.people.map(p => '<button data-act="me" data-p="' + esc(p) + '">' + esc(p) + "</button>").join("") + "</div></div>";
}

function renderUpcoming() {
  if (!S.persons.length) {
    $("app").innerHTML = whoBox() + '<div class="empty" style="padding-top:50px">🎁<br><b>Noch keine Personen</b><br>Legt Freunde und Familie mit Geburtstag an –<br>die App zeigt dann, was als Nächstes ansteht.<br>' +
      '<button class="btn" data-act="new-person">Erste Person anlegen</button></div>';
    return;
  }
  const list = upcomingList();
  const open30 = list.filter(o => o.inDays <= 30 && stateOf(o.personId, o.key, o.year).key === "none").length;
  let h = whoBox();
  if (S.me) h += '<div class="seg" style="margin-top:12px"><button data-act="filter" data-f="alle" class="' + (S.filter !== "meine" ? "on" : "") + '">Alle</button>' +
    '<button data-act="filter" data-f="meine" class="' + (S.filter === "meine" ? "on" : "") + '">Meine (' + esc(S.me) + ")</button></div>";
  if (open30) h += '<div class="alert">' + (open30 === 1 ? "1 Anlass" : open30 + " Anlässe") + " in den nächsten 30 Tagen ohne Geschenk.</div>";
  if (!list.length) h += '<div class="empty">In den nächsten 12 Monaten steht nichts an.' + (S.filter === "meine" ? "<br>(Filter „Meine“ ist an.)" : "") + "</div>";
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
  const sub = (showName ? esc(O.occTitle(o)) + " · " : "") + O.fmtIn(o.inDays);
  return '<button class="row" data-act="occ" data-pid="' + esc(o.personId) + '" data-key="' + esc(o.key) + '" data-year="' + o.year + '">' +
    '<div class="date' + (o.inDays <= 7 ? " soon" : "") + '"><b>' + d + "</b><small>" + O.WEEKDAYS[O.weekday(o.date)] + "</small></div>" +
    '<div class="main"><div class="n">' + name + '</div><div class="d">' + sub + " " + pill(st) + "</div></div>" +
    '<span class="chev">›</span></button>';
}

function personSub(p) {
  const parts = [];
  if (p.relation) parts.push(esc(p.relation));
  if (p.bday_day) {
    const age = O.ageOn(p, today());
    parts.push("🎂 " + O.fmtDayMonth(p.bday_day, p.bday_month) + (age !== null ? " (" + age + ")" : ""));
  } else parts.push("kein Geburtstag eingetragen");
  return parts.join(" · ");
}
function renderPersons() {
  const q = S.q.trim().toLowerCase();
  const list = S.persons.filter(p => !q || p.name.toLowerCase().includes(q) || (p.relation || "").toLowerCase().includes(q) || (p.interests || []).some(i => i.toLowerCase().includes(q)));
  if (!S.persons.length) { $("app").innerHTML = '<div class="empty" style="padding-top:40px">Noch keine Personen.<br><button class="btn" data-act="new-person">Erste Person anlegen</button></div>'; return; }
  if (!list.length) { $("app").innerHTML = '<div class="empty">Niemand gefunden.</div>'; return; }
  $("app").innerHTML = '<div class="list" style="margin-top:14px">' + list.map(p =>
    '<button class="row" data-act="person" data-pid="' + esc(p.id) + '"><div class="avatar">' + esc(initials(p.name)) + '</div><div class="main"><div class="n">' + esc(p.name) +
    '</div><div class="d">' + personSub(p) + '</div></div><span class="chev">›</span></button>').join("") + "</div>";
}

function renderPerson() {
  const p = person(S.pid);
  if (!p) { S.view = "persons"; return render(); }
  const t = today();
  const occ = O.upcoming([p], t, 366);
  const ideas = S.ideas.filter(i => i.person_id === p.id);
  const gifts = S.gifts.filter(g => g.person_id === p.id).sort((a, b) => b.year - a.year || (b.created_at || "").localeCompare(a.created_at || ""));
  let h = "";
  // Steckbrief
  const age = O.ageOn(p, t);
  const rows = [];
  rows.push(["Geburtstag", p.bday_day ? O.fmtDayMonth(p.bday_day, p.bday_month) + (p.bday_year ? " " + p.bday_year : "") + (age !== null ? " · " + age + " Jahre" : "") : "–"]);
  if (p.relation) rows.push(["Beziehung", esc(p.relation)]);
  rows.push(["Budget", budgetText(p) || "–"]);
  rows.push(["Kümmert sich", whoText(p.responsible)]);
  const extras = (p.holidays || []).map(k => occLabel(p, k)).concat((p.extra || []).map(x => x.label + " (" + x.d + "." + x.m + ".)"));
  rows.push(["Weitere Anlässe", extras.length ? esc(extras.join(", ")) : "–"]);
  h += '<div class="card" style="margin-top:12px">' + rows.map(([k, v]) => '<div class="kv"><span>' + k + "</span><b>" + v + "</b></div>").join("") + "</div>";

  // Nächste Anlässe
  h += '<div class="sec"><b>Nächste Anlässe</b></div>';
  h += occ.length ? '<div class="list">' + occ.slice(0, 6).map(o => occRow(o, false)).join("") + "</div>"
    : '<div class="card small">Kein Anlass eingetragen. Tippe oben auf den Stift, um einen Geburtstag oder Feiertage hinzuzufügen.</div>';

  // Ideen-Notizbuch
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

  // Geschenke
  h += '<div class="sec"><b>Geschenke</b><button class="linkbtn" data-act="past-gift">+ Früheres eintragen</button></div>';
  if (!gifts.length) h += '<div class="card small">Noch keine Geschenke eingetragen. Trage auch frühere ein – so wiederholt sich nichts.</div>';
  let yr = null;
  for (const g of gifts) {
    if (g.year !== yr) { if (yr !== null) h += "</div>"; yr = g.year; h += '<div class="yr">' + yr + '</div><div class="list">'; }
    const d = [esc(occLabel(p, g.occasion))]; if (g.price != null) d.push(euro(g.price));
    h += '<button class="row" data-act="gift" data-id="' + esc(g.id) + '"><div class="main"><div class="n">' + esc(g.title) + '</div><div class="d">' + d.join(" · ") + " " +
      pill({ key: g.status, label: STATUS_LABEL[g.status] }) + " " + stars(g.rating) + '</div></div><span class="chev">›</span></button>';
  }
  if (yr !== null) h += "</div>";

  // Was wir wissen
  h += '<div class="sec"><b>Was wir wissen</b><button class="linkbtn" data-act="edit-person">Bearbeiten</button></div><div class="card">';
  const know = [];
  if ((p.interests || []).length) know.push('<div class="lab">Interessen</div><div class="tags">' + p.interests.map(i => '<span class="tag">' + esc(i) + "</span>").join("") + "</div>");
  if (p.dislikes) know.push('<div class="lab">Mag nicht / hat schon</div><div class="txt">' + esc(p.dislikes) + "</div>");
  if (p.notes) know.push('<div class="lab">Notizen</div><div class="txt">' + esc(p.notes) + "</div>");
  h += know.length ? know.join("") : '<div class="small">Interessen, Größen, Wünsche – je mehr hier steht, desto besser werden später die Geschenkvorschläge.</div>';
  h += "</div>";
  $("app").innerHTML = h;

  $("ideaform").onsubmit = e => {
    e.preventDefault();
    const v = $("ideatext").value.trim(); if (!v) return;
    saveIdea({ id: uid("i"), person_id: p.id, text: v.slice(0, 300), link: "", price: null, added_by: S.me, created_at: nowIso() });
    renderPerson(); $("ideatext").focus(); toast("Idee notiert");
  };
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
    interests: [], dislikes: "", notes: "", budget_min: null, budget_max: null, responsible: "" };
  let extra = (p.extra || []).map(x => ({ ...x }));
  const dayOpts = sel => '<option value="">Tag</option>' + Array.from({ length: 31 }, (_, i) => '<option' + (sel === i + 1 ? " selected" : "") + ">" + (i + 1) + "</option>").join("");
  const monOpts = sel => '<option value="">Monat</option>' + O.MONTHS.map((m, i) => '<option value="' + (i + 1) + '"' + (sel === i + 1 ? " selected" : "") + ">" + m + "</option>").join("");
  const m = sheet(
    "<h3>" + (old ? "Person bearbeiten" : "Neue Person") + '</h3><div class="sub">Nur der Name ist Pflicht.</div>' +
    '<label class="f"><span>Name</span><input id="f_name" maxlength="80" value="' + esc(p.name) + '" autocomplete="off"></label>' +
    '<label class="f"><span>Beziehung</span><input id="f_rel" list="rels" maxlength="40" value="' + esc(p.relation) + '" placeholder="z. B. Familie, Freunde"><datalist id="rels">' +
    RELATIONS.map(r => '<option value="' + r + '">').join("") + "</datalist></label>" +
    '<div class="flab">Geburtstag (Jahr freiwillig – dann zeigt die App das Alter)</div><div class="three" style="margin-bottom:12px">' +
    '<select id="f_d">' + dayOpts(p.bday_day) + '</select><select id="f_m">' + monOpts(p.bday_month) + "</select>" +
    '<input id="f_y" inputmode="numeric" maxlength="4" placeholder="Jahr" value="' + esc(p.bday_year || "") + '"></div>' +
    '<div class="flab">Budget in Euro</div><div class="two" style="margin-bottom:12px"><input id="f_bmin" inputmode="numeric" placeholder="von" value="' + esc(p.budget_min ?? "") + '">' +
    '<input id="f_bmax" inputmode="numeric" placeholder="bis" value="' + esc(p.budget_max ?? "") + '"></div>' +
    '<div class="flab">Wer kümmert sich normalerweise?</div>' + chipRow("f_resp", peopleOpts(), p.responsible || "") +
    '<div class="flab" style="margin-top:14px">Auch an diesen Tagen schenken</div><div class="chips" id="f_hol">' +
    O.HOLIDAYS.map(h => '<button type="button" data-k="' + h.key + '" class="' + ((p.holidays || []).includes(h.key) ? "on" : "") + '">' + h.label + "</button>").join("") + "</div>" +
    '<div class="flab" style="margin-top:14px">Eigene Termine (Hochzeitstag, Namenstag …)</div><div id="f_extra"></div>' +
    '<button type="button" class="linkbtn" id="f_addx">+ Termin hinzufügen</button>' +
    '<div class="hr"></div>' +
    '<label class="f"><span>Interessen (mit Komma trennen)</span><input id="f_int" value="' + esc((p.interests || []).join(", ")) + '" placeholder="z. B. Kochen, Wandern, Krimis"></label>' +
    '<label class="f"><span>Mag nicht / hat schon</span><textarea id="f_dis" maxlength="1000">' + esc(p.dislikes) + "</textarea></label>" +
    '<label class="f"><span>Notizen (Größen, Wünsche, Lieblingsfarbe …)</span><textarea id="f_notes" maxlength="3000">' + esc(p.notes) + "</textarea></label>" +
    '<div class="acts"><button class="btn ghost" id="f_cancel">Abbrechen</button><button class="btn" id="f_save">Speichern</button></div>' +
    (old ? '<button class="btn danger block" id="f_del" style="margin-top:14px">Person löschen</button>' : "")
  );
  singleChips("f_resp");
  $("f_hol").onclick = e => { const b = e.target.closest("button"); if (b) b.classList.toggle("on"); };
  function syncExtra() {
    extra = extra.map((x, i) => ({ id: x.id, label: ($("x_l" + i) || {}).value || "", d: Number(($("x_d" + i) || {}).value) || null, m: Number(($("x_m" + i) || {}).value) || null,
      y: numOrNull(($("x_y" + i) || {}).value) }));
  }
  function drawExtra() {
    $("f_extra").innerHTML = extra.map((x, i) => '<div class="xrow"><input id="x_l' + i + '" placeholder="Name" maxlength="40" value="' + esc(x.label) + '">' +
      '<select id="x_d' + i + '">' + dayOpts(x.d) + '</select><select id="x_m' + i + '">' + monOpts(x.m) + "</select>" +
      '<input id="x_y' + i + '" inputmode="numeric" maxlength="4" placeholder="Jahr" value="' + esc(x.y || "") + '"><button type="button" data-rm="' + i + '" aria-label="Entfernen">✕</button></div>').join("");
  }
  drawExtra();
  $("f_extra").onclick = e => { const b = e.target.closest("[data-rm]"); if (!b) return; syncExtra(); extra.splice(Number(b.dataset.rm), 1); drawExtra(); };
  $("f_addx").onclick = () => { syncExtra(); extra.push({ id: uid("x"), label: extra.length ? "" : "Hochzeitstag", d: null, m: null, y: null }); drawExtra(); };
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
    const bmin = numOrNull($("f_bmin").value), bmax = numOrNull($("f_bmax").value);
    if (Number.isNaN(bmin) || Number.isNaN(bmax)) { toast("Beim Budget bitte nur Zahlen eingeben."); return; }
    if (bmin != null && bmax != null && bmin > bmax) { toast("Beim Budget ist „von“ größer als „bis“."); return; }
    const ex = [];
    for (const x of extra) {
      if (!x.label.trim() && !x.d && !x.m) continue;
      if (!x.d || !x.m) { toast("Bei „" + (x.label || "Termin") + "“ fehlen Tag oder Monat."); return; }
      if (Number.isNaN(x.y) || (x.y !== null && (x.y < 1900 || x.y > thisYear() + 1))) { toast("Bei „" + (x.label || "Termin") + "“ stimmt das Jahr nicht."); return; }
      if (x.d > O.daysInMonth(x.y || 2000, x.m)) { toast("Bei „" + (x.label || "Termin") + "“ gibt es diesen Tag nicht."); return; }
      ex.push(x.y ? { id: x.id, label: x.label.trim() || "Termin", d: x.d, m: x.m, y: x.y } : { id: x.id, label: x.label.trim() || "Termin", d: x.d, m: x.m });
    }
    const out = { ...p, name: name.slice(0, 80), relation: $("f_rel").value.trim().slice(0, 40), bday_day: d, bday_month: mo, bday_year: y,
      holidays: [...$("f_hol").querySelectorAll("button.on")].map(b => b.dataset.k), extra: ex,
      interests: $("f_int").value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean).slice(0, 30),
      dislikes: $("f_dis").value.trim(), notes: $("f_notes").value.trim(), budget_min: bmin, budget_max: bmax, responsible: chipValue("f_resp") };
    savePerson(out);
    $("modal").innerHTML = "";
    if (!old) return goPerson(out.id, "angelegt");
    render(); toast("Gespeichert");
  };
}

// Ein Anlass: Geschenke dafür, Ideen übernehmen, früher Geschenktes
function openOccasion(pid, key, year) {
  const p = person(pid); if (!p) return;
  const o = O.occasionsInYear(p, year).find(x => x.key === key) || { key, label: occLabel(p, key), date: null, year, age: null };
  const gs = giftsFor(pid, key, year);
  const ideas = S.ideas.filter(i => i.person_id === pid);
  const past = S.gifts.filter(g => g.person_id === pid && !(g.occasion === key && g.year === year) && g.status !== "nichts")
    .sort((a, b) => b.year - a.year).slice(0, 6);
  const sub = [];
  if (o.date) sub.push(O.fmtDate(o.date, { weekday: true, long: true, year: true }) + " · " + O.fmtIn(O.daysBetween(today(), o.date)));
  if (budgetText(p)) sub.push("Budget " + budgetText(p));
  let h = "<h3>" + esc(p.name) + " – " + esc(O.occTitle(o)) + (o.round ? ' <span class="pill round">rund</span>' : "") + '</h3><div class="sub">' + esc(sub.join(" · ")) + "</div>";
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
    else if (b.dataset.idea) {
      const i = S.ideas.find(x => x.id === b.dataset.idea); if (!i) return;
      saveGift({ id: uid("g"), person_id: pid, occasion: key, year, title: i.text.slice(0, 160), price: i.price, status: "idee", rating: 0,
        note: i.link || "", who: p.responsible || "", created_at: nowIso() });
      deleteIdea(i.id, true); again(); toast("Idee übernommen");
    }
  };
  $("o_add").onclick = () => openGiftForm(null, { person_id: pid, occasion: key, year }, again);
  if ($("o_none")) $("o_none").onclick = () => { saveGift({ id: uid("g"), person_id: pid, occasion: key, year, title: "Diesmal nichts", price: null, status: "nichts", rating: 0, note: "", who: "", created_at: nowIso() }); again(); };
  $("o_close").onclick = closeModal;
  $("o_person").onclick = () => { $("modal").innerHTML = ""; goPerson(pid); };
}

// Geschenk eintragen / bearbeiten. after = was danach angezeigt wird (z. B. zurück zum Anlass)
function openGiftForm(id, defaults, after) {
  const old = id ? S.gifts.find(g => g.id === id) : null;
  const g = old ? { ...old } : { id: uid("g"), person_id: defaults.person_id, occasion: defaults.occasion || "geburtstag", year: defaults.year || thisYear(), title: "", price: null,
    status: defaults.status || "idee", rating: 0, note: "", who: (person(defaults.person_id) || {}).responsible || "", created_at: nowIso() };
  const p = person(g.person_id); if (!p) return;
  const occs = [];
  if (p.bday_day) occs.push(["geburtstag", "Geburtstag"]);
  for (const x of p.extra || []) occs.push(["x:" + x.id, x.label]);
  for (const h of O.HOLIDAYS) occs.push([h.key, h.label]);
  if (!occs.some(([k]) => k === g.occasion)) occs.unshift([g.occasion, occLabel(p, g.occasion)]);
  const done = () => { $("modal").innerHTML = ""; if (after) after(); else render(); };
  const m = sheet(
    "<h3>" + (old ? "Geschenk bearbeiten" : "Geschenk eintragen") + '</h3><div class="sub">für ' + esc(p.name) + (budgetText(p) ? " · Budget " + budgetText(p) : "") + "</div>" +
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
  const occ = p ? O.upcoming([p], today(), 366) : [];
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
      note: v.link || "", who: (p && p.responsible) || "", created_at: nowIso() });
    deleteIdea(i.id, true);
    openOccasion(i.person_id, key, Number(year)); toast("Eingeplant");
  };
}

// Einstellungen
function openMenu() {
  const m = sheet(
    "<h3>Einstellungen</h3>" + '<div class="sub">Geschenke v' + VERSION + "</div>" +
    '<div class="flab">Dieses Handy gehört</div>' + chipRow("m_me", S.people.map(p => [p, p]), S.me) +
    '<div class="hr"></div><div class="flab">Erinnerungen</div><div class="small">Push-Nachrichten, E-Mail und Kalender-Abo kommen mit der nächsten Version.</div>' +
    '<div class="hr"></div><div class="flab">Passwort ändern</div>' +
    '<input id="m_old" type="password" autocomplete="current-password" placeholder="Aktuelles Passwort" style="margin-bottom:8px">' +
    '<input id="m_new" type="password" autocomplete="new-password" placeholder="Neues Passwort (mind. 8 Zeichen)" style="margin-bottom:8px">' +
    '<button class="btn ghost block" id="m_pw">Passwort ändern</button>' +
    '<div class="hr"></div><a class="btn danger block" href="/logout" style="text-align:center;text-decoration:none">Abmelden</a>' +
    '<button class="btn ghost block" id="m_close">Schließen</button>'
  );
  singleChips("m_me", k => { S.me = k; saveLocal(); toast("Dieses Handy gehört " + k); });
  $("m_close").onclick = closeModal;
  $("m_pw").onclick = async e => {
    const b = e.target; b.disabled = true;
    try { await api("POST", "/api/password", { old: $("m_old").value, new: $("m_new").value }); toast("Passwort geändert"); $("m_old").value = ""; $("m_new").value = ""; }
    catch (err) { toast(err.message); } finally { b.disabled = false; }
  };
}

// Personenseite öffnen; „Zurück“ führt zur Ansicht, von der man kam
function goPerson(pid, created) {
  if (S.view !== "person") { S.back = S.view; S.scroll[S.view] = window.scrollY; }
  S.view = "person"; S.pid = pid; window.scrollTo(0, 0); render();
  if (created) { const p = person(pid); toast("„" + (p ? p.name : "") + "“ angelegt"); }
}

/* ---------- Klicks in der Hauptansicht ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.closest("#modal")) return;
  const a = b.dataset.act;
  if (a === "view") { S.view = b.dataset.v; window.scrollTo(0, 0); render(); }
  else if (a === "filter") { S.filter = b.dataset.f; saveLocal(); renderBody(); renderHead(); }
  else if (a === "me") { S.me = b.dataset.p; saveLocal(); render(); }
  else if (a === "menu") openMenu();
  else if (a === "new-person") openPersonForm(null);
  else if (a === "edit-person") openPersonForm(S.pid);
  else if (a === "person") goPerson(b.dataset.pid);
  else if (a === "back") { S.view = S.back || "persons"; render(); window.scrollTo(0, S.scroll[S.view] || 0); }
  else if (a === "occ") openOccasion(b.dataset.pid, b.dataset.key, Number(b.dataset.year));
  else if (a === "idea") openIdea(b.dataset.id);
  else if (a === "gift") openGiftForm(b.dataset.id, null, null);
  else if (a === "past-gift") openGiftForm(null, { person_id: S.pid, occasion: "geburtstag", year: thisYear() - 1, status: "ueberreicht" }, null);
});

/* ---------- Start ---------- */
loadLocal();
render();
refresh(true);
setInterval(() => { if (document.visibilityState === "visible" && !$("modal").innerHTML) refresh(); }, POLL_MS);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
