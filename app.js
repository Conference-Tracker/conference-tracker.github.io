// Conference Tracker app. Conference data comes from the database; personal data is saved per account through API (api.js).
const ABDC_PTS = { "A*": 4, "A": 3, "B": 2, "C": 1 };
const TYPE_LABEL = { route: "publication route", assoc: "association journal", pdw: "editor workshop", proc: "proceedings" };

const TIERS = ["A*","A","B","C","General"];
const TIER_CLASS = { "A*":"ts", "A":"ta", "B":"tb", "C":"tc", "General":"tg", "TBC":"tg" };
const TIER_RANK = { "A*":0, "A":1, "B":2, "C":3, "General":4, "TBC":5 };

function journalPoints(j) {
  if (!j.a) return 1;
  let p = ABDC_PTS[j.a];
  if (j.t === "pdw") p -= 1;
  if (j.t === "proc") p = 1;
  return Math.max(1, p);
}
function score(c) {
  const J = c.j.length ? Math.max(...c.j.map(journalPoints)) : 1;
  const s = 0.6 * J + 0.4 * c.hostScore;
  return { J, s: Math.round(s * 100) / 100 };
}
function tierFromScore(s) {
  if (s >= 4.0) return "A*";
  if (s >= 3.2) return "A";
  if (s >= 2.2) return "B";
  if (s >= 1.4) return "C";
  return "General";
}

const TODAY = new Date(); TODAY.setHours(0,0,0,0);
function d(iso) { if (!iso) return null; const [y,m,dd] = iso.split("-").map(Number); return new Date(y, m-1, dd); }
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmt(iso) { const x = d(iso); return x ? `${x.getDate()} ${MON[x.getMonth()]} ${x.getFullYear()}` : ""; }
function fmtRange(a, b) {
  if (!a) return "";
  const x = d(a), y = d(b || a);
  if (a === b || !b) return fmt(a);
  if (x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth()) return `${x.getDate()}–${y.getDate()} ${MON[y.getMonth()]} ${y.getFullYear()}`;
  return `${fmt(a)} – ${fmt(b)}`;
}
function daysUntil(iso) { return Math.round((d(iso) - TODAY) / 86400000); }

function status(c) {
  if (c.placeholder) return { key:"tbc", label:"To be confirmed", cls:"st-tba" };
  if (c.deadline && daysUntil(c.deadline) >= 0) return { key:"open", label:"Open for submissions", cls:"st-open" };
  if (c.start && daysUntil(c.start) >= 0) return { key:"upcoming", label:"Upcoming", cls:"st-up" };
  if (c.end && daysUntil(c.end) < 0) return { key:"past", label:"Past edition", cls:"st-past" };
  if (c.start) return { key:"upcoming", label:"Under way", cls:"st-up" };
  return { key:"tba", label:"Next edition TBA", cls:"st-tba" };
}

function enrich(c) {
  const sc = score(c);
  c._J = sc.J; c._s = sc.s;
  c._formulaTier = tierFromScore(sc.s);
  c._tier = c.placeholder ? "TBC" : (c.override ? c.override.tier : c._formulaTier);
  c._status = status(c);
  return c;
}
// Database row -> conference object used by the screens
function fmtTs(ts) { const x = new Date(ts); return isNaN(x) ? "" : `${x.getDate()} ${MON[x.getMonth()]} ${x.getFullYear()}`; }
function rowToConf(r) {
  return enrich({ id: r.id, series: r.series, name: r.name, host: r.host, hostScore: r.host_score, hostNote: r.host_note || "",
    region: r.region, continent: r.continent, country: r.country, city: r.city || "", mode: r.mode || "",
    start: r.start_date || null, end: r.end_date || null, dateText: r.date_text || null, deadline: r.deadline || null,
    deadlineNote: r.deadline_note || null, areas: r.areas || [], j: r.journals || [], url: r.url || "", note: r.note || "",
    override: r.override || null, placeholder: !!r.placeholder,
    groups: r.for_groups || [], fields: r.for_fields || [], doctoral: !!r.doctoral });
}

// ---------- Start ----------
async function boot() {
  const app = document.getElementById("app");
  app.innerHTML = `<div class="welcome"><div class="mark">C</div><p>Loading conferences…</p></div>`;
  let rows;
  try { rows = await API.loadConferences(); }
  catch (e) { console.error(e); app.innerHTML = `<div class="welcome"><div class="mark">C</div><h1>Can't reach the app right now</h1><p>Check your internet connection, then try again.</p><button class="btn primary" type="button" onclick="location.reload()">Try again</button></div>`; return; }
  startApp(rows.map(rowToConf));
}
function startApp(DATA) {
const TB = { "A*":"ts", "A":"ta", "B":"tb2", "C":"tc", "General":"tg", "TBC":"tg" };
const STATUSES = [
  { k:"considering", label:"Under consideration", short:"Considering", next:"Reminders 45 and 14 days before the deadline, so you can decide in time." },
  { k:"planning",    label:"Planning to submit",  short:"Planning",    next:"Reminders 30, 14, 7, 3 and 1 day before the deadline." },
  { k:"submitted",   label:"Submitted",           short:"Submitted",   next:"Add the decision date: a reminder on that day, and again 3 days later if you haven't updated your status." },
  { k:"accepted",    label:"Accepted",            short:"Accepted",    next:"Add the registration deadline: reminders 14 and 3 days before and on the day. If you haven't marked Registered, a nudge 3 days later." },
  { k:"registered",  label:"Registered",          short:"Registered",  next:"Visa and travel reminder 90 days ahead for conferences abroad, then 30 and 7 days before the conference." },
  { k:"attended",    label:"Attended",            short:"Attended",    next:"Moves to your history. Add your role and paper for your CV." },
  { k:"hidden",      label:"Not interested",      short:"Hidden",      next:"Hidden from your lists. You can bring it back from My conferences." }
];
const ST = Object.fromEntries(STATUSES.map(s => [s.k, s]));
const REAL = DATA.filter(c => !c.placeholder);
const ROLES = ["Paper presenter", "Symposium or panel", "Doctoral consortium", "Session chair or discussant", "Attendee"];

// Research categories: ANZSRC 2020 Fields of Research, the classification behind the ABDC list (taxonomy.js).
// Stored as Division > Group > Field codes; people choose groups (disciplines) and optional fields (specialisations).
const TAX = window.CT_TAX || [];
const GROUPS = TAX.flatMap(dv => dv.groups.map(g => ({ ...g, div: dv.code, divLabel: dv.label })));
const GROUP = Object.fromEntries(GROUPS.map(g => [g.code, g]));
const FIELD = {}; GROUPS.forEach(g => g.fields.forEach(([code, name]) => FIELD[code] = { code, name, group: g.code }));
const groupLabel = code => (GROUP[code] && GROUP[code].label) || code;
const fieldLabel = code => (FIELD[code] && FIELD[code].name) || code;
// Regions and countries (QS-style: region first, then optional countries)
const REGIONS_DATA = window.CT_REGIONS || [];
const REGION_OF = {}; REGIONS_DATA.forEach(r => r.countries.forEach(c => REGION_OF[c] = r.name));
const REGIONS = REGIONS_DATA.map(r => r.name);
DATA.forEach(c => {
  c.groups = c.groups || []; c.fields = c.fields || [];
  if (!c.country) c.country = c.region === "India" ? "India" : "To be announced";
  c.continent = REGION_OF[c.country] || null;
});
function locationOK(c, u = S.user) {
  if (!c.continent) return true;                       // location still to be announced
  if (!u.regions.includes(c.continent)) return false;
  const chosen = (u.countries || []).filter(x => REGION_OF[x] === c.continent);
  return !chosen.length || chosen.includes(c.country); // no countries picked = the whole region
}
function areaOK(c, u = S.user) {
  if (!c.groups.some(g => u.discs.includes(g))) return false;
  const mine = u.specs.filter(f => c.groups.includes(f.slice(0, 4)));
  if (!mine.length) return true;                       // no specialisation chosen in these disciplines
  const theirs = c.fields.filter(f => mine.some(m => m.slice(0, 4) === f.slice(0, 4)));
  return !theirs.length || theirs.some(f => mine.includes(f)); // broad conferences match everyone in the discipline
}
function matchesUser(c) {
  return areaOK(c) && locationOK(c) && S.user.tiers.includes(c._tier === "General" ? "Unrated" : c._tier);
}
const COUNTRIES = "Afghanistan|Albania|Algeria|Andorra|Angola|Antigua and Barbuda|Argentina|Armenia|Australia|Austria|Azerbaijan|Bahamas|Bahrain|Bangladesh|Barbados|Belarus|Belgium|Belize|Benin|Bhutan|Bolivia|Bosnia and Herzegovina|Botswana|Brazil|Brunei|Bulgaria|Burkina Faso|Burundi|Cabo Verde|Cambodia|Cameroon|Canada|Central African Republic|Chad|Chile|China|Colombia|Comoros|Congo|Costa Rica|Côte d'Ivoire|Croatia|Cuba|Cyprus|Czechia|Democratic Republic of the Congo|Denmark|Djibouti|Dominica|Dominican Republic|Ecuador|Egypt|El Salvador|Equatorial Guinea|Eritrea|Estonia|Eswatini|Ethiopia|Fiji|Finland|France|Gabon|Gambia|Georgia|Germany|Ghana|Greece|Grenada|Guatemala|Guinea|Guinea-Bissau|Guyana|Haiti|Honduras|Hong Kong|Hungary|Iceland|India|Indonesia|Iran|Iraq|Ireland|Israel|Italy|Jamaica|Japan|Jordan|Kazakhstan|Kenya|Kiribati|Kuwait|Kyrgyzstan|Laos|Latvia|Lebanon|Lesotho|Liberia|Libya|Liechtenstein|Lithuania|Luxembourg|Macao|Madagascar|Malawi|Malaysia|Maldives|Mali|Malta|Marshall Islands|Mauritania|Mauritius|Mexico|Micronesia|Moldova|Monaco|Mongolia|Montenegro|Morocco|Mozambique|Myanmar|Namibia|Nauru|Nepal|Netherlands|New Zealand|Nicaragua|Niger|Nigeria|North Korea|North Macedonia|Norway|Oman|Pakistan|Palau|Palestine|Panama|Papua New Guinea|Paraguay|Peru|Philippines|Poland|Portugal|Qatar|Romania|Russia|Rwanda|Saint Kitts and Nevis|Saint Lucia|Saint Vincent and the Grenadines|Samoa|San Marino|São Tomé and Príncipe|Saudi Arabia|Senegal|Serbia|Seychelles|Sierra Leone|Singapore|Slovakia|Slovenia|Solomon Islands|Somalia|South Africa|South Korea|South Sudan|Spain|Sri Lanka|Sudan|Suriname|Sweden|Switzerland|Syria|Taiwan|Tajikistan|Tanzania|Thailand|Timor-Leste|Togo|Tonga|Trinidad and Tobago|Tunisia|Türkiye|Turkmenistan|Tuvalu|Uganda|Ukraine|United Arab Emirates|United Kingdom|United States|Uruguay|Uzbekistan|Vanuatu|Vatican City|Venezuela|Vietnam|Yemen|Zambia|Zimbabwe".split("|");
const firstName = () => (S.user.name || "").trim().split(/\s+/)[0] || "there";

const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/></svg>',
  discover: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  mine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  rem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 5-7 7 7 7"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>'
};

ICON.trophy = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4"/></svg>';
ICON.fb = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>';
ICON.bell2 = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>';
let INPUTS_T = null;

// ---------- State (in memory; saved to the database through API) ----------
const NEW_USER = (email, name) => ({ name: name || "", email, title: "", institution: "", role: "", country: "", discs: ["3507"], specs: [], ownTopic: "", regions: ["Asia"], countries: [], tiers: ["A*","A","B"], inapp: true, system: false, consent: false, onboarded: false, lbOptIn: false, lbName: "" });
const S = { screen: "welcome", tab: "home", detail: null, sub: null, mineTab: "planning", q: "", f: null, sort: "deadline", showNotes: false, modal: null,
  obStep: 1, user: NEW_USER(""), marks: {}, suggestions: [], myFeedback: [], session: null, isAdmin: false, emailSent: null, busy: false,
  host: { tab: "feedback", feedback: null, suggestions: null, names: {} }, board: { tab: "reviewers", rows: null } };
try { const p = JSON.parse(localStorage.getItem("ct-view") || "{}"); if (p.f) S.f = p.f; if (p.sort) S.sort = p.sort; } catch (e) {}

// ---------- Saving: only what changed, one write at a time ----------
const SYNC = { profile: null, marks: {}, timer: null, running: false, again: false, error: false };
function snapshotSynced() { SYNC.profile = JSON.stringify(S.user); SYNC.marks = {}; Object.entries(S.marks).forEach(([k, v]) => SYNC.marks[k] = JSON.stringify(v)); }
function save() {
  try { localStorage.setItem("ct-view", JSON.stringify({ f: S.f, sort: S.sort })); } catch (e) {}
  if (!S.session || !S.user.onboarded) return;
  clearTimeout(SYNC.timer); SYNC.timer = setTimeout(runSync, 500);
}
async function runSync() {
  if (SYNC.running) { SYNC.again = true; return; }
  SYNC.running = true;
  try {
    const uid = S.session.id;
    const pj = JSON.stringify(S.user);
    if (pj !== SYNC.profile) { await API.saveProfile(uid, S.user); SYNC.profile = pj; }
    const ids = new Set([...Object.keys(S.marks), ...Object.keys(SYNC.marks)]);
    for (const id of ids) {
      const mj = JSON.stringify(S.marks[id] || {});
      if (mj !== (SYNC.marks[id] || "{}")) { await API.saveMark(uid, id, S.marks[id] || {}); SYNC.marks[id] = mj; }
    }
    if (SYNC.error) { SYNC.error = false; toast("All changes saved"); }
  } catch (e) {
    console.error(e);
    if (!SYNC.error) toast("Couldn't save just now. We'll keep trying.");
    SYNC.error = true; setTimeout(runSync, 5000);
  }
  SYNC.running = false;
  if (SYNC.again) { SYNC.again = false; runSync(); }
}
async function enterAs(sess) {
  S.session = sess; S.busy = true; render();
  try {
    const data = await API.loadUserData(sess);
    S.user = data.user; S.marks = data.marks; S.suggestions = data.suggestions; S.myFeedback = data.feedback; S.isAdmin = data.isAdmin;
    snapshotSynced();
    S.busy = false; S.emailSent = null;
    if (S.user.onboarded) { S.screen = "app"; S.tab = "home"; } else { S.screen = "onboard"; S.obStep = 1; }
  } catch (e) { console.error(e); S.busy = false; toast("Couldn't load your account. Check your connection and try again."); }
  render();
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
const byId = id => DATA.find(c => c.id === id);
const mark = id => S.marks[id] || (S.marks[id] = {});
function iso(dt) { return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`; }
function addDays(s, n) { const x = d(s); x.setDate(x.getDate() + n); return iso(x); }
const TODAY_ISO = iso(TODAY);
const tierBadge = (c, big) => `<span class="tb ${TB[c._tier]}${big ? " big" : ""}" aria-label="Tier ${esc(c._tier)}">${c._tier === "General" ? "G" : esc(c._tier)}</span>`;

function deadlinePill(c) {
  if (c.deadline && daysUntil(c.deadline) >= 0) {
    const n = daysUntil(c.deadline);
    return `<span class="pill ${n <= 30 ? "p-soon" : "p-open"}">${n === 0 ? "Closes today" : n === 1 ? "Closes tomorrow" : `Closes in ${n} days`}</span>`;
  }
  if (c._status.key === "upcoming") return c.deadline ? `<span class="pill p-muted">Submissions closed</span>` : `<span class="pill p-muted">Deadline to be announced</span>`;
  if (c._status.key === "past") return `<span class="pill p-muted">Past edition</span>`;
  return `<span class="pill p-muted">Dates to be announced</span>`;
}
const whenText = c => c.start ? fmtRange(c.start, c.end) : (c.dateText || "Dates to be announced");
const statusPill = id => { const m = S.marks[id]; return m && m.status ? `<span class="pill p-status">${esc(ST[m.status].short)}</span>` : ""; };
const note = html => S.showNotes ? `<div class="note-be"><b>Back end:</b> ${html}</div>` : "";

function card(c) {
  return `<div class="card">
    <div class="crow">
      ${tierBadge(c)}
      <button class="grow" type="button" data-act="open" data-id="${c.id}" style="background:none;border:0;padding:0;text-align:left">
        <p class="cname">${esc(c.name)}</p>
        <div class="cmeta">${esc(c.host)} · ${esc(c.city)}</div>
        <div class="cmeta">${esc(whenText(c))}</div>
      </button>
    </div>
    <div class="pills">${deadlinePill(c)}${statusPill(c.id)}<button class="btn small" type="button" data-act="open" data-id="${c.id}" style="margin-left:auto">${S.marks[c.id] && S.marks[c.id].status ? "Change status" : "Set status"}</button></div>
  </div>`;
}

// ---------- Reminders ----------
function reminders() {
  const out = [];
  const plural = n => n === 1 ? "1 day" : n + " days";
  REAL.forEach(c => {
    const m = S.marks[c.id]; if (!m || !m.status) return;
    const add = (date, text, target) => out.push({ c, date, text, target });
    const dl = c.deadline, st = c.start;
    const abroad = c.country && c.country !== "India" && c.country !== "To be announced";
    switch (m.status) {
      case "considering":
        if (dl) [45, 14].forEach(n => add(addDays(dl, -n), `Decide whether to submit: deadline in ${plural(n)}`, dl));
        else add(null, "Submission deadline not announced yet", null);
        break;
      case "planning":
        if (dl) [30, 14, 7, 3, 1].forEach(n => add(addDays(dl, -n), `Submission deadline in ${plural(n)}`, dl));
        else add(null, "Submission deadline not announced yet", null);
        break;
      case "submitted":
        if (m.decisionDate) { add(m.decisionDate, "Decision expected today", m.decisionDate); add(addDays(m.decisionDate, 3), "Did you hear back? Update your status", addDays(m.decisionDate, 3)); }
        else add(null, "Add the decision date to get a reminder", null);
        break;
      case "accepted":
        if (m.regDeadline) {
          [14, 3].forEach(n => add(addDays(m.regDeadline, -n), `Register: registration closes in ${plural(n)}`, m.regDeadline));
          add(m.regDeadline, "Registration closes today. Mark Registered once you have", m.regDeadline);
          add(addDays(m.regDeadline, 3), "Please mark that you've registered", addDays(m.regDeadline, 3));
        } else add(null, "Add the registration deadline to get reminders", null);
        break;
      case "registered":
        if (st) {
          if (abroad) add(addDays(st, -90), "Visa and travel: conference in 90 days", st);
          add(addDays(st, -30), "Conference in 30 days: check travel and accommodation", st);
          add(addDays(st, -7), "Conference starts in a week", st);
        }
        break;
    }
  });
  const live = out.filter(r => !r.target || r.target >= TODAY_ISO);
  // For each conference only the latest reminder that has come due counts as due now
  const dueByConf = {};
  live.filter(r => r.date && r.date <= TODAY_ISO).forEach(r => { const k = r.c.id; if (!dueByConf[k] || r.date > dueByConf[k].date) dueByConf[k] = r; });
  const due = Object.values(dueByConf).sort((a,b) => a.target.localeCompare(b.target));
  const future = live.filter(r => r.date && r.date > TODAY_ISO).sort((a,b) => a.date.localeCompare(b.date));
  const week = addDays(TODAY_ISO, 7);
  return { due, week: future.filter(r => r.date <= week), later: future.filter(r => r.date > week), wait: live.filter(r => !r.date), next: future[0] || null };
}
function remItem(r, cls) {
  const x = r.date ? d(r.date) : null;
  const when = cls === "due" ? `<b>Now</b><small>due</small>` : x ? `<b>${x.getDate()}</b><small>${MON[x.getMonth()]}</small>` : `<b>–</b><small>TBA</small>`;
  return `<button class="card tap" type="button" data-act="open" data-id="${r.c.id}"><div class="rem ${cls}"><div class="when">${when}</div><div><p class="cname">${esc(r.text)}</p><div class="cmeta">${esc(r.c.name)}</div>${r.target ? `<div class="cmeta">${esc(fmt(r.target))}</div>` : ""}</div></div></button>`;
}

// ---------- Screens ----------
function welcome() {
  if (S.busy) return `<div class="welcome"><div class="mark">C</div><p>Opening your account…</p></div>`;
  return `<div class="welcome">
    <div class="mark">C</div>
    <div class="stack"><h1>Every management conference worth your paper, in one place</h1>
    <p>A*, A, B and C conferences in India and abroad, with reminders for the deadlines that matter to you.</p>
    ${API.mode === "demo" ? `<p style="font-size:13px">Demo mode: not yet connected to the database, so everything stays in this browser.</p>` : `<p style="font-size:13px">Preview version. Your account works on any phone or laptop you sign in from.</p>`}</div>
    ${S.emailSent ? `<div class="card"><p class="cname">Check your email</p><div class="cmeta" style="color:var(--ink)">We've sent a sign-in link to <b>${esc(S.emailSent)}</b>. Open it on this device to continue.</div><button class="btn small" type="button" data-act="emailAgain" style="justify-self:start">Use a different email</button></div>` : `<div class="stack">
      <button class="btn primary block" type="button" data-act="signin" data-v="google">Continue with Google</button>
      <div class="divider">or</div>
      <div class="field"><label for="em">Email</label><input id="em" type="email" placeholder="you@university.edu" autocomplete="email"></div>
      <button class="btn block" type="button" data-act="signin" data-v="email">Send me a sign-in link</button>
    </div>`}
    <div class="cmeta" style="text-align:center">One account per email. If you've signed up before, this opens your existing account.</div>
    <div class="cmeta" style="text-align:center"><a href="privacy.html">Privacy policy</a></div>
  </div>`;
}
function chipRow(list, selected, act) {
  return `<div class="chips">${list.map(([k, label]) => `<button class="chip" type="button" data-act="${act}" data-v="${esc(k)}" aria-pressed="${selected.includes(k)}">${esc(label)}</button>`).join("")}</div>`;
}
function tierInfo() {
  return `<div class="card" style="background:var(--accent-soft);border-color:transparent"><div class="cmeta" style="color:var(--ink)"><b>About these tiers.</b> No official body ranks management conferences. The tiers here are worked out from the ABDC rank of the journals a conference publishes into and the standing of its host. <button type="button" data-act="howTiers" style="background:none;border:0;padding:0;color:var(--accent);text-decoration:underline">How tiers work</button></div></div>`;
}
function disciplinePicker(selected, act, counts) {
  return TAX.map(dv => `<div style="margin-bottom:8px"><div class="cmeta" style="font-weight:600;margin-bottom:4px">${esc(dv.label)}</div><div class="chips">${dv.groups.map(g =>
    `<button class="chip" type="button" data-act="${act}" data-v="${g.code}" aria-pressed="${selected.includes(g.code)}" title="${esc(g.name)}">${esc(g.label)}${counts ? ` (${counts[g.code] || 0})` : ""}</button>`).join("")}</div></div>`).join("");
}
function specPicker(discs, specs) {
  return discs.filter(code => GROUP[code]).map(code => { const g = GROUP[code];
    return `<details class="card" style="gap:6px" ${g.fields.some(([f]) => specs.includes(f)) || discs.length === 1 ? "open" : ""}><summary style="cursor:pointer;font-weight:600;font-size:14px">${esc(g.label)}${g.fields.filter(([f]) => specs.includes(f)).length ? ` · ${g.fields.filter(([f]) => specs.includes(f)).length} chosen` : ""}</summary>
      <div class="chips">${g.fields.map(([f, name]) => `<button class="chip" type="button" data-act="toggleSpec" data-v="${f}" aria-pressed="${specs.includes(f)}">${esc(name)}</button>`).join("")}</div></details>`; }).join("");
}
function regionPicker(regions, countries) {
  return `<div class="chips">${REGIONS.map(r => `<button class="chip" type="button" data-act="toggleRegion" data-v="${esc(r)}" aria-pressed="${regions.includes(r)}">${esc(r)}</button>`).join("")}</div>
    ${regions.map(r => { const list = (REGIONS_DATA.find(x => x.name === r) || { countries: [] }).countries; const picked = countries.filter(c => REGION_OF[c] === r);
      return `<details class="card" style="gap:6px;margin-top:8px"><summary style="cursor:pointer;font-size:14px"><b>${esc(r)}</b>: ${picked.length ? esc(picked.join(", ")) : "all countries"}</summary>
        <div class="chips"><button class="chip" type="button" data-act="allCountries" data-v="${esc(r)}" aria-pressed="${!picked.length}">All of ${esc(r)}</button>${list.map(c => `<button class="chip" type="button" data-act="toggleCountry" data-v="${esc(c)}" aria-pressed="${picked.includes(c)}">${esc(c)}</button>`).join("")}</div></details>`; }).join("")}`;
}
function prefSummary(u) {
  const regionText = u.regions.map(r => { const picked = (u.countries || []).filter(c => REGION_OF[c] === r); return picked.length ? `${r} (${picked.join(", ")})` : r; }).join(", ");
  return `<dl class="kv">
      <dt>Disciplines</dt><dd>${esc(u.discs.map(groupLabel).join(", ") || "None chosen")}</dd>
      <dt>Specialisations</dt><dd>${esc(u.specs.map(fieldLabel).join(", ") || "All within your disciplines")}</dd>
      ${u.ownTopic !== undefined ? `<dt>Topic</dt><dd>${esc(u.ownTopic || "Not set")}</dd>` : ""}
      <dt>Regions</dt><dd>${esc(regionText || "None chosen")}</dd>
      <dt>Tiers</dt><dd>${esc(u.tiers.join(", "))}</dd>
    </dl>`;
}
function onboarding() {
  const u = S.user, step = S.obStep, steps = 4;
  const head = t => `<div class="appbar">${step > 1 ? `<button class="iconbtn" type="button" data-act="obBack" aria-label="Back">${ICON.back}</button>` : ""}<h2>${t}</h2></div>`;
  const prog = `<div class="step">Step ${step} of ${steps}</div><div style="height:4px;background:var(--rule);border-radius:4px"><div style="height:4px;width:${step / steps * 100}%;background:var(--accent);border-radius:4px"></div></div>`;
  let body = "", btn = "";
  if (step === 1) {
    body = `<div class="field"><label for="u-name">Full name</label><input id="u-name" data-ufield="name" value="${esc(u.name)}" placeholder="As you'd like it shown" autocomplete="name"></div>
      <div class="field"><label for="u-inst">Institution</label><input id="u-inst" data-ufield="institution" value="${esc(u.institution)}" placeholder="University or business school"></div>
      <div class="field"><label for="u-role">You are a</label><select id="u-role" data-ufield="role">${["","Doctoral scholar","Faculty member","Postdoctoral researcher","Practitioner","Other"].map(r => `<option value="${esc(r)}"${u.role === r ? " selected" : ""}>${r || "Choose one"}</option>`).join("")}</select></div>
      <div class="field"><label for="u-country">Country where you work</label><select id="u-country" data-ufield="country"><option value="">Choose your country</option>${COUNTRIES.map(c => `<option${u.country === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="card" style="background:var(--accent-soft);border-color:transparent"><div class="cmeta" style="color:var(--ink)">Signed in as <b>${esc(u.email)}</b>. This email is your account. If you move to another country, update it in Profile; there's no need to register again.</div></div>
      ${note("Profile fields on the user record. Name and email come from Google sign-in when used. The email is unique: one account per email, so the same person cannot register twice. Names need not be unique.")}`;
    btn = `<button class="btn primary block" type="button" data-act="obNext">Next</button>`;
  } else if (step === 2) {
    body = `<div><p class="cname" style="margin-bottom:4px">Your disciplines</p><div class="cmeta" style="margin-bottom:8px">Choose all that apply.</div>${disciplinePicker(u.discs, "toggleDisc")}</div>
      ${u.discs.length ? `<div><p class="cname" style="margin-bottom:4px">Your specialisations <span class="cmeta">(optional)</span></p><div class="cmeta" style="margin-bottom:8px">Leave empty to see everything in your disciplines.</div>${specPicker(u.discs, u.specs)}</div>` : ""}
      <div class="cmeta">Categories follow the ANZSRC 2020 Fields of Research, the classification used by the ABDC Journal Quality List.</div>
      <div class="field"><label for="u-topic">Your research topic, in your words <span class="cmeta">(optional)</span></label><input id="u-topic" data-ufield="ownTopic" value="${esc(u.ownTopic)}" placeholder="For example, social entrepreneurship"></div>
      ${note("Store ANZSRC group and field codes; every conference is tagged with the same codes so recommendations match precisely.")}`;
    btn = `<button class="btn primary block" type="button" data-act="obNext">Next</button>`;
  } else if (step === 3) {
    body = `<div><p class="cname" style="margin-bottom:4px">Where would you present?</p><div class="cmeta" style="margin-bottom:8px">Choose regions. To narrow down, pick countries inside a region; otherwise the whole region is included.</div>${regionPicker(u.regions, u.countries || [])}<div class="cmeta" style="margin-top:6px">The list currently covers India and the major international meetings. More countries are being added.</div></div>
      <div><p class="cname" style="margin-bottom:6px">Which tiers should we recommend?</p>${chipRow([["A*","A*"],["A","A"],["B","B"],["C","C"],["Unrated","Unrated"]], u.tiers, "toggleTier")}<div class="cmeta" style="margin-top:6px">This only shapes your recommendations. You can still browse every conference.</div></div>
      ${tierInfo()}
      ${note("Store regions and countries; tag each conference with its country and region.")}`;
    btn = `<button class="btn primary block" type="button" data-act="obNext">Next</button>`;
  } else {
    body = `<div class="card">
        <div class="toggle-row"><div><b>In-app reminders</b><div class="cmeta">Shown in the Reminders tab and on Home</div></div><button class="switch" type="button" role="switch" aria-checked="${u.inapp}" data-act="inapp" aria-label="In-app reminders"></button></div>
        <div class="toggle-row"><div><b>Notifications on this device</b><div class="cmeta">We'll ask your permission first</div></div><button class="switch" type="button" role="switch" aria-checked="${u.system}" data-act="system" aria-label="Device notifications"></button></div>
      </div>
      <div class="card"><p class="cname">Your data stays private</p>
        <div class="cmeta" style="color:var(--ink)">We use your details only to tailor your conference list and send the reminders you ask for. We never sell or share your data, and you can download or delete it at any time from Profile.</div>
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:14px;margin-top:4px"><input type="checkbox" data-ufield="consent" ${u.consent ? "checked" : ""} style="margin-top:3px"> I agree to the privacy policy and terms of use.</label>
      </div>
      ${note("Record consent with date and time; privacy policy and terms pages; data export and deletion must work as promised here.")}`;
    btn = `<button class="btn primary block" type="button" data-act="savePrefs" ${u.consent ? "" : "disabled"} id="saveBtn">Save preferences</button>${u.consent ? "" : `<div class="cmeta" style="text-align:center">Tick the box above to continue.</div>`}`;
  }
  const titles = ["", "About you", "Your research", "Your conferences", "Reminders and privacy"];
  return head(titles[step]) + `<div class="scroll">${prog}${body}${btn}</div>`;
}
function doneScreen() {
  const u = S.user;
  const n = REAL.filter(matchesUser).length;
  return `<div class="welcome">
    <div class="mark">✓</div>
    <div class="stack"><h1>You're all set, ${esc(firstName())}</h1>
    <p>We found ${n} conference${n === 1 ? "" : "s"} that match your preferences.</p></div>
    <div class="card">${prefSummary(u)}</div>
    <button class="btn primary block" type="button" data-act="goHome">Go to my home</button>
    <div class="cmeta" style="text-align:center">You can change these any time in Profile.</div>
  </div>`;
}
function home() {
  const r = reminders();
  const count = k => REAL.filter(c => S.marks[c.id] && S.marks[c.id].status === k).length;
  const soon = REAL.filter(c => matchesUser(c) && c.deadline && daysUntil(c.deadline) >= 0 && daysUntil(c.deadline) <= 90 && !(S.marks[c.id] && S.marks[c.id].status === "hidden"))
    .sort((a,b) => d(a.deadline) - d(b.deadline));
  const initials = (S.user.name || "?").split(/\s+/).filter(Boolean).map(w => w[0]).slice(0,2).join("").toUpperCase();
  const tile = (n, label, tab) => `<button class="card tap" type="button" data-act="mineGo" data-v="${tab}" style="gap:0"><span style="font-family:var(--display);font-size:24px;font-variant-numeric:tabular-nums">${n}</span><span class="cmeta">${label}</span></button>`;
  return `<div class="appbar"><div style="flex:1"><div class="cmeta">Welcome back</div><h2>${esc(S.user.name || "Scholar")}</h2></div><button class="iconbtn" type="button" data-act="tab" data-v="reminders" aria-label="Reminders" style="position:relative">${ICON.bell2}${S.user.inapp && r.due.length ? `<span class="badge" style="left:auto;right:0;top:0">${r.due.length}</span>` : ""}</button><button class="iconbtn" type="button" data-act="tab" data-v="profile" aria-label="Profile"><span style="width:36px;height:36px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-weight:600;font-size:14px">${esc(initials)}</span></button></div>
  <div class="scroll">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${tile(count("planning"), "Planning", "planning")}${tile(count("registered"), "Registered", "registered")}${tile(count("attended"), "Attended", "attended")}</div>
    <div class="section-title">Needs your attention</div>
    ${S.user.inapp && r.due.length ? r.due.map(x => remItem(x, "due")).join("") : r.next
      ? `<div class="cmeta">Nothing due right now. Next up:</div>${remItem(r.next, "")}`
      : `<div class="card"><div class="cmeta">Nothing due right now. Choose a status on a conference, such as Planning to submit, and its reminders will appear here.</div></div>`}
    <div class="section-title">Deadlines in the next 90 days for you</div>
    ${soon.length ? soon.map(card).join("") : `<div class="card"><div class="cmeta">No matching deadlines in the next 90 days.</div></div>`}
    <div class="section-title">Quick actions</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn" type="button" data-act="tab" data-v="discover">Browse all conferences</button>
      <button class="btn" type="button" data-act="suggest">Suggest a conference</button>
      <button class="btn" type="button" data-act="howTiers">How tiers work</button>
      <button class="btn" type="button" data-act="install">${INSTALL.prompt ? "Install the app" : "Add to home screen"}</button>
    </div>
    ${note("Home pulls together the user's counts, due reminders and matching deadlines. Suggestions go to a review queue for the editor.")}
  </div>`;
}

// ---------- Discover with filters ----------
DATA.forEach(c => {
  const y = (c.start || c.dateText || "").match(/20\d\d/); c.year = y ? y[0] : "To be announced";
  c.fmt = /online/i.test(c.mode) && !/hybrid/i.test(c.mode) ? "Online" : /hybrid/i.test(c.mode) ? "Hybrid" : "In person";
  c.regionF = c.continent || "Location to be announced";
});
const FKEYS = {
  tiers:   { label:"Tier", opts:() => ["A*","A","B","C","Unrated"], get:c => c._tier === "General" ? "Unrated" : c._tier },
  regions: { label:"Region", opts:() => [...REGIONS, "Location to be announced"], get:c => c.regionF },
  countries:{ label:"Country", opts:() => [...new Set(REAL.map(c => c.country))].sort((a,b) => a === "To be announced" ? 1 : b === "To be announced" ? -1 : a.localeCompare(b)), get:c => c.country },
  years:   { label:"Year", opts:() => [...new Set(REAL.map(c => c.year))].sort(), get:c => c.year },
  status:  { label:"Status", opts:() => ["Open for submissions","Upcoming","Past edition","Next edition TBA"], get:c => c._status.key === "open" ? "Open for submissions" : c._status.key === "upcoming" ? "Upcoming" : c._status.key === "past" ? "Past edition" : "Next edition TBA" },
  discs:   { label:"Discipline", opts:() => GROUPS.map(g => g.label), get:c => c.groups.map(groupLabel) },
  doctoral:{ label:"Doctoral track", opts:() => ["Has a doctoral colloquium or consortium"], get:c => c.doctoral ? "Has a doctoral colloquium or consortium" : "" },
  formats: { label:"Format", opts:() => ["In person","Hybrid","Online"], get:c => c.fmt }
};
const blankF = () => Object.fromEntries(Object.keys(FKEYS).map(k => [k, []]));
const SORTS = [["deadline","Nearest deadline"],["date","Conference date"],["tier","Highest tier"],["name","Name A–Z"]];
function filtered(f = S.f) {
  const q = (S.q || "").toLowerCase().split(/\s+/).filter(Boolean);
  const rows = REAL.filter(c => {
    if (S.marks[c.id] && S.marks[c.id].status === "hidden") return false;
    for (const k of Object.keys(FKEYS)) {
      if (!f[k].length) continue;
      const v = FKEYS[k].get(c);
      if (Array.isArray(v) ? !v.some(x => f[k].includes(x)) : !f[k].includes(v)) return false;
    }
    const hay = [c.name, c.host, c.city, c.country, c.areas.join(" "), c.j.map(j => j.n).join(" ")].join(" ").toLowerCase();
    return q.every(w => hay.includes(w));
  });
  const stRank = c => c._status.key === "open" ? 0 : c._status.key === "upcoming" ? 1 : c._status.key === "tba" ? 2 : 3;
  const sorters = {
    deadline: (a,b) => stRank(a) - stRank(b) || (a.deadline || a.start || "9").localeCompare(b.deadline || b.start || "9"),
    date: (a,b) => (a.start || "9").localeCompare(b.start || "9"),
    tier: (a,b) => TIER_RANK[a._tier] - TIER_RANK[b._tier] || b._s - a._s,
    name: (a,b) => a.name.localeCompare(b.name)
  };
  return rows.sort(sorters[S.sort || "deadline"]);
}
const activeCount = (f = S.f) => Object.values(f).reduce((n, a) => n + a.length, 0);
const QUICK = [["status","Open for submissions","Open now"],["tiers","A*","A*"],["tiers","A","A"],["countries","India","India"],["regions","Europe","Europe"],["years","2027","2027"]];

function discover() {
  S.f = { ...blankF(), ...(S.f || {}) };
  const filtering = activeCount() > 0 || (S.q || "").trim();
  const recs = REAL.filter(c => !(S.marks[c.id] && S.marks[c.id].status === "hidden") && matchesUser(c) && (c._status.key === "open" || c._status.key === "upcoming"))
    .sort((a,b) => (a.deadline && daysUntil(a.deadline) >= 0 ? d(a.deadline) : 9e15) - (b.deadline && daysUntil(b.deadline) >= 0 ? d(b.deadline) : 9e15) || TIER_RANK[a._tier] - TIER_RANK[b._tier]).slice(0, 2);
  const n = activeCount();
  return `<div class="appbar"><h2>Discover</h2></div>
  <div style="padding:12px 16px 10px;display:grid;gap:10px;border-bottom:1px solid var(--rule);background:var(--paper)">
    <div style="display:flex;gap:8px">
      <input class="search" id="q" type="search" placeholder="Search conference, school, journal, city" value="${esc(S.q)}" aria-label="Search conferences">
      <button class="btn" type="button" data-act="openFilters" style="white-space:nowrap;${n ? "border-color:var(--accent);color:var(--accent)" : ""}">Filters${n ? ` (${n})` : ""}</button>
    </div>
    <div class="seg">${QUICK.map(([k, v, l]) => `<button class="chip" type="button" data-act="quick" data-k="${k}" data-v="${esc(v)}" aria-pressed="${S.f[k].includes(v)}">${esc(l)}</button>`).join("")}</div>
  </div>
  <div class="scroll">
    ${!filtering ? `<div class="section-title">Recommended for you</div>
      <div class="cmeta">Open or upcoming conferences that match your disciplines, specialisations, regions and tiers, nearest deadline first. <button type="button" data-act="editPrefs" style="background:none;border:0;padding:0;color:var(--accent);text-decoration:underline">Edit preferences</button></div>
      ${recs.length ? recs.map(card).join("") : `<div class="empty">Nothing open matches your preferences right now. Try widening them.</div>`}<div class="section-title">All conferences</div>` : ""}
    <div id="dlist" style="display:grid;gap:12px">${discoverList()}</div>
    ${note("Filter and sort on the server: tier, region, country, year, status, discipline and format are stored as fields on each conference. Saved filters could later power personal alerts.")}
  </div>`;
}
function discoverList() {
  const rows = filtered();
  const chips = Object.entries(S.f).flatMap(([k, vals]) => vals.map(v => `<button class="chip" type="button" data-act="unfilter" data-k="${k}" data-v="${esc(v)}" aria-pressed="true" aria-label="Remove filter ${esc(v)}">${esc(v)} ✕</button>`)).join("");
  const head = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="cmeta"><b style="color:var(--ink)">${rows.length}</b> conference${rows.length === 1 ? "" : "s"}</span>
    <label class="cmeta" style="display:flex;gap:6px;align-items:center">Sort <select id="sortSel" style="padding:4px 6px;border:1px solid var(--rule);border-radius:6px;background:var(--surface)">${SORTS.map(([k, l]) => `<option value="${k}"${(S.sort || "deadline") === k ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>`;
  return head + (chips ? `<div class="chips">${chips}<button class="chip" type="button" data-act="clearFilters">Clear all</button></div>` : "")
    + (rows.length ? rows.map(card).join("") : `<div class="empty">No conferences match these filters. Remove a filter to see more.</div>`);
}
function filterSheet() {
  const f = S.fDraft;
  const count = filtered(f).length;
  const sec = k => {
    const F = FKEYS[k];
    const others = { ...f, [k]: [] };            // counts reflect the other filters already chosen
    const pool = filtered(others);
    const cnt = o => pool.filter(c => { const v = F.get(c); return Array.isArray(v) ? v.includes(o) : v === o; }).length;
    const opts = F.opts().map(o => [o, cnt(o)]);
    const avail = opts.filter(([, n]) => n > 0).length;
    return `<div style="display:grid;gap:6px"><div class="section-title" style="margin:0">${F.label}</div>
      ${avail === 1 && opts.length > 1 ? `<div class="cmeta">Only one option matches your other filters.</div>` : ""}
      <div class="chips">${opts.map(([o, n]) => `<button class="chip" type="button" data-act="fToggle" data-k="${k}" data-v="${esc(o)}" aria-pressed="${f[k].includes(o)}" style="${n || f[k].includes(o) ? "" : "opacity:.5"}">${esc(o)} (${n})</button>`).join("")}</div></div>`;
  };
  return `<div class="modal-back" data-backdrop="1" style="place-items:end stretch;padding:0"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="fh" style="max-width:none;border-radius:18px 18px 0 0;height:88%;display:flex;flex-direction:column;padding:0;gap:0">
    <div style="display:flex;align-items:center;gap:8px;padding:12px 12px 12px 16px;border-bottom:1px solid var(--rule)"><h3 id="fh" style="flex:1">Filters</h3><button class="btn small" type="button" data-act="fReset">Clear all</button><button class="iconbtn" type="button" data-act="closeModal" aria-label="Close filters" style="font-size:20px;line-height:1">✕</button></div>
    <div style="flex:1;min-height:0;overflow-y:auto;padding:14px 16px;display:grid;gap:16px;align-content:start">${Object.keys(FKEYS).map(sec).join("")}</div>
    <div style="padding:12px 16px;border-top:1px solid var(--rule);display:flex;gap:8px;background:var(--surface)"><button class="btn" type="button" data-act="closeModal">Cancel</button><button class="btn primary" type="button" data-act="applyFilters" style="flex:1">Show ${count} conference${count === 1 ? "" : "s"}</button></div>
  </div></div>`;
}

function detail(c) {
  const m = S.marks[c.id] || {};
  const followup = () => {
    if (m.status === "submitted") return `<div class="followup">
      <div class="field"><label for="f-paper">Paper title</label><input id="f-paper" data-field="paperTitle" value="${esc(m.paperTitle)}" placeholder="Title of your submission"></div>
      <div class="field"><label for="f-dec">Decision expected on</label><input id="f-dec" type="date" data-field="decisionDate" value="${esc(m.decisionDate)}"></div></div>`;
    if (m.status === "accepted") return `<div class="followup">
      <div class="field"><label for="f-paper">Paper title</label><input id="f-paper" data-field="paperTitle" value="${esc(m.paperTitle)}"></div>
      <div class="field"><label for="f-reg">Registration closes on</label><input id="f-reg" type="date" data-field="regDeadline" value="${esc(m.regDeadline)}"></div></div>`;
    if (m.status === "registered") return `<div class="followup"><div class="cmeta">Reminders set for travel and visa 30 days ahead and one week before the conference.</div>
      <div class="field"><label for="f-note">Travel notes</label><textarea id="f-note" rows="2" data-field="note" placeholder="Flights, hotel, visa appointment">${esc(m.note)}</textarea></div></div>`;
    if (m.status === "attended") return `<div class="followup">
      <div class="field"><label for="f-role">Your role</label><select id="f-role" data-field="role">${["", ...ROLES].map(r => `<option value="${esc(r)}"${m.role === r ? " selected" : ""}>${r || "Choose your role"}</option>`).join("")}</select></div>
      <div class="field"><label for="f-paper">Paper or session title</label><input id="f-paper" data-field="paperTitle" value="${esc(m.paperTitle)}"></div></div>`;
    return "";
  };
  const jrs = c.j.length ? c.j.map(j => `<div class="jr"><b>${j.a ? "ABDC " + esc(j.a) : "Not listed"}</b><span>${esc(j.n)}</span><span class="ty">${esc(TYPE_LABEL[j.t])}</span></div>`).join("") : `<div class="cmeta">No journal route announced yet.</div>`;
  return `<div class="appbar"><button class="iconbtn" type="button" data-act="back" aria-label="Back">${ICON.back}</button><h2 style="font-size:17px">Conference</h2></div>
  <div class="scroll">
    <div class="crow">${tierBadge(c, true)}<div class="grow"><p class="cname" style="font-size:17px">${esc(c.name)}</p><div class="cmeta">${esc(c.host)}</div></div></div>
    <div class="pills">${deadlinePill(c)}${statusPill(c.id)}</div>
    <div class="card"><dl class="kv">
      <dt>Dates</dt><dd>${esc(whenText(c))}</dd>
      <dt>Place</dt><dd>${esc(c.city)}${c.mode ? " · " + esc(c.mode) : ""}</dd>
      <dt>Deadline</dt><dd>${c.deadline ? esc(fmt(c.deadline)) + (daysUntil(c.deadline) < 0 ? " (passed)" : "") : esc(c.deadlineNote || "To be announced")}</dd>
      <dt>Areas</dt><dd>${esc(c.areas.join(", "))}</dd>
    </dl>${c.note ? `<div class="cmeta">${esc(c.note)}</div>` : ""}<a href="${esc(c.url)}" target="_blank" rel="noopener">Official conference page</a></div>
    <div class="section-title">Your status</div>
    <div class="statuslist">${STATUSES.map(s => `<button class="statusopt" type="button" data-act="setStatus" data-id="${c.id}" data-v="${s.k}" aria-pressed="${m.status === s.k}"><span class="radio"></span><span><b>${s.label}</b><span class="d">${s.next}</span></span></button>`).join("")}</div>
    ${followup()}
    ${note("Save each user's status per conference with the date it changed, plus the follow-up fields (paper title, decision date, registration deadline, role). Each change creates or cancels scheduled reminders.")}
    <div class="section-title">Journals linked to this conference</div>
    <div class="card">${jrs}</div>
    <div class="section-title">Why tier ${esc(c._tier)}</div>
    <div class="card"><div class="cmeta">Journal signal ${c._J} × 0.6 + host signal ${c.hostScore} × 0.4 = ${c._s.toFixed(2)}${c.override ? `. Adjusted to ${esc(c.override.tier)}: ${esc(c.override.reason)}` : ""}</div><div class="cmeta">Host: ${esc(c.hostNote)}.</div></div>
  </div>`;
}

function mine() {
  const tabs = STATUSES.map(s => ({ ...s, items: REAL.filter(c => S.marks[c.id] && S.marks[c.id].status === s.k) }));
  const cur = tabs.find(t => t.k === S.mineTab) || tabs[0];
  const body = cur.items.length ? cur.items.map(c => {
    const m = S.marks[c.id];
    if (cur.k === "attended") return `<button class="card tap" type="button" data-act="open" data-id="${c.id}"><div class="crow">${tierBadge(c)}<div class="grow"><p class="cname">${esc(c.name)}</p><div class="cmeta">${esc(whenText(c))} · ${esc(c.city)}</div><div class="cmeta">${esc(m.role || "Add your role")}${m.paperTitle ? " · " + esc(m.paperTitle) : ""}</div></div></div></button>`;
    if (cur.k === "hidden") return `<div class="card"><div class="crow">${tierBadge(c)}<div class="grow"><p class="cname">${esc(c.name)}</p><div class="cmeta">${esc(whenText(c))}</div></div><button class="btn small" type="button" data-act="unhide" data-id="${c.id}">Bring back</button></div></div>`;
    return card(c);
  }).join("") : `<div class="empty">Nothing marked “${esc(cur.label)}” yet. Open a conference and choose a status.</div>`;
  return `<div class="appbar"><h2>My conferences</h2></div>
  <div class="scroll">
    <div class="seg">${tabs.map(t => `<button class="chip" type="button" data-act="mineTab" data-v="${t.k}" aria-pressed="${t.k === cur.k}">${esc(t.short)} ${t.items.length}</button>`).join("")}</div>
    ${body}
    ${cur.k === "attended" && cur.items.length ? `<button class="btn block" type="button" data-act="copyCV">Copy attended list for my CV</button>` : ""}
    ${note("Fetch the user's conferences grouped by status. Attended history can be exported for a CV.")}
  </div>`;
}

function remindersScreen() {
  const r = reminders();
  const total = r.due.length + r.week.length + r.later.length + r.wait.length;
  const sec = (title, list, cls) => list.length ? `<div class="section-title">${title}</div>${list.map(x => remItem(x, cls)).join("")}` : "";
  return `<div class="appbar"><h2>Reminders</h2></div>
  <div class="scroll">
    ${!S.user.inapp ? `<div class="card"><div class="cmeta">In-app reminders are off. Turn them on in Profile.</div></div>` : total ? sec("Due now", r.due, "due") + sec("This week", r.week, "") + sec("Coming up", r.later, "") + sec("Waiting for dates", r.wait, "wait")
      : `<div class="empty">No reminders yet. Open a conference and choose a status, such as Under consideration or Planning to submit.</div>`}
    ${note("A scheduler that works out each user's reminders every day from their statuses, then sends them in the app, as device notifications (with permission) and by email.")}
  </div>`;
}

const BLANK_DRAFT = () => ({ name:"", organiser:"", website:"", edition:"", dateStatus:"I don't know", start:"", end:"", approx:"", deadline:"", deadlineStatus:"I don't know",
  format:"I don't know", city:"", country:"", rotates:"I don't know", discs:[], journals:"", jlink:"I don't know", proceedings:"I don't know", fee:"", doctoral:"I don't know", source:"", relation:"", contactOK:true, notes:"" });
function suggestForm() {
  const g = S.draft || (S.draft = BLANK_DRAFT());
  const inp = (k, label, ph = "", type = "text", req = false) => `<div class="field"><label for="d-${k}">${label}${req ? " <span style='color:var(--soon)'>*</span>" : ""}</label><input id="d-${k}" type="${type}" data-dfield="${k}" value="${esc(g[k])}" placeholder="${esc(ph)}"></div>`;
  const pick = (k, label, opts) => `<div class="field"><span style="font-size:13px;font-weight:500">${label}</span><div class="chips">${opts.map(o => `<button class="chip" type="button" data-act="dpick" data-k="${k}" data-v="${esc(o)}" aria-pressed="${g[k] === o}">${esc(o)}</button>`).join("")}</div></div>`;
  const dates = g.dateStatus === "Announced" ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${inp("start","Starts","","date")}${inp("end","Ends","","date")}</div>`
    : g.dateStatus === "Expected" ? inp("approx","Expected month or season","For example, December 2027") : "";
  const dl = g.deadlineStatus === "Announced" ? inp("deadline","Submission deadline","","date") : g.deadlineStatus === "Expected" ? `<div class="cmeta">We'll mark it as expected and check again.</div>` : `<div class="cmeta">No problem. We'll look it up.</div>`;
  const loc = g.format === "Online" ? "" : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${inp("city","City","Ahmedabad")}${inp("country","Country","India")}</div>${pick("rotates","Does the venue change every year?",["No","Yes, it rotates","I don't know"])}`;
  return `<div class="appbar"><button class="iconbtn" type="button" data-act="closeSub" aria-label="Back">${ICON.back}</button><h2 style="font-size:18px">Suggest a conference</h2></div>
  <div class="scroll">
    <div class="card" style="background:var(--accent-soft);border-color:transparent"><div class="cmeta" style="color:var(--ink)">Only the two fields marked <span style="color:var(--soon)">*</span> are needed. For everything else, share what you know or choose “I don't know”. Our editors will find any details you've missed.</div></div>
    <div class="section-title">The conference</div>
    ${inp("name","Conference name","For example, SPJIMR Research Conference","text",true)}
    ${inp("organiser","Organised by","School or association","text",true)}
    ${inp("website","Official website or call for papers","Leave empty if you don't have the link","url")}
    ${inp("edition","Edition or year","For example, 5th edition, 2027")}
    <div class="section-title">Dates</div>
    ${pick("dateStatus","Conference dates are",["Announced","Expected","I don't know"])}
    ${dates}
    ${pick("deadlineStatus","Submission deadline is",["Announced","Expected","I don't know"])}
    ${dl}
    <div class="section-title">Location</div>
    ${pick("format","Format",["In person","Hybrid","Online","I don't know"])}
    ${loc}
    <div class="section-title">Research area</div>
    <div class="chips">${GROUPS.map(gr => `<button class="chip" type="button" data-act="dDisc" data-v="${gr.code}" aria-pressed="${g.discs.includes(gr.code)}">${esc(gr.label)}</button>`).join("")}<button class="chip" type="button" data-act="dDisc" data-v="unknown" aria-pressed="${g.discs.includes("unknown")}">I don't know</button></div>
    <div class="section-title">Publication</div>
    <div class="field"><label for="d-journals">Linked journals</label><textarea id="d-journals" rows="2" data-dfield="journals" placeholder="One per line. Leave empty if you don't know">${esc(g.journals)}</textarea></div>
    ${pick("jlink","How papers reach the journal",["Special issue","Fast track","Editor workshop","Invited submission","I don't know"])}
    ${pick("proceedings","Conference proceedings",["Yes","No","I don't know"])}
    <div class="section-title">Other details</div>
    ${pick("doctoral","Doctoral colloquium or consortium",["Yes","No","I don't know"])}
    ${inp("fee","Registration fee, if known","For example, INR 6,000 or USD 150")}
    ${pick("source","Where you found this",["Official website","Call for papers PDF","Email or mailing list","Colleague","Social media"])}
    ${pick("relation","Your connection",["I'm an organiser","I plan to attend or submit","I attended before","I heard about it"])}
    <div class="field"><label for="d-notes">Anything else</label><textarea id="d-notes" rows="2" data-dfield="notes" placeholder="Themes, awards, best paper prizes">${esc(g.notes)}</textarea></div>
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:14px"><input type="checkbox" data-dcheck="contactOK" ${g.contactOK ? "checked" : ""} style="margin-top:3px"> You may email me if the editors have a question.</label>
    <button class="btn primary block" type="button" data-act="suggestSend">Send suggestion</button>
    <div class="cmeta" style="text-align:center">Missing details are fine. We'll fill them in before it goes live.</div>
    ${note("Saved to the suggestions table, “I don’t know” answers kept as unknown, so editors see what to research; status (under review, added, declined) and editor notes; duplicate check against existing conferences by name and website; notify the person when it is added; organisers who submit can be offered a verified-organiser role later.")}
  </div>`;
}
const SUG_STATUS = { under_review: ["Under review","p-muted"], added: ["Added to the app","p-open"], declined: ["Not added","p-soon"] };
function mySuggestions() {
  const list = S.suggestions || [];
  return `<div class="appbar"><button class="iconbtn" type="button" data-act="closeSub" aria-label="Back">${ICON.back}</button><h2 style="font-size:18px">My suggestions</h2></div>
  <div class="scroll">${list.length ? list.map(x => { const d2 = x.details || {}; const st = SUG_STATUS[x.status] || SUG_STATUS.under_review;
      return `<div class="card"><p class="cname">${esc(x.name)}</p><div class="cmeta">${esc([x.organiser, d2.format === "Online" ? "Online" : [d2.city, d2.country].filter(Boolean).join(", ")].filter(Boolean).join(" · "))}</div><div class="cmeta">Sent ${esc(fmtTs(x.created_at))}</div><div class="pills"><span class="pill ${st[1]}">${st[0]}</span></div>${x.editor_note ? `<div class="cmeta">Note from the editors: ${esc(x.editor_note)}</div>` : ""}</div>`; }).join("")
    : `<div class="empty">You haven't suggested a conference yet.</div>`}
    <button class="btn block" type="button" data-act="suggest">Suggest a conference</button>
  </div>`;
}
function feedbackScreen() {
  const f = S.fbDraft || (S.fbDraft = { use:"", missing:"", today:"", rating:0 });
  const pick = (k, label, opts) => `<div class="field"><span style="font-size:13px;font-weight:500">${label}</span><div class="chips">${opts.map(o => `<button class="chip" type="button" data-act="fbPick" data-k="${k}" data-v="${esc(o)}" aria-pressed="${f[k] === o}">${esc(o)}</button>`).join("")}</div></div>`;
  const past = S.myFeedback || [];
  const pts = myPoints();
  return `<div class="appbar"><button class="iconbtn" type="button" data-act="closeSub" aria-label="Back">${ICON.back}</button><h2 style="font-size:18px">Give feedback</h2></div>
  <div class="scroll">
    <div class="cmeta">This is an early preview. Your answers go straight to the team building the app. Each one earns 3 points (up to 3 a week), and 5 more if the team marks it helpful.</div>
    ${pick("use","Would you use this app?",["Yes, regularly","Sometimes","Probably not"])}
    <div class="field"><span style="font-size:13px;font-weight:500">Overall, how useful is it?</span><div class="chips">${[1,2,3,4,5].map(n => `<button class="chip" type="button" data-act="fbRate" data-v="${n}" aria-pressed="${f.rating === n}" aria-label="${n} out of 5">${"★".repeat(n)}</button>`).join("")}</div></div>
    <div class="field"><label for="fb-m">What's missing or confusing?</label><textarea id="fb-m" rows="3" data-fbfield="missing" placeholder="Screens, conferences, features">${esc(f.missing)}</textarea></div>
    <div class="field"><label for="fb-t">How do you find conferences today?</label><textarea id="fb-t" rows="2" data-fbfield="today" placeholder="WhatsApp groups, mailing lists, colleagues">${esc(f.today)}</textarea></div>
    <button class="btn primary block" type="button" data-act="fbSend">Send feedback</button>
    ${past.length ? `<div class="section-title">Your earlier feedback</div>${past.map(x => `<div class="card"><div class="cmeta">${esc(fmtTs(x.created_at))}${x.rating ? " · " + "★".repeat(x.rating) : ""}${x.would_use ? " · " + esc(x.would_use) : ""}</div>${x.missing ? `<div style="font-size:14px">${esc(x.missing)}</div>` : ""}</div>`).join("")}` : ""}
  </div>`;
}
function hostScreen() {
  const H = S.host;
  const fb = H.feedback, sg = H.suggestions;
  const who = id => { const p = H.names[id]; return p ? [p.name, p.role, p.institution].filter(Boolean).join(" · ") : "A user"; };
  let body;
  if (!fb || !sg) body = `<div class="empty">Loading…</div>`;
  else if (H.tab === "feedback") {
    const rated = fb.filter(x => x.rating); const avg = rated.length ? (rated.reduce((n, x) => n + x.rating, 0) / rated.length).toFixed(1) : "–";
    const cnt = v => fb.filter(x => x.would_use === v).length;
    body = `<div class="card"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center">
        <div><div style="font-family:var(--display);font-size:24px">${fb.length}</div><div class="cmeta">Responses</div></div>
        <div><div style="font-family:var(--display);font-size:24px">${avg}</div><div class="cmeta">Average rating</div></div>
        <div><div style="font-family:var(--display);font-size:24px">${cnt("Yes, regularly")}</div><div class="cmeta">Would use regularly</div></div></div>
        <div class="cmeta">Sometimes: ${cnt("Sometimes")} · Probably not: ${cnt("Probably not")}</div></div>
      ${fb.length ? fb.map(x => `<div class="card"><div class="cmeta">${esc(fmtTs(x.created_at))} · ${esc(who(x.user_id))}</div>
        <div class="pills">${x.rating ? `<span class="pill p-status">${"★".repeat(x.rating)}</span>` : ""}${x.would_use ? `<span class="pill p-muted">${esc(x.would_use)}</span>` : ""}<button class="chip" type="button" data-act="fbHelpful" data-id="${esc(x.id)}" aria-pressed="${!!x.helpful}" style="margin-left:auto">${x.helpful ? "Marked helpful" : "Mark helpful"}</button></div>
        ${x.missing ? `<div style="font-size:14px"><b>Missing or confusing:</b> ${esc(x.missing)}</div>` : ""}${x.how_today ? `<div style="font-size:14px"><b>Finds conferences through:</b> ${esc(x.how_today)}</div>` : ""}</div>`).join("") : `<div class="empty">No feedback yet.</div>`}`;
  } else {
    const LBL = { organiser:"Organised by", website:"Website", edition:"Edition", dateStatus:"Dates", start:"Starts", end:"Ends", approx:"Expected", deadlineStatus:"Deadline", deadline:"Deadline date", format:"Format", city:"City", country:"Country", rotates:"Venue rotates", journals:"Journals", jlink:"Journal route", proceedings:"Proceedings", doctoral:"Doctoral colloquium", fee:"Fee", source:"Found via", relation:"Connection", notes:"Notes" };
    body = sg.length ? sg.map(x => { const dd = x.details || {};
      const known = Object.entries(LBL).filter(([k]) => dd[k] && dd[k] !== "I don't know" && k !== "organiser").map(([k, l]) => `<dt>${l}</dt><dd>${esc(dd[k])}</dd>`).join("");
      const unknown = Object.entries(LBL).filter(([k]) => dd[k] === "I don't know").map(([, l]) => l);
      return `<div class="card"><p class="cname">${esc(x.name)}</p><div class="cmeta">${esc(x.organiser)} · sent ${esc(fmtTs(x.created_at))} by ${esc(who(x.user_id))}</div>
        ${known ? `<dl class="kv">${known}</dl>` : ""}${unknown.length ? `<div class="cmeta">To research: ${esc(unknown.join(", "))}</div>` : ""}
        <div class="chips">${Object.entries(SUG_STATUS).map(([k, [l]]) => `<button class="chip" type="button" data-act="sugStatus" data-id="${esc(x.id)}" data-v="${k}" aria-pressed="${x.status === k}">${l}</button>`).join("")}</div>
        <div class="field"><label for="en-${esc(x.id)}">Note to the sender</label><input id="en-${esc(x.id)}" data-enote="${esc(x.id)}" value="${esc(x.editor_note)}" placeholder="Shown on their My suggestions page"></div></div>`; }).join("") : `<div class="empty">No suggestions yet.</div>`;
  }
  return `<div class="appbar"><button class="iconbtn" type="button" data-act="closeSub" aria-label="Back">${ICON.back}</button><h2 style="font-size:18px">Host dashboard</h2><button class="btn small" type="button" data-act="hostReload">Refresh</button></div>
  <div class="scroll">
    <div class="seg"><button class="chip" type="button" data-act="hostTab" data-v="feedback" aria-pressed="${H.tab === "feedback"}">Feedback${fb ? " " + fb.length : ""}</button><button class="chip" type="button" data-act="hostTab" data-v="suggestions" aria-pressed="${H.tab === "suggestions"}">Suggestions${sg ? " " + sg.length : ""}</button></div>
    ${body}
    <div class="cmeta">Only you can see this page. Users' statuses and reminders stay private, even from you.</div>
  </div>`;
}
async function loadHost() {
  try {
    const [fb, sg] = await Promise.all([API.hostFeedback(), API.hostSuggestions()]);
    const ids = [...new Set([...fb, ...sg].map(x => x.user_id))];
    const ps = await API.hostProfiles(ids); const names = {}; ps.forEach(p => names[p.id] = p);
    S.host.feedback = fb; S.host.suggestions = sg; S.host.names = names;
  } catch (e) { console.error(e); toast("Couldn't load the dashboard."); S.host.feedback = S.host.feedback || []; S.host.suggestions = S.host.suggestions || []; }
  render();
}
// ---------- Beta leaderboard ----------
function weekKey(ts) { const x = new Date(ts); const day = (x.getDay() + 6) % 7; x.setHours(0,0,0,0); x.setDate(x.getDate() - day); return x.toISOString().slice(0,10); }
function myPoints() {
  const perWeek = {}; let reviewer = 0;
  (S.myFeedback || []).slice().sort((a,b) => String(a.created_at).localeCompare(String(b.created_at))).forEach(f => {
    const w = weekKey(f.created_at); perWeek[w] = (perWeek[w] || 0) + 1;
    if (perWeek[w] <= 3) reviewer += 3; if (f.helpful) reviewer += 5; });
  const suggester = (S.suggestions || []).reduce((n, x) => n + (x.status === "added" ? 10 : 3), 0);
  return { reviewer, suggester, founding: (S.myFeedback || []).length + (S.suggestions || []).length > 0 };
}
const SEASON = { name: "Preview season", ends: "2027-01-31" };
const BOARDS = { reviewers: { tab: "Top reviewers", star: "Star reviewer", unit: ["feedback","feedback"], key: "reviewer" },
                 suggesters: { tab: "Top contributors", star: "Star contributor", unit: ["suggestion","suggestions"], key: "suggester" } };
const initialsOf = n => (n || "?").split(/\s+/).filter(Boolean).map(w => w[0]).slice(0,2).join("").toUpperCase();
function leadersScreen() {
  const B = S.board, u = S.user, pts = myPoints(), meta = BOARDS[B.tab];
  (B.rows || []).forEach(r => { if (r.is_me) pts[BOARDS[r.board] ? BOARDS[r.board].key : "reviewer"] = r.points; }); // the server's count is authoritative
  const ranked = bt => (B.rows || []).filter(r => r.board === bt).sort((a,b) => b.points - a.points || String(a.display_name).localeCompare(String(b.display_name)));
  const list = ranked(B.tab);
  const myIdx = list.findIndex(r => r.is_me), myPts = pts[meta.key];
  const inTop3 = bt => ranked(bt).slice(0,3).some(r => r.is_me);
  const ends = new Date(SEASON.ends + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const slot = (i, h) => { const r = list[i], cls = ["gold","silver","bronze"][i];
    return `<div class="pod pod-${cls}">${i === 0 ? `<span class="crown" aria-hidden="true">${ICON.trophy}</span>` : ""}
      <div class="pod-av${r ? "" : " pod-empty"}">${r ? esc(initialsOf(r.display_name)) : "?"}</div>
      <div class="pod-name">${r ? esc(r.display_name) + (r.is_me ? " (you)" : "") : "Your name here"}</div>
      <div class="pod-step" style="height:${h}px"><b>${i + 1}</b><span>${r ? r.points + " pts" : "—"}</span></div></div>`; };
  const podium = B.rows ? `<div class="podium">${slot(1, 56)}${slot(0, 78)}${slot(2, 42)}</div>` : `<div class="empty">Loading…</div>`;
  let you;
  if (!u.lbOptIn) you = `<div class="you-card"><div class="grow"><b>You have ${myPts} points</b><div class="cmeta">You're not shown on the board yet.</div></div><button class="btn small" type="button" data-act="lbOpt">Show me</button></div>`;
  else if (myIdx < 0) you = `<div class="you-card"><div class="grow"><b>You</b><div class="cmeta">${B.rows ? "Earn your first points to join this board." : "Loading…"}</div></div><b>${myPts} pts</b></div>`;
  else { const above = list[myIdx - 1], gap = above ? above.points - list[myIdx].points + 1 : 0;
    const target = above ? Math.max(0, Math.min(100, Math.round(100 * list[myIdx].points / (above.points + 1)))) : 100;
    you = `<div class="you-card"><b class="you-rank">${myIdx + 1}</b><div class="grow"><b>You</b><div class="cmeta">${above ? `${gap} point${gap === 1 ? "" : "s"} to reach #${myIdx}` : "Top of the board. Well done."}</div><div class="bar"><span style="width:${target}%"></span></div></div><b>${list[myIdx].points} pts</b></div>`; }
  const rest = list.slice(3).map((r, k) => `<div class="lb-row${r.is_me ? " me" : ""}"><span>${k + 4}</span><span class="grow">${esc(r.display_name)}${r.is_me ? " (you)" : ""}<span class="cmeta"> · ${r.items} ${meta.unit[r.items === 1 ? 0 : 1]}</span></span><b>${r.points}</b></div>`).join("");
  const badge = (on, label) => `<span class="badge-chip${on ? " on" : ""}">${label}${on ? "" : `<span class="sr-only"> (not earned yet)</span>`}</span>`;
  const fbCount = (S.myFeedback || []).length;
  return `<div class="appbar"><div style="flex:1"><h2>Leaders</h2><div class="cmeta">${SEASON.name} · ends ${esc(ends)}</div></div></div>
  <div class="scroll">
    <div class="seg seg-full">${Object.entries(BOARDS).map(([k, m]) => `<button class="chip" type="button" data-act="boardTab" data-v="${k}" aria-pressed="${B.tab === k}">${m.tab}</button>`).join("")}</div>
    ${podium}
    ${you}
    ${rest ? `<div class="lb-list">${rest}</div>` : ""}
    <div class="section-title">Earn points</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn" type="button" data-act="fbForm">Give feedback${fbCount ? ` (${fbCount})` : ""}</button>
      <button class="btn" type="button" data-act="suggest">Suggest a conference</button>
    </div>
    <div class="section-title">Your badges</div>
    <div class="badges">${badge(pts.founding, "Founding tester")}${badge(u.lbOptIn && inTop3("reviewers"), "Star reviewer")}${badge(u.lbOptIn && inTop3("suggesters"), "Star contributor")}</div>
    <div class="card">
      <div class="toggle-row"><div><b>Show me on the board</b><div class="cmeta">Only the name below is shown. Nothing else about you.</div></div><button class="switch" type="button" role="switch" aria-checked="${!!u.lbOptIn}" data-act="lbOpt" aria-label="Show me on the board"></button></div>
      ${u.lbOptIn ? `<div class="field"><label for="lb-name">Name to show</label><input id="lb-name" data-ufield="lbName" value="${esc(u.lbName || defaultLbName())}" maxlength="40"></div>` : ""}
    </div>
    <details class="card"><summary style="cursor:pointer;font-weight:600;font-size:14px">How points work</summary>
      <div class="cmeta" style="color:var(--ink)">Top reviewers: 3 points for each piece of feedback (up to 3 a week), plus 5 when the team marks it helpful. Top contributors: 3 points for each conference you suggest, 10 once it's added to the app. The top three on each board earn the Star reviewer or Star contributor badge. Everyone who contributes during the ${SEASON.name.toLowerCase()} is a Founding tester.</div></details>
  </div>`;
}
const defaultLbName = () => { const p = (S.user.name || "").trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : (p[0] || "Scholar"); };
async function loadBoard() {
  try { S.board.rows = await API.leaderboard(); } catch (e) { console.error(e); S.board.rows = []; toast("Couldn't load the leaderboard."); }
  render();
}
// Install prompt (Android/Chrome); iPhone uses Share > Add to Home Screen
const INSTALL = { prompt: null };
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); INSTALL.prompt = e; render(); });
window.addEventListener("appinstalled", () => { INSTALL.prompt = null; toast("Installed. Open it from your home screen."); });
function closeModal() { if (!S.modal) return false; S.modal = null; render(); return true; }
function closeModalByUser() { if (!S.modal) return; S.modal = null; popNav(); render(); }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModalByUser(); });
document.addEventListener("click", e => { if (e.target.dataset && e.target.dataset.backdrop) { e.stopPropagation(); closeModalByUser(); } }, true);
// The phone's back button closes a panel or returns from a detail screen instead of leaving the app
window.addEventListener("popstate", () => {
  if (S.skipPop) { S.skipPop = false; return; }
  if (closeModal()) return;
  if (S.sub || S.detail) { S.sub = null; S.detail = null; render(); if (S.tab === "leaders") loadBoard(); }
});
function pushNav(tag) { try { history.pushState({ nav: tag }, ""); } catch (e) {} }
function openModal(name) { S.modal = name; pushNav("modal"); }
function popNav() { try { if (history.state && history.state.nav) { S.skipPop = true; history.back(); } } catch (e) {} }

function profile() {
  const u = S.user;
  const lbl = (list, keys) => keys.map(k => (list.find(x => x[0] === k) || [k,k])[1]).join(", ");
  return `<div class="appbar"><h2>Profile</h2></div>
  <div class="scroll">
    <div class="card"><p class="cname">${esc(u.name || "Name not set")}</p><div class="cmeta">${esc([u.role, u.institution, u.country].filter(Boolean).join(" · "))}</div><div class="cmeta">${esc(u.email)}</div><button class="btn small" type="button" data-act="editProfile" style="justify-self:start">Edit profile</button></div>
    <div class="card" style="border-left:4px solid ${API.mode === "live" ? "var(--open)" : "var(--soon)"}"><b>${API.mode === "live" ? "Saved to your account" : "Demo mode"}</b><span class="cmeta">${API.mode === "live" ? "Your profile, lists and history are available on any phone or laptop where you sign in." : "Not connected to the database yet. Your data is kept in this browser."}</span></div>
    ${S.isAdmin ? `<button class="btn primary block" type="button" data-act="host">Host dashboard: feedback and suggestions</button>` : ""}
    <div class="section-title">Your preferences</div>
    <div class="card">${prefSummary(u)}<button class="btn small" type="button" data-act="editPrefs">Edit preferences</button></div>
    <div class="section-title">Reminders</div>
    <div class="card">
      <div class="toggle-row"><div><b>In-app reminders</b><div class="cmeta">Shown in the Reminders tab and on Home</div></div><button class="switch" type="button" role="switch" aria-checked="${u.inapp}" data-act="inapp" aria-label="In-app reminders"></button></div>
      <div class="toggle-row"><div><b>Notifications on this device</b><div class="cmeta">${u.system ? "Allowed" : "Off"}</div></div><button class="switch" type="button" role="switch" aria-checked="${u.system}" data-act="system" aria-label="Device notifications"></button></div>
    </div>
    <div class="section-title">More</div>
    <button class="btn block" type="button" data-act="howTiers">How tiers work</button>
    <button class="btn block" type="button" data-act="suggest">Suggest a conference</button>
    <button class="btn block" type="button" data-act="mySug">My suggestions${(S.suggestions || []).length ? ` (${S.suggestions.length})` : ""}</button>
    <button class="btn block" type="button" data-act="copyCV">Copy attended list for my CV</button>
    <button class="btn block" type="button" data-act="privacy">Privacy and your data</button>
    <button class="btn block" type="button" data-act="board">Leaders and your badges</button>
    <button class="btn block" type="button" data-act="install">${INSTALL.prompt ? "Install the app" : "Add to home screen"}</button>
    ${S.isAdmin ? `<button class="btn block" type="button" data-act="notes">${S.showNotes ? "Hide" : "Show"} notes for the build team</button>` : ""}
    <button class="btn block" type="button" data-act="signout">Sign out</button>
    ${note("Settings and consent records; data export; account deletion (required under India's data protection law). Personal data is stored per account, separately from the conference database, so conference updates never touch it.")}
  </div>`;
}

function tabbar() {
  const t = (k, label, icon) => `<button type="button" data-act="tab" data-v="${k}" aria-current="${S.tab === k ? "page" : "false"}">${icon}${label}</button>`;
  return `<nav class="tabbar" aria-label="Main">${t("home","Home",ICON.home)}${t("discover","Discover",ICON.discover)}${t("mine","My list",ICON.mine)}${t("leaders","Leaders",ICON.trophy)}${t("profile","Profile",ICON.profile)}</nav>`;
}
function modal() {
  if (S.modal === "filters") return filterSheet();
  if (S.modal === "tiers") return `<div class="modal-back" data-backdrop="1"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mh"><h3 id="mh">How tiers work</h3>
    <p>No official body ranks management conferences, unlike computer science, where bodies such as CORE rank conferences directly. Here each conference gets a score:</p>
    <p><b>60%</b> from the best ABDC rank among the journals it publishes into (A* = 4 down to C = 1; an editor workshop counts one grade lower; proceedings or no journal count as 1).<br><b>40%</b> from its host: premier international associations 5, ISB and NIRF top 10 4, NIRF 11–20 3, NIRF 21–30 2, others 1.</p>
    <p>Score 4.0+ is A*, 3.2+ is A, 2.2+ is B, 1.4+ is C, below that Unrated. Each conference page shows its own working.</p>
    <div class="row"><button class="btn primary" type="button" data-act="closeModal">Close</button></div></div></div>`;
  if (S.modal === "install") return `<div class="modal-back" data-backdrop="1"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mh"><h3 id="mh">Keep it on your home screen</h3>
    <p><b>iPhone (Safari):</b> tap the Share button, then “Add to Home Screen”.</p>
    <p><b>Android (Chrome):</b> tap the ⋮ menu, then “Add to Home screen”.</p>
    <p>It then opens from an icon, like an app.</p>
    <div class="row"><button class="btn primary" type="button" data-act="closeModal">Done</button></div></div></div>`;
  if (S.modal === "privacy") return `<div class="modal-back" data-backdrop="1"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mh"><h3 id="mh">Privacy and your data</h3>
    <p>We keep your profile, preferences and conference list only to run the app for you. We never sell or share it.</p>
    <div class="row" style="justify-content:stretch;flex-direction:column"><button class="btn" type="button" data-act="exportData">Download my data</button><button class="btn" type="button" data-act="askDelete">Delete my data</button><button class="btn primary" type="button" data-act="closeModal">Close</button></div></div></div>`;
  if (S.modal === "confirmDelete") return `<div class="modal-back" data-backdrop="1"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mh"><h3 id="mh">Delete your data?</h3>
    <p>This removes your profile, statuses, reminders and history from the app, and signs you out. It can't be undone.</p>
    <div class="row"><button class="btn" type="button" data-act="closeModal">Cancel</button><button class="btn primary" type="button" data-act="doDelete">Delete</button></div></div></div>`;
  if (S.modal !== "perm") return "";
  return `<div class="modal-back" data-backdrop="1"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mh"><h3 id="mh">Allow notifications?</h3>
    <p>Conference Tracker would like to send you reminders about deadlines and conferences on your list.</p>
    <p style="font-size:12.5px">Your device will ask you to confirm. Reminder notifications start once the reminder service is switched on.</p>
    <div class="row"><button class="btn" type="button" data-act="permDeny">Don't allow</button><button class="btn primary" type="button" data-act="permAllow">Allow</button></div></div></div>`;
}

function render() {
  const app = document.getElementById("app");
  let html;
  if (S.screen === "welcome") html = welcome();
  else if (S.screen === "onboard") html = onboarding();
  else if (S.screen === "done") html = doneScreen();
  else {
    const c = S.detail && byId(S.detail);
    html = (S.sub === "fbForm" ? feedbackScreen() : S.sub === "host" ? hostScreen() : S.sub === "suggest" ? suggestForm() : S.sub === "mySug" ? mySuggestions() : c ? detail(c)
      : S.tab === "mine" ? mine() : S.tab === "reminders" ? remindersScreen() : S.tab === "profile" ? profile() : S.tab === "leaders" ? leadersScreen() : S.tab === "discover" ? discover() : home()) + tabbar();
  }
  app.innerHTML = html + modal();
  save();
}
function scrollTop() { const s = document.querySelector(".scroll"); if (s) s.scrollTop = 0; }
function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600); }
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id, v = b.dataset.v;
  const u = S.user;
  switch (a) {
    case "signin": {
      try {
        if (v === "google") { const r = await API.signInGoogle(); if (r.redirect) { S.busy = true; render(); } return; }
        const em = document.getElementById("em"); const email = ((em && em.value) || "").trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) { toast("Enter a valid email address."); return; }
        const r = await API.signInEmail(email); if (r.sent) S.emailSent = email;
      } catch (err) { console.error(err); toast("Sign-in didn't work. Please try again."); return; }
      break;
    }
    case "emailAgain": S.emailSent = null; break;
    case "obNext":
      if (S.obStep === 1 && !u.name.trim()) { toast("Please add your name."); return; }
      if (S.obStep === 2 && !u.discs.length) { toast("Choose at least one discipline."); return; }
      if (S.obStep === 3 && (!u.regions.length || !u.tiers.length)) { toast("Choose at least one region and one tier."); return; }
      S.obStep++; render(); scrollTop(); return;
    case "obBack": S.obStep = Math.max(1, S.obStep - 1); break;
    case "toggleDisc": { if (u.discs.includes(v)) { u.discs = u.discs.filter(x => x !== v); u.specs = u.specs.filter(f => f.slice(0, 4) !== v); } else u.discs = [...u.discs, v]; break; }
    case "toggleSpec": u.specs = u.specs.includes(v) ? u.specs.filter(x => x !== v) : [...u.specs, v]; break;
    case "toggleRegion": {
      if (u.regions.includes(v)) { u.regions = u.regions.filter(x => x !== v); u.countries = (u.countries || []).filter(c => REGION_OF[c] !== v); }
      else u.regions = [...u.regions, v];
      break;
    }
    case "toggleCountry": { const cs = u.countries || []; u.countries = cs.includes(v) ? cs.filter(x => x !== v) : [...cs, v]; const r = REGION_OF[v]; if (r && !u.regions.includes(r)) u.regions = [...u.regions, r]; break; }
    case "allCountries": u.countries = (u.countries || []).filter(c => REGION_OF[c] !== v); break;
    case "toggleTier": u.tiers = u.tiers.includes(v) ? u.tiers.filter(x => x !== v) : [...u.tiers, v]; break;
    case "savePrefs": if (!u.consent) return; u.onboarded = true; u.consentAt = u.consentAt || new Date().toISOString(); S.screen = "done"; break;
    case "goHome": S.screen = "app"; S.tab = "home"; S.detail = null; break;
    case "editPrefs": S.screen = "onboard"; S.obStep = 2; S.detail = null; S.sub = null; break;
    case "editProfile": S.screen = "onboard"; S.obStep = 1; break;
    case "mineGo": S.tab = "mine"; S.mineTab = v; S.detail = null; break;
    case "howTiers": openModal("tiers"); break;
    case "install": {
      if (INSTALL.prompt) { const pr = INSTALL.prompt; INSTALL.prompt = null; try { pr.prompt(); await pr.userChoice; } catch (err) {} render(); return; }
      openModal("install"); break;
    }
    case "board": S.tab = "leaders"; S.detail = null; S.sub = null; S.modal = null; S.board.rows = null; render(); scrollTop(); loadBoard(); return;
    case "fbForm": pushNav("sub"); S.sub = "fbForm"; render(); scrollTop(); return;
    case "boardTab": S.board.tab = v; break;
    case "lbOpt": u.lbOptIn = !u.lbOptIn; if (u.lbOptIn && !u.lbName) u.lbName = defaultLbName(); clearTimeout(SYNC.timer); await runSync(); S.board.rows = null; render(); loadBoard(); return;
    case "fbHelpful": {
      const x = (S.host.feedback || []).find(r => String(r.id) === id); if (!x) return;
      try { await API.setFeedbackHelpful(x.id, !x.helpful); x.helpful = !x.helpful; const mine = (S.myFeedback || []).find(r => String(r.id) === id); if (mine) mine.helpful = x.helpful; toast(x.helpful ? "Marked helpful: 5 points to the sender" : "Unmarked"); } catch (err) { console.error(err); toast("Couldn't update it."); return; }
      break;
    }
    case "fbPick": S.fbDraft[b.dataset.k] = v; break;
    case "fbRate": S.fbDraft.rating = Number(v); break;
    case "fbSend": {
      const f = S.fbDraft || {};
      if (!f.use && !f.rating && !(f.missing || "").trim() && !(f.today || "").trim()) { toast("Answer at least one question first."); return; }
      try { const row = await API.addFeedback(S.session.id, f); S.myFeedback = [row, ...(S.myFeedback || [])]; S.fbDraft = null; toast("Thank you. Your feedback has been sent."); }
      catch (err) { console.error(err); toast("Couldn't send it. Please try again."); return; }
      break;
    }
    case "host": pushNav("sub"); S.sub = "host"; S.host.feedback = null; S.host.suggestions = null; render(); loadHost(); return;
    case "hostTab": S.host.tab = v; break;
    case "hostReload": S.host.feedback = null; S.host.suggestions = null; render(); loadHost(); return;
    case "sugStatus": {
      const x = (S.host.suggestions || []).find(r => String(r.id) === id); if (!x) return;
      try { await API.updateSuggestion(x.id, { status: v }); x.status = v; toast("Status updated"); } catch (err) { console.error(err); toast("Couldn't update it."); return; }
      break;
    }
    case "suggest": pushNav("sub"); S.sub = "suggest"; S.draft = S.draft || BLANK_DRAFT(); render(); scrollTop(); return;
    case "mySug": if (S.sub !== "mySug") pushNav("sub"); S.sub = "mySug"; break;
    case "closeSub": S.sub = null; popNav(); if (S.tab === "leaders") { render(); loadBoard(); return; } break;
    case "dpick": S.draft[b.dataset.k] = v; break;
    case "dDisc": { const g = S.draft; if (v === "unknown") g.discs = g.discs.includes("unknown") ? [] : ["unknown"]; else { g.discs = g.discs.filter(x => x !== "unknown"); g.discs = g.discs.includes(v) ? g.discs.filter(x => x !== v) : [...g.discs, v]; } break; }
    case "privacy": openModal("privacy"); break;
    case "closeModal": S.modal = null; popNav(); break;
    case "suggestSend": {
      const g = S.draft;
      if (!g.name.trim() || !g.organiser.trim()) { toast("Add the conference name and who organises it."); return; }
      const details = { ...g }; delete details.name;
      try { const row = await API.addSuggestion(S.session.id, g.name.trim(), g.organiser.trim(), details); S.suggestions = [row, ...(S.suggestions || [])]; }
      catch (err) { console.error(err); toast("Couldn't send it. Please try again."); return; }
      S.draft = null; S.sub = "mySug"; toast("Thank you. Our editors will review it."); break;
    }
    case "exportData": {
      const blob = new Blob([JSON.stringify({ profile: S.user, conferences: S.marks, suggestions: S.suggestions, feedback: S.myFeedback }, null, 2)], { type: "application/json" });
      const a2 = document.createElement("a"); a2.href = URL.createObjectURL(blob); a2.download = "my-conference-tracker-data.json"; document.body.appendChild(a2); a2.click(); a2.remove();
      return;
    }
    case "askDelete": S.modal = "confirmDelete"; break;
    case "doDelete": {
      try { await API.deleteMyData(S.session.id); } catch (err) { console.error(err); toast("Couldn't delete your data. Please try again."); return; }
      S.session = null; S.user = NEW_USER(""); S.marks = {}; S.suggestions = []; S.myFeedback = []; S.isAdmin = false; S.modal = null; S.screen = "welcome"; snapshotSynced();
      toast("Your data has been deleted."); break;
    }
    case "inapp": u.inapp = !u.inapp; break;
    case "system": if (u.system) u.system = false; else S.modal = "perm"; break;
    case "permAllow": {
      S.modal = null;
      try { const p = window.Notification ? await Notification.requestPermission() : "denied"; u.system = p === "granted"; toast(u.system ? "Notifications allowed" : "Notifications weren't allowed on this device."); }
      catch (err) { u.system = false; }
      break;
    }
    case "permDeny": u.system = false; S.modal = null; break;
    case "tab": S.tab = v; S.detail = null; S.sub = null; S.modal = null; if (v === "leaders") S.board.rows = null; render(); scrollTop(); if (v === "leaders") loadBoard(); return;
    case "open": S.detail = id; S.modal = null; pushNav("detail"); render(); scrollTop(); return;
    case "back": S.detail = null; popNav(); break;
    case "setStatus": {
      const m = mark(id); const was = m.status;
      m.status = was === v ? undefined : v; m.changed = TODAY_ISO;
      toast(m.status ? `Marked: ${ST[v].label}` : "Status cleared");
      if (m.status === "hidden") { S.detail = null; }
      break;
    }
    case "unhide": { mark(id).status = undefined; toast("Back in your lists"); break; }
    case "mineTab": S.mineTab = v; break;
    case "openFilters": S.fDraft = { ...blankF(), ...JSON.parse(JSON.stringify(S.f || blankF())) }; openModal("filters"); break;
    case "fToggle": { const a2 = S.fDraft[b.dataset.k]; S.fDraft[b.dataset.k] = a2.includes(v) ? a2.filter(x => x !== v) : [...a2, v]; break; }
    case "fReset": S.fDraft = blankF(); break;
    case "applyFilters": S.f = S.fDraft; S.modal = null; popNav(); break;
    case "quick": case "unfilter": { const k = b.dataset.k; S.f[k] = S.f[k].includes(v) ? S.f[k].filter(x => x !== v) : [...S.f[k], v]; break; }
    case "clearFilters": S.f = blankF(); break;
    case "notes": S.showNotes = !S.showNotes; break;
    case "signout": {
      clearTimeout(SYNC.timer); await runSync();
      await API.signOut(); S.session = null; S.user = NEW_USER(""); S.marks = {}; S.suggestions = []; S.myFeedback = []; S.isAdmin = false;
      S.screen = "welcome"; S.detail = null; S.sub = null; S.tab = "home"; snapshotSynced(); toast("Signed out"); break;
    }
    case "copyCV": {
      const list = REAL.filter(c => S.marks[c.id] && S.marks[c.id].status === "attended");
      if (!list.length) { toast("Mark a conference as Attended first."); return; }
      const text = list.map(c => { const m = S.marks[c.id]; return `${m.role || "Participant"}${m.paperTitle ? `, “${m.paperTitle}”` : ""}. ${c.name}, ${c.host}, ${c.city}, ${whenText(c)}.`; }).join("\n");
      try { await navigator.clipboard.writeText(text); toast("Copied for your CV"); } catch (err) { toast("Copying isn't allowed here."); }
      return;
    }
    default: return;
  }
  render();
});
document.addEventListener("input", e => {
  if (e.target.id === "q") { S.q = e.target.value; document.getElementById("dlist").innerHTML = discoverList(); save(); return; }
  const f = e.target.dataset && e.target.dataset.field;
  if (f && S.detail) { mark(S.detail)[f] = e.target.value; save(); }
  const fbf = e.target.dataset && e.target.dataset.fbfield;
  if (fbf && S.fbDraft) { S.fbDraft[fbf] = e.target.value; save(); return; }
  const df = e.target.dataset && e.target.dataset.dfield;
  if (df && S.draft) { S.draft[df] = e.target.value; save(); return; }
  const en = e.target.dataset && e.target.dataset.enote;
  if (en) { clearTimeout(INPUTS_T); const val = e.target.value; INPUTS_T = setTimeout(async () => { const x = (S.host.suggestions || []).find(r => String(r.id) === en); if (!x) return; try { await API.updateSuggestion(x.id, { editor_note: val || null }); x.editor_note = val; } catch (err) { toast("Couldn't save the note."); } }, 700); return; }
  const uf = e.target.dataset && e.target.dataset.ufield;
  if (uf && uf !== "consent") { S.user[uf] = e.target.value; save(); }
});
document.addEventListener("change", e => {
  if (e.target.id === "sortSel") { S.sort = e.target.value; document.getElementById("dlist").innerHTML = discoverList(); save(); return; }
  if (e.target.dataset && e.target.dataset.dcheck && S.draft) { S.draft[e.target.dataset.dcheck] = e.target.checked; save(); return; }
  if (e.target.dataset && e.target.dataset.ufield === "consent") { S.user.consent = e.target.checked; render(); return; }
  const f = e.target.dataset && e.target.dataset.field;
  if (f && S.detail) { mark(S.detail)[f] = e.target.value; save(); }
});

render();
API.onAuth(sess => { if (sess && (!S.session || S.session.id !== sess.id)) enterAs(sess); });
API.getSession().then(sess => { if (sess) enterAs(sess); });
}
boot();
