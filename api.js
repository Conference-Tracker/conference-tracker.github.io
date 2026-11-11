// Data layer. Two modes:
//   live: Supabase (accounts, database) when config.js has a project URL and public key
//   demo: everything in this browser, for trying the app before the database is connected
// Conference data and personal data are always handled separately.
(function () {
  const CFG = window.CT_CONFIG || {};
  const LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase && window.supabase.createClient);
  const sb = LIVE ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } }) : null;
  const here = () => location.origin + location.pathname;

  const toUser = (row, sess) => ({
    name: (row && row.name) || (sess && sess.name) || "",
    email: (sess && sess.email) || "",
    title: (row && row.title) || "",
    institution: (row && row.institution) || "",
    role: (row && row.role) || "",
    country: (row && row.country) || "",
    discs: (row && row.discs) || ["mgmt"],
    specs: (row && row.specs) || [],
    ownTopic: (row && row.own_topic) || "",
    regions: (row && row.regions) || ["India"],
    tiers: (row && row.tiers) || ["A*","A","B"],
    inapp: row ? row.inapp !== false : true,
    system: !!(row && row.system_notif),
    consent: !!(row && row.consent_at),
    onboarded: !!(row && row.onboarded)
  });
  const fromUser = (uid, u) => ({
    id: uid, name: u.name || "", title: u.title || null, institution: u.institution || null, role: u.role || null,
    country: u.country || null, discs: u.discs || [], specs: u.specs || [], own_topic: u.ownTopic || null,
    regions: u.regions || [], tiers: u.tiers || [], inapp: !!u.inapp, system_notif: !!u.system,
    consent_at: u.consent ? (u.consentAt || new Date().toISOString()) : null, onboarded: !!u.onboarded
  });
  const toMark = r => ({ status: r.status || undefined, bell: !!r.bell, paperTitle: r.paper_title || "", decisionDate: r.decision_date || "", regDeadline: r.reg_deadline || "", role: r.attend_role || "", note: r.note || "" });
  const fromMark = (uid, cid, m) => ({ user_id: uid, conference_id: cid, status: m.status || null, bell: !!m.bell, paper_title: m.paperTitle || null,
    decision_date: m.decisionDate || null, reg_deadline: m.regDeadline || null, attend_role: m.role || null, note: m.note || null });
  const emptyMark = m => !m.status && !m.bell && !m.paperTitle && !m.decisionDate && !m.regDeadline && !m.role && !m.note;
  const sessOf = s => s && s.user ? { id: s.user.id, email: s.user.email || "", name: (s.user.user_metadata && (s.user.user_metadata.full_name || s.user.user_metadata.name)) || "" } : null;
  const must = ({ data, error }) => { if (error) throw error; return data; };

  const live = {
    mode: "live",
    async loadConferences() { return must(await sb.from("conferences").select("*").eq("archived", false)); },
    async getSession() { const { data } = await sb.auth.getSession(); return sessOf(data.session); },
    onAuth(cb) { sb.auth.onAuthStateChange((_ev, s) => cb(sessOf(s))); },
    async signInGoogle() { const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: here() } }); if (error) throw error; return { redirect: true }; },
    async signInEmail(email) { const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: here() } }); if (error) throw error; return { sent: true }; },
    async signOut() { await sb.auth.signOut(); },
    async loadUserData(sess) {
      const [p, m, s, f, a] = await Promise.all([
        sb.from("profiles").select("*").eq("id", sess.id).maybeSingle(),
        sb.from("user_marks").select("*").eq("user_id", sess.id),
        sb.from("suggestions").select("*").eq("user_id", sess.id).order("created_at", { ascending: false }),
        sb.from("feedback").select("*").eq("user_id", sess.id).order("created_at", { ascending: false }),
        sb.rpc("is_admin")
      ]);
      [p, m, s, f].forEach(x => { if (x.error) throw x.error; });
      const marks = {}; (m.data || []).forEach(r => marks[r.conference_id] = toMark(r));
      return { user: toUser(p.data, sess), marks, suggestions: s.data || [], feedback: f.data || [], isAdmin: !a.error && a.data === true };
    },
    async saveProfile(uid, u) { must(await sb.from("profiles").upsert(fromUser(uid, u))); },
    async saveMark(uid, cid, m) {
      if (emptyMark(m)) must(await sb.from("user_marks").delete().eq("user_id", uid).eq("conference_id", cid));
      else must(await sb.from("user_marks").upsert(fromMark(uid, cid, m)));
    },
    async addSuggestion(uid, name, organiser, details) { return must(await sb.from("suggestions").insert({ user_id: uid, name, organiser, details }).select().single()); },
    async addFeedback(uid, fb) { return must(await sb.from("feedback").insert({ user_id: uid, would_use: fb.use || null, missing: fb.missing || null, how_today: fb.today || null, rating: fb.rating || null }).select().single()); },
    async hostFeedback() { return must(await sb.from("feedback").select("*").order("created_at", { ascending: false })); },
    async hostSuggestions() { return must(await sb.from("suggestions").select("*").order("created_at", { ascending: false })); },
    async hostProfiles(ids) { if (!ids.length) return []; return must(await sb.from("profiles").select("id,name,role,institution,country").in("id", ids)); },
    async updateSuggestion(id, patch) { must(await sb.from("suggestions").update(patch).eq("id", id)); },
    async deleteMyData(uid) {
      must(await sb.from("user_marks").delete().eq("user_id", uid));
      must(await sb.from("profiles").delete().eq("id", uid));
      await sb.auth.signOut();
    }
  };

  // ---------- Demo mode: same interface, stored in this browser ----------
  const K = "conference-tracker-demo";
  const load = () => { try { return JSON.parse(localStorage.getItem(K)) || { session: null, users: {}, suggestions: [], feedback: [] }; } catch (e) { return { session: null, users: {}, suggestions: [], feedback: [] }; } };
  const store = x => { try { localStorage.setItem(K, JSON.stringify(x)); } catch (e) {} };
  let authCb = () => {};
  const idFor = email => "demo-" + email.replace(/[^a-z0-9]/gi, "-");
  const demo = {
    mode: "demo",
    async loadConferences() { return (window.CT_SEED || []).filter(r => !r.archived); },
    async getSession() { return load().session; },
    onAuth(cb) { authCb = cb; },
    async signInGoogle() { return demo._signIn("demo.scholar@gmail.com", "Demo Scholar"); },
    async signInEmail(email) { return demo._signIn(email, ""); },
    async _signIn(email, name) { const x = load(); x.session = { id: idFor(email), email, name }; store(x); setTimeout(() => authCb(x.session), 0); return { signedIn: true }; },
    async signOut() { const x = load(); x.session = null; store(x); },
    async loadUserData(sess) {
      const x = load(); const rec = x.users[sess.id] || {};
      return { user: toUser(rec.profile || null, sess), marks: rec.marks || {}, suggestions: x.suggestions.filter(s => s.user_id === sess.id), feedback: x.feedback.filter(f => f.user_id === sess.id), isAdmin: sess.email === "demo.scholar@gmail.com" };
    },
    async saveProfile(uid, u) { const x = load(); (x.users[uid] = x.users[uid] || {}).profile = fromUser(uid, u); store(x); },
    async saveMark(uid, cid, m) { const x = load(); const r = (x.users[uid] = x.users[uid] || {}); r.marks = r.marks || {}; if (emptyMark(m)) delete r.marks[cid]; else r.marks[cid] = m; store(x); },
    async addSuggestion(uid, name, organiser, details) { const x = load(); const row = { id: String(Date.now()), user_id: uid, name, organiser, details, status: "under_review", editor_note: null, created_at: new Date().toISOString() }; x.suggestions.unshift(row); store(x); return row; },
    async addFeedback(uid, fb) { const x = load(); const row = { id: String(Date.now()), user_id: uid, would_use: fb.use || null, missing: fb.missing || null, how_today: fb.today || null, rating: fb.rating || null, created_at: new Date().toISOString() }; x.feedback.unshift(row); store(x); return row; },
    async hostFeedback() { return load().feedback; },
    async hostSuggestions() { return load().suggestions; },
    async hostProfiles(ids) { const x = load(); return ids.map(id => x.users[id] && x.users[id].profile).filter(Boolean); },
    async updateSuggestion(id, patch) { const x = load(); const s = x.suggestions.find(r => r.id === id); if (s) Object.assign(s, patch); store(x); },
    async deleteMyData(uid) { const x = load(); delete x.users[uid]; x.session = null; store(x); }
  };

  window.API = LIVE ? live : demo;
})();
