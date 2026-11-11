-- Make yourself the host (admin).
-- First sign in to the app once, so your account exists. Then replace the email below with the
-- email you signed in with, and run this in Supabase: SQL Editor > New query > paste > Run.

insert into public.admins (user_id)
select id from auth.users where email = 'YOUR-EMAIL-HERE'
on conflict do nothing;

-- Check it worked (should return one row):
select u.email from public.admins a join auth.users u on u.id = a.user_id;
