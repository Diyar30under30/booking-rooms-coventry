create table private.admin_setup (singleton boolean primary key default true check(singleton), code_hash text not null);
alter table private.admin_setup enable row level security;
revoke all on private.admin_setup from public,anon,authenticated;
create function private.setup_needed() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.admin_setup) and not exists(select 1 from public.profiles where role='admin')
$$;
revoke all on function private.setup_needed() from public;
grant usage on schema private to anon;
grant execute on function private.setup_needed() to anon,authenticated;
create function public.setup_needed() returns boolean language sql stable security invoker set search_path='' as $$select private.setup_needed()$$;
revoke all on function public.setup_needed() from public;
grant execute on function public.setup_needed() to anon,authenticated;
create function private.claim_admin(setup_code text) returns boolean language plpgsql security definer set search_path='' as $$
declare expected text;
begin
 if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
 select code_hash into expected from private.admin_setup where singleton for update;
 if expected is null or exists(select 1 from public.profiles where role='admin') then return false; end if;
 if length(setup_code)>256 or encode(extensions.digest(setup_code,'sha256'),'hex') is distinct from expected then return false; end if;
 update public.profiles set role='admin',status='approved' where id=auth.uid();
 delete from private.admin_setup;
 return true;
end $$;
revoke all on function private.claim_admin(text) from public,anon;
grant execute on function private.claim_admin(text) to authenticated;
create function public.claim_admin(setup_code text) returns boolean language sql security invoker set search_path='' as $$select private.claim_admin(setup_code)$$;
revoke all on function public.claim_admin(text) from public,anon;
grant execute on function public.claim_admin(text) to authenticated;

insert into public.spaces ("id","name","type","building","floor","amenities","capacity","room","bookingScope","active","resourceKey") values
(26,'Classroom 201','classroom','Coventry','Floor 2','[]',null,'201','whole-room',1,'coventry:classroom-201'),
(27,'Classroom 202','classroom','Coventry','Floor 2','[]',null,'202','whole-room',1,'coventry:classroom-202'),
(28,'Classroom 203','classroom','Coventry','Floor 2','[]',null,'203','whole-room',1,'coventry:classroom-203'),
(29,'Large lecture room 204','classroom','Coventry','Floor 2','[]',null,'204','whole-room',1,'coventry:classroom-204'),
(30,'Classroom 205','classroom','Coventry','Floor 2','[]',null,'205','whole-room',1,'coventry:classroom-205'),
(31,'Classroom 206','classroom','Coventry','Floor 2','[]',null,'206','whole-room',1,'coventry:classroom-206'),
(32,'Classroom 207','classroom','Coventry','Floor 2','[]',null,'207','whole-room',1,'coventry:classroom-207'),
(33,'Classroom 208','classroom','Coventry','Floor 2','[]',null,'208','whole-room',1,'coventry:classroom-208'),
(34,'Library 301','classroom','Coventry','Floor 3','[]',null,'301','whole-room',1,'coventry:classroom-301'),
(35,'Club room 302','classroom','Coventry','Floor 3','[]',null,'302','whole-room',1,'coventry:classroom-302'),
(36,'Large lecture room 303','classroom','Coventry','Floor 3','[]',null,'303','whole-room',1,'coventry:classroom-303'),
(37,'Classroom 304','classroom','Coventry','Floor 3','[]',null,'304','whole-room',1,'coventry:classroom-304'),
(38,'Classroom 305','classroom','Coventry','Floor 3','[]',null,'305','whole-room',1,'coventry:classroom-305'),
(39,'Classroom 306','classroom','Coventry','Floor 3','[]',null,'306','whole-room',1,'coventry:classroom-306'),
(40,'Classroom 307','classroom','Coventry','Floor 3','[]',null,'307','whole-room',1,'coventry:classroom-307'),
(41,'Classroom 308','classroom','Coventry','Floor 3','[]',null,'308','whole-room',1,'coventry:classroom-308'),
(42,'Classroom 401','classroom','Coventry','Floor 4','[]',null,'401','whole-room',1,'coventry:classroom-401'),
(43,'Classroom 402','classroom','Coventry','Floor 4','[]',null,'402','whole-room',1,'coventry:classroom-402'),
(44,'Classroom 403','classroom','Coventry','Floor 4','[]',null,'403','whole-room',1,'coventry:classroom-403'),
(45,'Classroom 404','classroom','Coventry','Floor 4','[]',null,'404','whole-room',1,'coventry:classroom-404'),
(46,'Classroom 405','classroom','Coventry','Floor 4','[]',null,'405','whole-room',1,'coventry:classroom-405'),
(47,'Classroom 406','classroom','Coventry','Floor 4','[]',null,'406','whole-room',1,'coventry:classroom-406'),
(48,'Classroom 407','classroom','Coventry','Floor 4','[]',null,'407','whole-room',1,'coventry:classroom-407'),
(49,'Classroom 408','classroom','Coventry','Floor 4','[]',null,'408','whole-room',1,'coventry:classroom-408'),
(21,'Classroom L03','classroom','Main Library','Floor 2','["Whiteboard","Projector","Power outlet","Wi-Fi"]',24,'Classroom L03','whole-room',1,'main-library:classroom-l03'),
(24,'Classroom L04','classroom','Main Library','Floor 3','["Whiteboard","Projector","Power outlet","Wi-Fi"]',36,'Classroom L04','whole-room',1,'main-library:classroom-l04'),
(25,'Classroom L05','classroom','Main Library','Floor 4','["Whiteboard","Projector","Power outlet","Wi-Fi"]',18,'Classroom L05','whole-room',1,'main-library:classroom-l05'),
(17,'Classroom 102','classroom','Science Center','Floor 2','["Whiteboard","Projector","Power outlet","Wi-Fi"]',30,'Classroom 102','whole-room',1,'science-center:classroom-102'),
(22,'Classroom 104','classroom','Science Center','Floor 3','["Whiteboard","Projector","Power outlet","Wi-Fi"]',40,'Classroom 104','whole-room',1,'science-center:classroom-104'),
(23,'Classroom 106','classroom','Science Center','Floor 4','["Whiteboard","Projector","Power outlet","Wi-Fi"]',20,'Classroom 106','whole-room',1,'science-center:classroom-106') on conflict(id) do nothing;
