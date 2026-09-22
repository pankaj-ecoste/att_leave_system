-- plan.md §33.2 (system health audit, 2026-09-22) — closes the "anyone holding the
-- app's public key can read/list every employee's medical certificate or travel selfie"
-- gap. Root cause: this app has no real per-employee Supabase Auth session (employees
-- log in via a custom PIN check, so there is no auth.uid() for storage RLS to key off),
-- so the only RLS the leave-documents/travel-selfies buckets could ever express was
-- "anon can read the whole bucket" — a database permission can't tell "list everything"
-- apart from "fetch one specific file I already have the path to" without some real
-- identity signal, and this app's storage layer had none.
--
-- Fix: move the "who is allowed to see this file" decision into the database itself,
-- the same place every other permission check in this app already lives (a
-- SECURITY DEFINER function checking the caller's login token) — then have that
-- function ask Supabase Storage for a short-lived (5-minute) signed link on the
-- caller's behalf, instead of letting the browser sign its own links directly. Direct
-- anon access to both buckets is removed entirely; the only way in is these functions.
--
-- The storage service only allows this "sign a link for someone else" request from the
-- Supabase "service_role" key — a far more powerful secret than anything else this app
-- stores server-side. It is written here with the same write-only discipline already
-- used for the OpenRouteService key (0048): never returned by any function, set once
-- via a one-off script (scripts/set-storage-signing-key.mjs) run directly against the
-- database, not through any anon-reachable RPC.

create table if not exists public.storage_signing_settings (
  "id" smallint not null primary key check (id = 1),
  "service_role_key" text,
  "updated_at" timestamp with time zone default now() not null
);

insert into public.storage_signing_settings (id) values (1) on conflict (id) do nothing;

alter table storage_signing_settings enable row level security;
-- No anon grants at all — not even a status check. This key is never meant to be
-- readable or even "is it set" checkable from the browser.

-- ============ Core signer — NOT anon-reachable, learned from §33.1 ============
-- Every caller goes through one of the token-checked wrappers below, never this
-- directly. Explicit revoke (not just "no grant") because Supabase auto-grants EXECUTE
-- to anon on every new function by default — the exact gap §33.1 closed five instances
-- of elsewhere in this codebase; this function is written to never have that gap open
-- in the first place.
create or replace function public.storage_sign_url_core(p_bucket text, p_path text, p_expires_seconds int default 300)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_key text;
  v_project_url text := 'https://rogusfvcyaefyxmfvgso.supabase.co';
  v_resp extensions.http_response;
  v_signed_path text;
begin
  select service_role_key into v_key from storage_signing_settings where id = 1;
  if v_key is null or btrim(v_key) = '' then
    raise exception 'File viewing is not configured yet — contact your admin';
  end if;

  begin
    select * into v_resp from extensions.http((
      'POST',
      v_project_url || '/storage/v1/object/sign/' || p_bucket || '/' || p_path,
      array[
        extensions.http_header('apikey', v_key),
        extensions.http_header('Authorization', 'Bearer ' || v_key)
      ],
      'application/json',
      json_build_object('expiresIn', p_expires_seconds)::text
    )::extensions.http_request);
  exception when others then
    raise exception 'Could not reach file storage — try again shortly';
  end;

  if v_resp.status <> 200 then
    raise exception 'File storage refused the request (status %)', v_resp.status;
  end if;

  v_signed_path := (v_resp.content::jsonb) ->> 'signedURL';
  if v_signed_path is null then
    raise exception 'File storage returned an unexpected response';
  end if;

  return v_project_url || '/storage/v1' || v_signed_path;
end;
$function$;

revoke execute on function public.storage_sign_url_core(text, text, int) from public, anon, authenticated;

-- ============ Leave documents (sick-leave prescriptions) ============

create or replace function public.admin_get_leave_document_url(p_token uuid, p_path text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  if not exists (select 1 from leave_applications where document_path = p_path) then
    raise exception 'No such document';
  end if;
  return storage_sign_url_core('leave-documents', p_path, 300);
end;
$function$;

grant execute on function public.admin_get_leave_document_url(uuid, text) to anon;

create or replace function public.manager_get_leave_document_url(p_token uuid, p_manager_id uuid, p_path text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  if not exists (
    select 1 from leave_applications la join employees e on e.id = la.emp_id
    where la.document_path = p_path and e.manager_emp_id = p_manager_id
  ) then
    raise exception 'Not your team member''s document';
  end if;
  return storage_sign_url_core('leave-documents', p_path, 300);
end;
$function$;

grant execute on function public.manager_get_leave_document_url(uuid, uuid, text) to anon;

-- Lock the bucket down to these two functions only.
drop policy if exists "anon can read leave documents" on storage.objects;

-- ============ Travel selfies / expense receipts ============

create or replace function public.employee_get_own_travel_photo_url(p_token uuid, p_emp_id uuid, p_path text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  if not exists (
    select 1 from travel_visits where emp_id = p_emp_id and (photo_path = p_path or expense_photo_path = p_path)
  ) then
    raise exception 'Not your photo';
  end if;
  return storage_sign_url_core('travel-selfies', p_path, 300);
end;
$function$;

grant execute on function public.employee_get_own_travel_photo_url(uuid, uuid, text) to anon;

create or replace function public.manager_get_team_travel_photo_url(p_token uuid, p_manager_id uuid, p_path text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  if not exists (
    select 1 from travel_visits v join employees e on e.id = v.emp_id
    where (v.photo_path = p_path or v.expense_photo_path = p_path) and e.manager_emp_id = p_manager_id
  ) then
    raise exception 'Not your team member''s photo';
  end if;
  return storage_sign_url_core('travel-selfies', p_path, 300);
end;
$function$;

grant execute on function public.manager_get_team_travel_photo_url(uuid, uuid, text) to anon;

create or replace function public.admin_get_travel_photo_url(p_token uuid, p_path text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  if not exists (
    select 1 from travel_visits where photo_path = p_path or expense_photo_path = p_path
  ) then
    raise exception 'No such photo';
  end if;
  return storage_sign_url_core('travel-selfies', p_path, 300);
end;
$function$;

grant execute on function public.admin_get_travel_photo_url(uuid, text) to anon;

-- Lock the bucket down to these three functions only. Upload (insert) and the
-- orphan-checked settle-time delete (0051) are untouched — this migration is read
-- access only.
drop policy if exists "anon can read travel selfies" on storage.objects;
