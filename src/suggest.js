// Geschenkvorschläge mit Cloudflare Workers AI (kostenloses Kontingent: 10.000 „Neuronen“ pro Tag).
// Ein Vorschlag kostet mit Gemma 4 nur etwa 30–40 Neuronen; zur Sicherheit begrenzen wir auf DAILY_LIMIT Anfragen pro Tag.
import * as O from "../public/occasions.js";

export const MODELS = ["@cf/google/gemma-4-26b-a4b-it", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
export const DAILY_LIMIT = 60;

const SCHEMA = {
  type: "object",
  properties: {
    vorschlaege: {
      type: "array",
      items: {
        type: "object",
        properties: { titel: { type: "string" }, warum: { type: "string" }, preis: { type: "number" } },
        required: ["titel", "warum", "preis"]
      }
    }
  },
  required: ["vorschlaege"]
};

function budgetLine(b) {
  if (!b) return "kein festes Budget (bitte vernünftig, eher 20–60 €)";
  if (b.min != null && b.max != null) return b.min + " bis " + b.max + " Euro";
  if (b.max != null) return "höchstens " + b.max + " Euro";
  return "mindestens " + b.min + " Euro";
}
const RATING = { 1: "kam nur mäßig an", 2: "kam gut an", 3: "war ein Volltreffer" };

// Text für das Sprachmodell zusammenstellen
export function buildPrompt({ person, occasionLabel, age, budget, gifts, ideas, wish }) {
  const lines = [];
  lines.push("Anlass: " + occasionLabel + (age ? " (" + age + ". " + (occasionLabel === "Geburtstag" ? "Geburtstag" : "Jahrestag") + ")" : ""));
  lines.push("Für: " + person.name.split(" ")[0] + (person.relation ? " (" + person.relation + ")" : ""));
  if (person.age != null) lines.push("Alter: " + person.age + " Jahre");
  lines.push("Budget: " + budgetLine(budget));
  if ((person.interests || []).length) lines.push("Interessen: " + person.interests.join(", "));
  if (person.dislikes) lines.push("Mag nicht / hat schon: " + person.dislikes);
  if (person.notes) lines.push("Notizen: " + person.notes);
  if (ideas.length) lines.push("Schon notierte Ideen (nicht wiederholen, aber gern als Hinweis nutzen): " + ideas.map(i => i.text).join("; "));
  const past = gifts.filter(g => g.status !== "nichts").slice(0, 15);
  if (past.length) lines.push("Frühere Geschenke (nicht wiederholen): " + past.map(g => g.title + " (" + g.year + (g.rating ? ", " + RATING[g.rating] : "") + ")").join("; "));
  if (wish) lines.push("Besonderer Wunsch: " + wish);
  return lines.join("\n");
}

const SYSTEM = "Du bist ein einfühlsamer, kreativer Geschenkberater für ein Paar in Deutschland. " +
  "Schlage 5 konkrete, unterschiedliche Geschenke vor, die man in Deutschland gut bekommt (gern auch Erlebnisse oder Selbstgemachtes). " +
  "Halte das Budget ein und schätze den Preis realistisch in Euro. Wiederhole keine früheren Geschenke. " +
  "Begründe jeden Vorschlag in einem kurzen Satz, der sich auf die Angaben bezieht. Schreibe auf Deutsch. " +
  'Antworte nur mit JSON in genau dieser Form: {"vorschlaege":[{"titel":"…","warum":"…","preis":30}]}';

// Antwort des Modells in eine saubere Liste verwandeln (verträgt auch Text mit JSON darin)
export function parseSuggestions(res) {
  let v = res;
  if (v && typeof v === "object" && Array.isArray(v.choices)) v = v.choices[0] && v.choices[0].message ? v.choices[0].message.content : "";
  else if (v && typeof v === "object" && "response" in v) v = v.response;
  if (typeof v === "string") {
    const s = v.replace(/```(?:json)?/gi, "");
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    const a2 = s.indexOf("["), b2 = s.lastIndexOf("]");
    const useArr = a2 >= 0 && b2 > a2 && (a < 0 || a2 < a);
    try { v = JSON.parse(useArr ? s.slice(a2, b2 + 1) : s.slice(a, b + 1)); } catch (e) { return []; }
  }
  const list = Array.isArray(v) ? v : v && (v.vorschlaege || v.suggestions || v.ideen);
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const title = String(x.titel || x.title || x.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!title) continue;
    const why = String(x.warum || x.why || x.begruendung || x.reason || "").replace(/\s+/g, " ").trim().slice(0, 240);
    const p = Math.round(Number(String(x.preis ?? x.price ?? "").toString().replace(/[^\d.,]/g, "").replace(",", ".")));
    out.push({ title, why, price: Number.isFinite(p) && p > 0 && p < 100000 ? p : null });
    if (out.length >= 6) break;
  }
  return out;
}

// Modelle der Reihe nach probieren, bis eins brauchbare Vorschläge liefert
export async function askModel(ai, prompt) {
  let lastErr = null;
  for (const model of MODELS) {
    try {
      const input = { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], max_tokens: 1200, temperature: 0.8,
        response_format: { type: "json_schema", json_schema: SCHEMA } };
      if (model.includes("gemma-4")) input.chat_template_kwargs = { enable_thinking: false };
      const res = await ai.run(model, input);
      const list = parseSuggestions(res);
      if (list.length) return { model, suggestions: list };
      lastErr = new Error("Leere Antwort von " + model);
    } catch (e) { lastErr = e; console.log("KI-Fehler (" + model + "): " + (e && e.message)); }
  }
  throw lastErr || new Error("Keine Vorschläge erhalten");
}

// Alles für einen Vorschlag aus der Datenbank zusammensuchen
export function promptFor(state, personId, occasion, year, wish) {
  const p = state.persons.find(x => x.id === personId);
  if (!p) return null;
  const occ = O.occasionsInYear(p, year).find(o => o.key === occasion);
  const label = occ ? occ.label : (O.HOLIDAYS.find(h => h.key === occasion) || {}).label || "Geschenk";
  const age = occ && occ.age ? occ.age : null;
  const today = O.todayIn("Europe/Berlin");
  return buildPrompt({
    person: { ...p, age: O.ageOn(p, today) },
    occasionLabel: label, age, budget: (p.budgets || {})[occasion],
    gifts: state.gifts.filter(g => g.person_id === p.id), ideas: state.ideas.filter(i => i.person_id === p.id),
    wish: String(wish || "").replace(/\s+/g, " ").trim().slice(0, 200)
  });
}
