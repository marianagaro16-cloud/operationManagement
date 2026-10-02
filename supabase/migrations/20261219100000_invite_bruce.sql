-- Bruce, Freddy's helper in Maintenance: approved as a Maintenance User when he signs up.
insert into public.account_invites (email, role, team, name)
values ('bruss252000@gmail.com', 'user', 'maintenance', 'Bruce')
on conflict (email) do nothing;
