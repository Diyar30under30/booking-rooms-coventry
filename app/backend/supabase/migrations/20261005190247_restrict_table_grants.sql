revoke all on public.profiles,public.spaces,public.bookings from anon,authenticated;
revoke all on sequence public.bookings_id_seq from anon,authenticated;
grant select on public.spaces to anon,authenticated;
grant select on public.profiles to authenticated;
grant update(status) on public.profiles to authenticated;
grant select,insert,delete on public.bookings to authenticated;
grant usage,select on sequence public.bookings_id_seq to authenticated;
