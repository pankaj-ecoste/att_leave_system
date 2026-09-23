-- plan.md §31 follow-up (2026-09-23) — OpenRouteService's real road distances came in
-- consistently 4-6km under Google Maps on the same trips. Verified first that every
-- leg was actually refined (nothing stuck on the old straight-line fallback) — the gap
-- is genuine cross-provider variance between two different routing engines/map data,
-- not a bug. Admin decided the exact-parity-with-Google option is worth the tradeoff
-- (a Google Cloud billing account, cost expected to stay ₹0/month at current volume —
-- well under the Routes API's 10,000 free calls/month).
--
-- road_distance_km() becomes a dispatcher: try Google Routes first if a key is
-- configured, fall back to OpenRouteService if that's configured (or if Google fails
-- for any reason — network blip, bad key, quota), fall back to null (the original
-- instant estimate) if neither works. Nothing about the employee's save flow changes;
-- this only affects the same background refinement admin's Review already triggers.
--
-- Same §33.1 discipline this feature has followed throughout: every function here gets
-- an explicit revoke, re-granted only to what actually needs it, verified by the apply
-- script rather than assumed from a comment.

alter table travel_routing_settings add column if not exists google_maps_api_key text;

-- ============ Provider-specific callers — internal only ============

create or replace function public.road_distance_km_google(p_key text, p_lat1 numeric, p_lon1 numeric, p_lat2 numeric, p_lon2 numeric)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_resp extensions.http_response;
  v_body text;
  v_meters numeric;
begin
  v_body := jsonb_build_object(
    'origin', jsonb_build_object('location', jsonb_build_object('latLng', jsonb_build_object('latitude', p_lat1, 'longitude', p_lon1))),
    'destination', jsonb_build_object('location', jsonb_build_object('latLng', jsonb_build_object('latitude', p_lat2, 'longitude', p_lon2))),
    'travelMode', 'DRIVE'
  )::text;

  begin
    select * into v_resp from extensions.http((
      'POST',
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      array[
        extensions.http_header('X-Goog-Api-Key', p_key),
        extensions.http_header('X-Goog-FieldMask', 'routes.distanceMeters')
      ],
      'application/json',
      v_body
    )::extensions.http_request);
  exception when others then
    return null; -- road distance is a refinement, never the reason anything fails
  end;

  if v_resp.status is distinct from 200 then
    return null;
  end if;

  v_meters := (v_resp.content::jsonb -> 'routes' -> 0 ->> 'distanceMeters')::numeric;
  if v_meters is null then
    return null;
  end if;

  return round(v_meters / 1000.0, 3);
end;
$function$;

revoke execute on function public.road_distance_km_google(text, numeric, numeric, numeric, numeric) from public, anon, authenticated;

create or replace function public.road_distance_km_ors(p_key text, p_lat1 numeric, p_lon1 numeric, p_lat2 numeric, p_lon2 numeric)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_resp extensions.http_response;
  v_url text;
  v_meters numeric;
begin
  v_url := format(
    'https://api.openrouteservice.org/v2/directions/driving-car?api_key=%s&start=%s,%s&end=%s,%s',
    p_key, p_lon1, p_lat1, p_lon2, p_lat2
  );

  begin
    select * into v_resp from extensions.http((
      'GET', v_url,
      array[extensions.http_header('Accept', 'application/geo+json; charset=UTF-8')],
      null, null
    )::extensions.http_request);
  exception when others then
    return null;
  end;

  if v_resp.status is distinct from 200 then
    return null;
  end if;

  v_meters := (v_resp.content::jsonb -> 'features' -> 0 -> 'properties' -> 'summary' ->> 'distance')::numeric;
  if v_meters is null then
    return null;
  end if;

  return round(v_meters / 1000.0, 3);
end;
$function$;

revoke execute on function public.road_distance_km_ors(text, numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- ============ road_distance_km — dispatcher, same public signature as before ============
-- travel_refine_distances_core calls this exact name/signature, so nothing that calls
-- it needs to change.

create or replace function public.road_distance_km(p_lat1 numeric, p_lon1 numeric, p_lat2 numeric, p_lon2 numeric)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_google_key text;
  v_ors_key text;
  v_km numeric;
begin
  select google_maps_api_key, ors_api_key into v_google_key, v_ors_key from travel_routing_settings where id = 1;

  if v_google_key is not null and btrim(v_google_key) <> '' then
    v_km := road_distance_km_google(v_google_key, p_lat1, p_lon1, p_lat2, p_lon2);
    if v_km is not null then return v_km; end if;
  end if;

  if v_ors_key is not null and btrim(v_ors_key) <> '' then
    v_km := road_distance_km_ors(v_ors_key, p_lat1, p_lon1, p_lat2, p_lon2);
    if v_km is not null then return v_km; end if;
  end if;

  return null; -- neither configured or both failed — caller keeps the haversine estimate
end;
$function$;

revoke execute on function public.road_distance_km(numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- ============ Admin — set the Google key (never read back), extend status check ============

create or replace function public.admin_set_google_maps_api_key(p_token uuid, p_key text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  update travel_routing_settings set google_maps_api_key = nullif(btrim(p_key), ''), updated_at = now() where id = 1;
  perform log_audit('GOOGLE_MAPS_API_KEY_UPDATED', case when nullif(btrim(p_key), '') is null then 'cleared' else 'set' end, 'admin');
end;
$function$;

grant execute on function public.admin_set_google_maps_api_key(uuid, text) to anon;

-- Replaces admin_get_ors_api_key_status (return shape changes — drop+recreate, same
-- reason 0036 first dropped fetch_directory: can't change a returns-table column list
-- with plain create or replace).
drop function if exists public.admin_get_ors_api_key_status(uuid);

create or replace function public.admin_get_routing_key_status(p_token uuid)
 returns table(ors_is_set boolean, google_is_set boolean, updated_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query select
    (ors_api_key is not null and btrim(ors_api_key) <> ''),
    (google_maps_api_key is not null and btrim(google_maps_api_key) <> ''),
    travel_routing_settings.updated_at
    from travel_routing_settings where id = 1;
end;
$function$;

grant execute on function public.admin_get_routing_key_status(uuid) to anon;
