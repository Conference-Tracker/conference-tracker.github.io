# Conference Tracker

An app for tracking management research conferences in India and abroad, tiered A*, A, B and C by the ABDC rank of their linked journals and the standing of their host, with personal statuses and deadline reminders.

It runs as a web app on GitHub Pages (free) with a Supabase database and sign-in (free plan). People can add it to their phone's home screen and use it like an app.

## How the data is organised

- **Conference data** (`conferences` table) is maintained by the host. Each conference has a permanent ID such as `euram27`. Conferences are never deleted, only archived, so nobody's saved statuses are ever cut off by an update.
- **Personal data** is owned by each user: `profiles`, `user_marks` (statuses, reminders, attended history), `suggestions` and `feedback`.
- Database rules enforce privacy: each person can read and change only their own data. The host can read **feedback** and **suggestions** (shown in the Host dashboard inside the app) but cannot read anyone's statuses or reminders.

## Research categories and locations

Disciplines and specialisations follow the **ANZSRC 2020 Fields of Research**, the classification used by the ABDC Journal Quality List (`taxonomy.js`). Codes are stored at three levels (Division > Group > Field); the app asks people for a discipline (group) and an optional specialisation (field). Conferences carry the same codes in `for_groups` and `for_fields`. Locations use regions and countries (QS-style): choose a region, and optionally narrow it to countries.

## Beta leaderboard

Feedback earns 3 points (up to 3 a week) plus 5 when the host marks it helpful; a suggestion earns 3 points, or 10 once the conference is added. Only people who opt in appear, under the name they choose. Computed by the `leaderboard()` database function.

## One-time setup

1. **Supabase project.** At supabase.com create a free project (region: Mumbai). Keep the database password safe and never share it.
2. **Create the tables.** In Supabase open *SQL Editor → New query*, paste the contents of `sql/01_schema.sql` and press *Run*. Then do the same with `sql/02_seed_conferences.sql` to load the starting conference list.
3. **Connect the app.** In *Project Settings → API* copy the *Project URL* and the *anon public* key into `config.js`. Both are designed to be public. Never put the `service_role` key in this repository.
4. **Sign-in settings.** In *Authentication → URL Configuration* set the *Site URL* to the app's address (for example `https://<your-username>.github.io/conference-tracker/`) and add the same address under *Redirect URLs*.
5. **Google sign-in (optional but recommended).** Create an OAuth client in Google Cloud Console and paste its client ID and secret into *Authentication → Providers → Google*. Email sign-in links work without this step.
6. **Publish.** In the GitHub repository open *Settings → Pages*, choose *Deploy from a branch*, branch `main`, folder `/ (root)`.
7. **Become the host.** Sign in to the app once, then run `sql/03_make_me_host.sql` in the SQL Editor with your email filled in. The *Host dashboard* button appears in Profile.

## Updating conferences

Use Supabase *Table Editor → conferences* to edit dates, deadlines or journals: change the cell and save. To add a new edition (for example EURAM 2028), add a new row with a new ID (`euram28`) and the same `series`. To retire a conference, tick `archived` instead of deleting it.

## Demo mode

If `config.js` is empty, the app runs in demo mode: everything is kept in the browser and the address `demo.scholar@gmail.com` acts as host. This is useful for trying changes before they go live.

## Costs

GitHub Pages and the Supabase free plan cost nothing at this scale (the free plan allows 50,000 monthly active users and a 500 MB database). Supabase pauses free projects after 7 days without activity; the workflow in `.github/workflows/keep-database-awake.yml` prevents that.
