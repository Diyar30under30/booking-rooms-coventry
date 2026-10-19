create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create extension if not exists btree_gist with schema extensions;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check (char_length(name) between 1 and 120),
 email text not null,
 role text not null default 'student' check (role in ('student','teacher','staff','admin')),
 status text not null default 'pending' check(status in ('pending','approved','rejected'))
);
create table public.spaces (
 id integer primary key, name text not null, type text not null,
 building text not null, floor text not null, amenities jsonb not null default '[]',
 capacity integer check(capacity>0), room text not null default '',
 "bookingScope" text not null default 'whole-room',
 active integer not null default 1 check(active in (0,1)),
 "resourceKey" text unique
);
create table public.bookings (
 id bigint generated always as identity primary key,
 "spaceId" integer not null references public.spaces(id),
 date date not null, start text not null, "end" text not null,
 title text not null check(char_length(btrim(title)) between 3 and 120),
 attendees integer not null check(attendees>0),
 "userId" uuid references public.profiles(id),
 source text not null default 'booking' check(source in ('booking','event')),
 check(start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 check(start>='08:00' and "end"<='22:00' and start<"end"),
 check(("end"::time-start::time)<= interval '8 hours'),
 exclude using gist ("spaceId" with =, date with =, int4range(split_part(start,':',1)::int*60+split_part(start,':',2)::int,split_part("end",':',1)::int*60+split_part("end",':',2)::int,'[)') with &&)
);
create index bookings_owner on public.bookings("userId");
create index bookings_date on public.bookings(date);
alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.bookings enable row level security;

create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='approved')
$$;
revoke all on function private.is_admin() from public,anon;
grant execute on function private.is_admin() to authenticated;

create function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,name,email,role,status)
 values(new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1),'Member'),120),
 coalesce(new.email,''), 'student', 'pending');
 return new;
end $$;
revoke all on function private.new_profile() from public,anon,authenticated;
create trigger create_profile after insert on auth.users for each row execute function private.new_profile();

grant select on public.spaces to anon,authenticated;
grant select on public.profiles to authenticated;
grant update(status) on public.profiles to authenticated;
grant select,insert,delete on public.bookings to authenticated;
grant usage,select on sequence public.bookings_id_seq to authenticated;
create policy spaces_read on public.spaces for select to anon,authenticated using(true);
create policy profiles_read on public.profiles for select to authenticated using(id=(select auth.uid()) or (select private.is_admin()));
create policy profiles_approve on public.profiles for update to authenticated
 using((select private.is_admin()) and role<>'admin')
 with check((select private.is_admin()) and role<>'admin' and status in ('approved','rejected'));
create policy bookings_own on public.bookings for select to authenticated using("userId"=(select auth.uid()) or (select private.is_admin()));
create policy bookings_create on public.bookings for insert to authenticated with check (
 "userId"=(select auth.uid()) and
 exists(select 1 from public.profiles where id=(select auth.uid()) and status='approved') and
 (source='booking' or (select private.is_admin()))
);
create policy bookings_cancel on public.bookings for delete to authenticated using(
 ("userId"=(select auth.uid()) and source='booking') or (select private.is_admin())
);
create function private.validate_booking() returns trigger language plpgsql set search_path='' as $$
declare room public.spaces;
begin
 select * into room from public.spaces where id=new."spaceId";
 if room.active<>1 or room.type<>'classroom' or room."bookingScope"<>'whole-room' then raise exception 'Choose an active classroom.'; end if;
 if room.capacity is not null and new.attendees>room.capacity then raise exception 'Attendee count exceeds room capacity.'; end if;
 if (new.date+new.start::time) <= (now() at time zone 'Asia/Qyzylorda') then raise exception 'Choose a start time in the future.'; end if;
 return new;
end $$;
revoke all on function private.validate_booking() from public,anon,authenticated;
create trigger validate_booking before insert or update on public.bookings for each row execute function private.validate_booking();

create function private.schedule(from_date date,to_date date) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to view availability.' using errcode='42501'; end if;
 if from_date is null or to_date is null or to_date<from_date or to_date-from_date>30 then raise exception 'Choose a range of up to 31 days.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
 'id',b.id,'spaceId',b."spaceId",'date',b.date,'start',b.start,'end',b."end",
 'title',case when b.source='event' or b."userId"=auth.uid() or private.is_admin() then b.title else 'Classroom reservation' end,
 'attendees',b.attendees,'source',b.source,'isMine',coalesce(b."userId"=auth.uid(),false),
 'canCancel',coalesce((b."userId"=auth.uid() and b.source='booking') or private.is_admin(),false)
 ) order by b.date,b.start,b.id) from public.bookings b where b.date between from_date and to_date),'[]'::jsonb);
end $$;
revoke all on function private.schedule(date,date) from public,anon;
grant execute on function private.schedule(date,date) to authenticated;
create function public.booking_schedule(from_date date,to_date date) returns jsonb language sql stable security invoker set search_path='' as $$
 select private.schedule(from_date,to_date)
$$;
revoke all on function public.booking_schedule(date,date) from public,anon;
grant execute on function public.booking_schedule(date,date) to authenticated;
create function public.my_bookings() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(row),'[]'::jsonb) from (
 select id,"spaceId",date,start,"end",title,attendees,source,true as "isMine",source='booking' or private.is_admin() as "canCancel"
 from public.bookings where "userId"=auth.uid() and date >= (now() at time zone 'Asia/Qyzylorda')::date order by date,start limit 1000
 ) row
$$;
revoke all on function public.my_bookings() from public,anon;
grant execute on function public.my_bookings() to authenticated;
