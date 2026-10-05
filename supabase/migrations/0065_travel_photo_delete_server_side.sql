-- plan.md §47 — travel photos were never actually deleted.
--
-- Found 2026-10-05: migration 0053 removed the anon read policy on storage.objects. The app's
-- client-side delete (supabase.storage.remove) must first look the file up, and anon can no
-- longer see the file, so the delete silently removes nothing. Result: "Mark as Paid" and
-- orphan clean-up left every photo behind (3 orphans confirmed, plus every paid claim's photos).
--
-- Fix, same pattern as the signed-URL helper in 0053: a server-side core that calls Storage's
-- own delete endpoint with the service_role key stored write-only in storage_signing_settings.
-- Internal only (revoked from anon), never returns the key.

create or replace function public.storage_delete_objects_core(p_bucket text, p_paths text[])
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_key text;
  v_resp extensions.http_response;
begin
  if p_paths is null or array_length(p_paths, 1) is null then return true; end if;
  select service_role_key into v_key from storage_signing_settings where id = 1;
  if v_key is null or btrim(v_key) = '' then return false; end if;
  begin
    select * into v_resp from extensions.http((
      'DELETE',
      'https://rogusfvcyaefyxmfvgso.supabase.co/storage/v1/object/' || p_bucket,
      array[
        extensions.http_header('apikey', v_key),
        extensions.http_header('Authorization', 'Bearer ' || v_key)
      ],
      'application/json',
      json_build_object('prefixes', p_paths)::text
    )::extensions.http_request);
  exception when others then
    return false; -- clean-up is best-effort; a leftover file never blocks a payment
  end;
  return v_resp.status between 200 and 299;
end;
$function$;

revoke execute on function public.storage_delete_objects_core(text, text[]) from public, anon, authenticated;

-- Paid claims now remove their own photos (server-side) instead of relying on the client.
-- Same signature and return shape as 0062; only the body changes.
create or replace function public.admin_mark_travel_claim_paid(p_token uuid, p_claim_id uuid)
 returns table(claim travel_claims, photo_paths text[])
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_c travel_claims;
  v_paths text[];
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;

  select * into v_c from travel_claims where id = p_claim_id for update;
  if v_c.id is null then raise exception 'Claim not found'; end if;
  if v_c.status <> 'Submitted' then raise exception 'This claim is already %', v_c.status; end if;

  select coalesce(array_agg(photo_path), '{}'::text[])
      || coalesce(array_agg(expense_photo_path) filter (where expense_photo_path is not null), '{}'::text[])
    into v_paths from travel_visits where claim_id = p_claim_id;

  update travel_claims set status = 'Paid', paid_at = now() where id = p_claim_id returning * into v_c;

  insert into travel_settlements (emp_id, period_start, period_end, total_km, rate_tier, rate_per_km, amount, expense_amount, approved_by_admin, paid_at)
  values (v_c.emp_id, v_c.period_start, v_c.period_end, v_c.total_km, v_c.rate_tier, v_c.rate_per_km, v_c.amount, v_c.expense_amount, 'admin', now());

  delete from travel_visits where claim_id = p_claim_id;

  -- Photos removed server-side now; the payment above is already committed either way.
  perform storage_delete_objects_core('travel-selfies', v_paths);

  perform log_audit('TRAVEL_CLAIM_PAID',
    (select name from employees where id = v_c.emp_id) || ' — ' || v_c.period_start || ' to ' || v_c.period_end || ', ₹' || v_c.amount,
    'admin');

  return query select v_c, v_paths;
end;
$function$;
