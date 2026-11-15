-- 15 Nov 2026: leaderboard lists everyone who has contributed (point 42 in FEEDBACK-LOG).
-- Safe to run more than once. Changes no data.

-- ---------- Beta leaderboard ----------
-- Points: feedback sent = 3 (at most 3 counted per person per week), +5 when the host marks it helpful;
-- suggestion sent = 3, or 10 once it is added to the app.
-- Returns everyone who has contributed. People who chose to appear show the name they chose;
-- everyone else appears as "A tester". No emails or other details.
create or replace function public.leaderboard()
returns table (board text, display_name text, points integer, items integer, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  with fb as (
    select user_id, created_at, helpful,
           row_number() over (partition by user_id, date_trunc('week', created_at) order by created_at) as n_in_week
    from public.feedback
  ),
  rev as (
    select user_id,
           sum(case when n_in_week <= 3 then 3 else 0 end + case when helpful then 5 else 0 end)::int as points,
           count(*)::int as items
    from fb group by user_id
  ),
  sug as (
    select user_id, sum(case when status = 'added' then 10 else 3 end)::int as points, count(*)::int as items
    from public.suggestions group by user_id
  )
  select 'reviewers', case when p.lb_opt_in then coalesce(nullif(p.lb_name, ''), nullif(split_part(p.name, ' ', 1), ''), 'Scholar') else 'A tester' end, r.points, r.items, p.id = auth.uid()
    from rev r join public.profiles p on p.id = r.user_id
  union all
  select 'suggesters', case when p.lb_opt_in then coalesce(nullif(p.lb_name, ''), nullif(split_part(p.name, ' ', 1), ''), 'Scholar') else 'A tester' end, s.points, s.items, p.id = auth.uid()
    from sug s join public.profiles p on p.id = s.user_id
  order by 1, 3 desc;
$$;
revoke execute on function public.leaderboard() from public, anon;
grant execute on function public.leaderboard() to authenticated;
