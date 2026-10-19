create policy admin_setup_no_client_access on private.admin_setup for all to anon,authenticated using(false) with check(false);
create or replace function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,name,email,role,status)
 values(new.id,left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1),'Member'),120),
 coalesce(new.email,''),case when new.raw_user_meta_data->>'requested_role' in ('student','teacher','staff') then new.raw_user_meta_data->>'requested_role' else 'student' end,'pending');
 return new;
end $$;
