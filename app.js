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
    override: r.override || null, placeholder: !!r.placeholder });
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
  { k:"considering", label:"Under consideration", short:"Considering", next:"Added to your list. Reminder 30 days before the deadline." },
  { k:"planning",    label:"Planning to submit",  short:"Planning",    next:"Reminders 30, 7 and 1 day before the deadline." },
  { k:"submitted",   label:"Submitted",           short:"Submitted",   next:"Add your paper title and the decision date for a reminder." },
  { k:"accepted",    label:"Accepted",            short:"Accepted",    next:"Add the registration deadline; we remind you a week before." },
  { k:"registered",  label:"Registered",          short:"Registered",  next:"Travel and visa reminder a month ahead, and one week before." },
  { k:"attended",    label:"Attended",            short:"Attended",    next:"Moves to your history. Add your role and paper for your CV." },
  { k:"hidden",      label:"Not interested",      short:"Hidden",      next:"Hidden from your lists. You can bring it back from My conferences." }
];
const ST = Object.fromEntries(STATUSES.map(s => [s.k, s]));
const REAL = DATA.filter(c => !c.placeholder);
const ALL_AREAS = [...new Set(REAL.flatMap(c => c.areas))].sort();
const ROLES = ["Paper presenter", "Symposium or panel", "Doctoral consortium", "Session chair or discussant", "Attendee"];

// Disciplines follow the ABDC subject fields; specialisations follow AOM's 26 divisions and interest groups.
const DISCIPLINES = [
  ["mgmt","Management, strategy & organisations"],["hr","Human resources & industrial relations"],["mkt","Marketing"],
  ["fin","Finance & banking"],["acc","Accounting"],["econ","Economics"],["is","Information systems"],
  ["ops","Operations & supply chain"],["tour","Tourism & hospitality"],["law","Business law & taxation"]
];
const SPECS = [
  ["CAR","Careers"],["CTO","Communication, digital technology & organisation"],["CM","Conflict management"],["CMS","Critical management studies"],
  ["ENT","Entrepreneurship"],["GDO","Gender, race & diversity in organisations"],["HCM","Health care management"],["HR","Human resources"],
  ["IM","International management"],["MC","Management consulting"],["MED","Management education & development"],["MH","Management history"],
  ["MOC","Managerial & organisational cognition"],["MSR","Management, spirituality & religion"],["NEU","Organisational neuroscience"],
  ["OB","Organisational behaviour"],["ODC","Organisation development & change"],["OMT","Organisation & management theory"],
  ["ONE","Organisations & the natural environment"],["OSCM","Operations & supply chain management"],["PNP","Public & non-profit"],
  ["RM","Research methods"],["SAP","Strategising, activities & practices"],["SIM","Social issues in management"],
  ["STR","Strategic management"],["TIM","Technology & innovation management"]
];
const REGIONS = ["India","Asia-Pacific","Europe","North America","Latin America","Middle East & Africa","Online"];
const CONT = { aom27:"Europe", euram27:"Europe", egos27:"Europe", bcerc27:"Europe", bam27:"Europe" };
const AREA_MAP = {
  "General management": { d:["mgmt"], s:[] }, "Entrepreneurship": { d:["mgmt"], s:["ENT"] }, "Strategy": { d:["mgmt"], s:["STR","SAP"] },
  "OB & HR": { d:["mgmt","hr"], s:["OB","HR"] }, "Organization theory": { d:["mgmt"], s:["OMT"] }, "International business": { d:["mgmt"], s:["IM"] },
  "Public & non-profit": { d:["mgmt"], s:["PNP"] }, "Sustainability": { d:["mgmt"], s:["ONE","SIM"] }, "Finance": { d:["fin","acc"], s:[] },
  "Marketing": { d:["mkt"], s:[] }, "Information systems": { d:["is"], s:["CTO","TIM"] }, "Operations": { d:["ops"], s:["OSCM"] }, "Doctoral": { d:[], s:[] }
};
DATA.forEach(c => {
  c.continent = c.continent || (c.region === "India" ? "India" : (CONT[c.id] || "Varies"));
  c.disc = [...new Set(c.areas.flatMap(a => (AREA_MAP[a] || {d:[]}).d))];
  c.spec = [...new Set(c.areas.flatMap(a => (AREA_MAP[a] || {s:[]}).s))];
});
function matchesUser(c) {
  const u = S.user;
  const disc = c.disc.filter(x => u.discs.includes(x));
  if (!disc.length) return false;
  if (u.specs.length && c.spec.length && !c.spec.some(x => u.specs.includes(x)) && !c.areas.includes("General management")) return false;
  const regionOK = u.regions.includes(c.continent) || (c.continent === "Varies" && u.regions.some(r => r !== "India"));
  if (!regionOK) return false;
  return u.tiers.includes(c._tier === "General" ? "Unrated" : c._tier);
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

ICON.fb = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>';
ICON.bell2 = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>';
let INPUTS_T = null;

// ---------- State (in memory; saved to the database through API) ----------
const NEW_USER = (email, name) => ({ name: name || "", email, title: "", institution: "", role: "", country: "", discs: ["mgmt"], specs: [], ownTopic: "", regions: ["India"], tiers: ["A*","A","B"], inapp: true, system: false, consent: false, onboarded: false });
const S = { screen: "welcome", tab: "home", detail: null, sub: null, mineTab: "planning", q: "", f: null, sort: "deadline", showNotes: false, modal: null,
  obStep: 1, user: NEW_USER(""), marks: {}, suggestions: [], myFeedback: [], session: null, isAdmin: false, emailSent: null, busy: false,
  host: { tab: "feedback", feedback: null, suggestions: null, names: {} } };
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
const bellBtn = id => { const on = !!(S.marks[id] && S.marks[id].bell); return `<button class="bell" type="button" data-act="bell" data-id="${id}" aria-pressed="${on}" aria-label="${on ? "Turn off reminder" : "Remind me"}" title="${on ? "Reminder on" : "Remind me"}">${ICON.bell}</button>`; };
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
      ${bellBtn(c.id)}
    </div>
    <div class="pills">${deadlinePill(c)}${statusPill(c.id)}<button class="btn small" type="button" data-act="open" data-id="${c.id}" style="margin-left:auto">${S.marks[c.id] && S.marks[c.id].status ? "Change status" : "Set status"}</button></div>
  </div>`;
}

// ---------- Reminders ----------
function reminders() {
  const out = [];
  REAL.forEach(c => {
    const m = S.marks[c.id]; if (!m) return;
    const add = (date, text, target) => out.push({ c, date, text, target });
    const dl = c.deadline, st = c.start;
    if (m.bell) {
      if (dl) add(addDays(dl, -7), "Submission deadline in 7 days", dl);
      if (st) add(addDays(st, -7), "Conference starts in a week", st);
      if (!dl && !st) add(null, "You'll be reminded when dates are announced", null);
    }
    switch (m.status) {
      case "considering":
        if (dl) add(addDays(dl, -30), "Decide whether to submit: deadline in 30 days", dl);
        else if (!st) add(null, "Deadline not announced yet", null);
        break;
      case "planning":
        if (dl) [30, 7, 1].forEach(n => add(addDays(dl, -n), `Submission deadline in ${n === 1 ? "1 day" : n + " days"}`, dl));
        else add(null, "Deadline not announced yet", null);
        break;
      case "submitted":
        if (m.decisionDate) add(m.decisionDate, "Decision expected", m.decisionDate);
        else add(null, "Add the decision date to get a reminder", null);
        break;
      case "accepted":
        if (m.regDeadline) { add(addDays(m.regDeadline, -7), "Registration closes in 7 days", m.regDeadline); add(m.regDeadline, "Registration closes today", m.regDeadline); }
        else add(null, "Add the registration deadline to get a reminder", null);
        break;
      case "registered":
        if (st) { add(addDays(st, -30), "Check travel and visa: conference in 30 days", st); add(addDays(st, -7), "Conference starts in a week", st); }
        break;
    }
  });
  const live = out.filter(r => !r.target || r.target >= TODAY_ISO);
  const seen = new Set();
  const uniq = live.filter(r => { const k = r.c.id + r.date + r.text; if (seen.has(k)) return false; seen.add(k); return true; });
  const week = addDays(TODAY_ISO, 7);
  return {
    due: uniq.filter(r => r.date && r.date <= TODAY_ISO).sort((a,b) => a.target.localeCompare(b.target)),
    week: uniq.filter(r => r.date && r.date > TODAY_ISO && r.date <= week).sort((a,b) => a.date.localeCompare(b.date)),
    later: uniq.filter(r => r.date && r.date > week).sort((a,b) => a.date.localeCompare(b.date)),
    wait: uniq.filter(r => !r.date)
  };
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
  </div>`;
}
function chipRow(list, selected, act) {
  return `<div class="chips">${list.map(([k, label]) => `<button class="chip" type="button" data-act="${act}" data-v="${esc(k)}" aria-pressed="${selected.includes(k)}">${esc(label)}</button>`).join("")}</div>`;
}
function tierInfo() {
  return `<div class="card" style="background:var(--accent-soft);border-color:transparent"><div class="cmeta" style="color:var(--ink)"><b>About these tiers.</b> No official body ranks management conferences. The tiers here are worked out from the ABDC rank of the journals a conference publishes into and the standing of its host. <button type="button" data-act="howTiers" style="background:none;border:0;padding:0;color:var(--accent);text-decoration:underline">How tiers work</button></div></div>`;
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
    const showSpecs = u.discs.includes("mgmt") || u.discs.includes("hr");
    body = `<div><p class="cname" style="margin-bottom:6px">Your disciplines</p><div class="cmeta" style="margin-bottom:8px">Based on the ABDC subject fields. Choose all that apply.</div>${chipRow(DISCIPLINES, u.discs, "toggleDisc")}</div>
      ${showSpecs ? `<div><p class="cname" style="margin-bottom:6px">Your specialisations <span class="cmeta">(optional)</span></p><div class="cmeta" style="margin-bottom:8px">Based on the Academy of Management's 26 divisions and interest groups. Leave empty to see everything in management.</div>${chipRow(SPECS, u.specs, "toggleSpec")}</div>` : ""}
      <div class="field"><label for="u-topic">Your research topic, in your words <span class="cmeta">(optional)</span></label><input id="u-topic" data-ufield="ownTopic" value="${esc(u.ownTopic)}" placeholder="For example, social entrepreneurship"></div>
      ${note("Store disciplines and specialisations as tags; tag every conference the same way so feeds can match. Free-text topics help us spot missing areas.")}`;
    btn = `<button class="btn primary block" type="button" data-act="obNext">Next</button>`;
  } else if (step === 3) {
    body = `<div><p class="cname" style="margin-bottom:6px">Where would you present?</p>${chipRow(REGIONS.map(r => [r, r]), u.regions, "toggleRegion")}<div class="cmeta" style="margin-top:6px">Right now the app lists conferences in India and the major international meetings. More countries are being added.</div></div>
      <div><p class="cname" style="margin-bottom:6px">Which tiers should we recommend?</p>${chipRow([["A*","A*"],["A","A"],["B","B"],["C","C"],["Unrated","Unrated"]], u.tiers, "toggleTier")}<div class="cmeta" style="margin-top:6px">This only shapes your recommendations. You can still browse every conference.</div></div>
      ${tierInfo()}
      ${note("Store region and tier preferences; tag each conference with its region.")}`;
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
    <div class="card"><dl class="kv">
      <dt>Disciplines</dt><dd>${esc(u.discs.map(k => DISCIPLINES.find(x => x[0] === k)[1]).join(", ") || "None chosen")}</dd>
      <dt>Focus</dt><dd>${esc(u.specs.map(k => SPECS.find(x => x[0] === k)[1]).join(", ") || "All of management")}</dd>
      <dt>Regions</dt><dd>${esc(u.regions.join(", "))}</dd>
      <dt>Tiers</dt><dd>${esc(u.tiers.join(", "))}</dd>
    </dl></div>
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
    ${S.user.inapp && r.due.length ? r.due.map(x => remItem(x, "due")).join("") : `<div class="card"><div class="cmeta">Nothing due right now.</div></div>`}
    <div class="section-title">Deadlines in the next 90 days for you</div>
    ${soon.length ? soon.map(card).join("") : `<div class="card"><div class="cmeta">No matching deadlines in the next 90 days.</div></div>`}
    <button class="card tap" type="button" data-act="tab" data-v="feedback" style="border-left:4px solid var(--accent)"><b>You're using an early preview</b><span class="cmeta">Tell us what works and what's missing. It takes a minute.</span></button>
    <div class="section-title">Quick actions</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn" type="button" data-act="tab" data-v="discover">Browse all conferences</button>
      <button class="btn" type="button" data-act="tab" data-v="reminders">See all reminders</button>
      <button class="btn" type="button" data-act="suggest">Suggest a conference</button>
      <button class="btn" type="button" data-act="howTiers">How tiers work</button>
      <button class="btn" type="button" data-act="install">Add to home screen</button>
      <button class="btn" type="button" data-act="tab" data-v="feedback">Send feedback</button>
    </div>
    ${note("Home pulls together the user's counts, due reminders and matching deadlines. Suggestions go to a review queue for the editor.")}
  </div>`;
}

// ---------- Discover with filters ----------
DATA.forEach(c => {
  if (!c.country) {
    if (c.region === "India") c.country = "India";
    else if (!CONT[c.id]) c.country = "To be announced";
    else { const parts = c.city.split(",").map(x => x.replace(/\(.*\)/, "").trim()); c.country = /venue/i.test(c.city) ? parts[0] : parts[parts.length - 1]; }
  }
  const y = (c.start || c.dateText || "").match(/20\d\d/); c.year = y ? y[0] : "To be announced";
  c.fmt = /online/i.test(c.mode) && !/hybrid/i.test(c.mode) ? "Online" : /hybrid/i.test(c.mode) ? "Hybrid" : "In person";
  c.regionF = c.continent === "Varies" ? "Location to be announced" : c.continent;
});
const FKEYS = {
  tiers:   { label:"Tier", opts:() => ["A*","A","B","C","Unrated"], get:c => c._tier === "General" ? "Unrated" : c._tier },
  regions: { label:"Region", opts:() => [...REGIONS, "Location to be announced"], get:c => c.regionF },
  countries:{ label:"Country", opts:() => [...new Set(REAL.map(c => c.country))].sort((a,b) => a === "To be announced" ? 1 : b === "To be announced" ? -1 : a.localeCompare(b)), get:c => c.country },
  years:   { label:"Year", opts:() => [...new Set(REAL.map(c => c.year))].sort(), get:c => c.year },
  status:  { label:"Status", opts:() => ["Open for submissions","Upcoming","Past edition","Next edition TBA"], get:c => c._status.key === "open" ? "Open for submissions" : c._status.key === "upcoming" ? "Upcoming" : c._status.key === "past" ? "Past edition" : "Next edition TBA" },
  discs:   { label:"Discipline", opts:() => DISCIPLINES.filter(([k]) => REAL.some(c => c.disc.includes(k))).map(x => x[1]), get:c => c.disc.map(k => DISCIPLINES.find(x => x[0] === k)[1]) },
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
const QUICK = [["status","Open for submissions","Open now"],["tiers","A*","A*"],["tiers","A","A"],["regions","India","India"],["regions","Europe","Europe"],["years","2027","2027"]];

function discover() {
  if (!S.f) S.f = blankF();
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
    ${!filtering ? `<div class="section-title">Recommended for you</div>${recs.length ? recs.map(card).join("") : `<div class="empty">Nothing open matches your preferences right now.</div>`}<div class="section-title">All conferences</div>` : ""}
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
  const sec = k => { const F = FKEYS[k]; return `<div style="display:grid;gap:6px"><div class="section-title" style="margin:0">${F.label}</div><div class="chips">${F.opts().map(o => `<button class="chip" type="button" data-act="fToggle" data-k="${k}" data-v="${esc(o)}" aria-pressed="${f[k].includes(o)}">${esc(o)}</button>`).join("")}</div></div>`; };
  return `<div class="modal-back" style="place-items:end stretch;padding:0"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="fh" style="max-width:none;border-radius:18px 18px 0 0;max-height:88%;display:flex;flex-direction:column;padding:0">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--rule)"><h3 id="fh">Filters</h3><button class="btn small" type="button" data-act="fReset">Clear all</button></div>
    <div style="overflow-y:auto;padding:14px 16px;display:grid;gap:16px">${Object.keys(FKEYS).map(sec).join("")}</div>
    <div style="padding:12px 16px;border-top:1px solid var(--rule);display:flex;gap:8px"><button class="btn" type="button" data-act="closeModal">Cancel</button><button class="btn primary" type="button" data-act="applyFilters" style="flex:1">Show ${count} conference${count === 1 ? "" : "s"}</button></div>
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
  return `<div class="appbar"><button class="iconbtn" type="button" data-act="back" aria-label="Back">${ICON.back}</button><h2 style="font-size:17px">Conference</h2>${bellBtn(c.id)}</div>
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
      : `<div class="empty">No reminders yet. Tap the bell on a conference, or mark one as Planning to submit.</div>`}
    ${note("A scheduler that works out each user's reminders every day from their statuses and bells, then sends them in the app, as device notifications (with permission) and by email.")}
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
    <div class="chips">${DISCIPLINES.map(([k, l]) => `<button class="chip" type="button" data-act="dDisc" data-v="${k}" aria-pressed="${g.discs.includes(k)}">${esc(l)}</button>`).join("")}<button class="chip" type="button" data-act="dDisc" data-v="unknown" aria-pressed="${g.discs.includes("unknown")}">I don't know</button></div>
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
  return `<div class="appbar"><h2>Feedback</h2></div>
  <div class="scroll">
    <div class="cmeta">This is an early preview. Your answers go straight to the team building the app.</div>
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
        <div class="pills">${x.rating ? `<span class="pill p-status">${"★".repeat(x.rating)}</span>` : ""}${x.would_use ? `<span class="pill p-muted">${esc(x.would_use)}</span>` : ""}</div>
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
function profile() {
  const u = S.user;
  const lbl = (list, keys) => keys.map(k => (list.find(x => x[0] === k) || [k,k])[1]).join(", ");
  return `<div class="appbar"><h2>Profile</h2></div>
  <div class="scroll">
    <div class="card"><p class="cname">${esc(u.name || "Name not set")}</p><div class="cmeta">${esc([u.role, u.institution, u.country].filter(Boolean).join(" · "))}</div><div class="cmeta">${esc(u.email)}</div><button class="btn small" type="button" data-act="editProfile" style="justify-self:start">Edit profile</button></div>
    <div class="card" style="border-left:4px solid ${API.mode === "live" ? "var(--open)" : "var(--soon)"}"><b>${API.mode === "live" ? "Saved to your account" : "Demo mode"}</b><span class="cmeta">${API.mode === "live" ? "Your profile, lists and history are available on any phone or laptop where you sign in." : "Not connected to the database yet. Your data is kept in this browser."}</span></div>
    ${S.isAdmin ? `<button class="btn primary block" type="button" data-act="host">Host dashboard: feedback and suggestions</button>` : ""}
    <div class="section-title">Your preferences</div>
    <div class="card"><dl class="kv">
      <dt>Disciplines</dt><dd>${esc(lbl(DISCIPLINES, u.discs) || "None")}</dd>
      <dt>Focus</dt><dd>${esc(lbl(SPECS, u.specs) || "All of management")}</dd>
      <dt>Topic</dt><dd>${esc(u.ownTopic || "Not set")}</dd>
      <dt>Regions</dt><dd>${esc(u.regions.join(", "))}</dd>
      <dt>Tiers</dt><dd>${esc(u.tiers.join(", "))}</dd>
    </dl><button class="btn small" type="button" data-act="editPrefs">Edit preferences</button></div>
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
    <button class="btn block" type="button" data-act="install">Add to home screen</button>
    ${S.isAdmin ? `<button class="btn block" type="button" data-act="notes">${S.showNotes ? "Hide" : "Show"} notes for the build team</button>` : ""}
    <button class="btn block" type="button" data-act="signout">Sign out</button>
    ${note("Settings and consent records; data export; account deletion (required under India's data protection law). Personal data is stored per account, separately from the conference database, so conference updates never touch it.")}
  </div>`;
}

function tabbar() {
  const t = (k, label, icon) => `<button type="button" data-act="tab" data-v="${k}" aria-current="${S.tab === k ? "page" : "false"}">${icon}${label}</button>`;
  return `<nav class="tabbar" aria-label="Main">${t("home","Home",ICON.home)}${t("discover","Discover",ICON.discover)}${t("mine","My list",ICON.mine)}${t("feedback","Feedback",ICON.fb)}${t("profile","Profile",ICON.profile)}</nav>`;
}
function modal() {
  if (S.modal === "filters") return filterSheet();
  if (S.modal === "tiers") return `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mh"><h3 id="mh">How tiers work</h3>
    <p>No official body ranks management conferences, unlike computer science, where bodies such as CORE rank conferences directly. Here each conference gets a score:</p>
    <p><b>60%</b> from the best ABDC rank among the journals it publishes into (A* = 4 down to C = 1; an editor workshop counts one grade lower; proceedings or no journal count as 1).<br><b>40%</b> from its host: premier international associations 5, ISB and NIRF top 10 4, NIRF 11–20 3, NIRF 21–30 2, others 1.</p>
    <p>Score 4.0+ is A*, 3.2+ is A, 2.2+ is B, 1.4+ is C, below that Unrated. Each conference page shows its own working.</p>
    <div class="row"><button class="btn primary" type="button" data-act="closeModal">Close</button></div></div></div>`;
  if (S.modal === "install") return `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mh"><h3 id="mh">Keep it on your home screen</h3>
    <p><b>iPhone (Safari):</b> tap the Share button, then “Add to Home Screen”.</p>
    <p><b>Android (Chrome):</b> tap the ⋮ menu, then “Add to Home screen”.</p>
    <p>It then opens from an icon, like an app.</p>
    <div class="row"><button class="btn primary" type="button" data-act="closeModal">Done</button></div></div></div>`;
  if (S.modal === "privacy") return `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mh"><h3 id="mh">Privacy and your data</h3>
    <p>We keep your profile, preferences and conference list only to run the app for you. We never sell or share it.</p>
    <div class="row" style="justify-content:stretch;flex-direction:column"><button class="btn" type="button" data-act="exportData">Download my data</button><button class="btn" type="button" data-act="askDelete">Delete my data</button><button class="btn primary" type="button" data-act="closeModal">Close</button></div></div></div>`;
  if (S.modal === "confirmDelete") return `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mh"><h3 id="mh">Delete your data?</h3>
    <p>This removes your profile, statuses, reminders and history from the app, and signs you out. It can't be undone.</p>
    <div class="row"><button class="btn" type="button" data-act="closeModal">Cancel</button><button class="btn primary" type="button" data-act="doDelete">Delete</button></div></div></div>`;
  if (S.modal !== "perm") return "";
  return `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mh"><h3 id="mh">Allow notifications?</h3>
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
    html = (S.sub === "host" ? hostScreen() : S.sub === "suggest" ? suggestForm() : S.sub === "mySug" ? mySuggestions() : c ? detail(c)
      : S.tab === "mine" ? mine() : S.tab === "reminders" ? remindersScreen() : S.tab === "profile" ? profile() : S.tab === "feedback" ? feedbackScreen() : S.tab === "discover" ? discover() : home()) + tabbar();
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
    case "toggleDisc": u.discs = u.discs.includes(v) ? u.discs.filter(x => x !== v) : [...u.discs, v]; break;
    case "toggleSpec": u.specs = u.specs.includes(v) ? u.specs.filter(x => x !== v) : [...u.specs, v]; break;
    case "toggleRegion": u.regions = u.regions.includes(v) ? u.regions.filter(x => x !== v) : [...u.regions, v]; break;
    case "toggleTier": u.tiers = u.tiers.includes(v) ? u.tiers.filter(x => x !== v) : [...u.tiers, v]; break;
    case "savePrefs": if (!u.consent) return; u.onboarded = true; u.consentAt = u.consentAt || new Date().toISOString(); S.screen = "done"; break;
    case "goHome": S.screen = "app"; S.tab = "home"; S.detail = null; break;
    case "editPrefs": S.screen = "onboard"; S.obStep = 2; break;
    case "editProfile": S.screen = "onboard"; S.obStep = 1; break;
    case "mineGo": S.tab = "mine"; S.mineTab = v; S.detail = null; break;
    case "howTiers": S.modal = "tiers"; break;
    case "install": S.modal = "install"; break;
    case "fbPick": S.fbDraft[b.dataset.k] = v; break;
    case "fbRate": S.fbDraft.rating = Number(v); break;
    case "fbSend": {
      const f = S.fbDraft || {};
      if (!f.use && !f.rating && !(f.missing || "").trim() && !(f.today || "").trim()) { toast("Answer at least one question first."); return; }
      try { const row = await API.addFeedback(S.session.id, f); S.myFeedback = [row, ...(S.myFeedback || [])]; S.fbDraft = null; toast("Thank you. Your feedback has been sent."); }
      catch (err) { console.error(err); toast("Couldn't send it. Please try again."); return; }
      break;
    }
    case "host": S.sub = "host"; S.host.feedback = null; S.host.suggestions = null; render(); loadHost(); return;
    case "hostTab": S.host.tab = v; break;
    case "hostReload": S.host.feedback = null; S.host.suggestions = null; render(); loadHost(); return;
    case "sugStatus": {
      const x = (S.host.suggestions || []).find(r => String(r.id) === id); if (!x) return;
      try { await API.updateSuggestion(x.id, { status: v }); x.status = v; toast("Status updated"); } catch (err) { console.error(err); toast("Couldn't update it."); return; }
      break;
    }
    case "suggest": S.sub = "suggest"; S.draft = S.draft || BLANK_DRAFT(); render(); scrollTop(); return;
    case "mySug": S.sub = "mySug"; break;
    case "closeSub": S.sub = null; break;
    case "dpick": S.draft[b.dataset.k] = v; break;
    case "dDisc": { const g = S.draft; if (v === "unknown") g.discs = g.discs.includes("unknown") ? [] : ["unknown"]; else { g.discs = g.discs.filter(x => x !== "unknown"); g.discs = g.discs.includes(v) ? g.discs.filter(x => x !== v) : [...g.discs, v]; } break; }
    case "privacy": S.modal = "privacy"; break;
    case "closeModal": S.modal = null; break;
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
    case "tab": S.tab = v; S.detail = null; S.sub = null; S.modal = null; render(); scrollTop(); return;
    case "open": S.detail = id; render(); scrollTop(); return;
    case "back": S.detail = null; break;
    case "bell": { const m = mark(id); m.bell = !m.bell; toast(m.bell ? "Reminder on" : "Reminder off"); break; }
    case "setStatus": {
      const m = mark(id); const was = m.status;
      m.status = was === v ? undefined : v; m.changed = TODAY_ISO;
      toast(m.status ? `Marked: ${ST[v].label}` : "Status cleared");
      if (m.status === "hidden") { S.detail = null; }
      break;
    }
    case "unhide": { mark(id).status = undefined; toast("Back in your lists"); break; }
    case "mineTab": S.mineTab = v; break;
    case "openFilters": S.fDraft = JSON.parse(JSON.stringify(S.f || blankF())); S.modal = "filters"; break;
    case "fToggle": { const a2 = S.fDraft[b.dataset.k]; S.fDraft[b.dataset.k] = a2.includes(v) ? a2.filter(x => x !== v) : [...a2, v]; break; }
    case "fReset": S.fDraft = blankF(); break;
    case "applyFilters": S.f = S.fDraft; S.modal = null; break;
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
