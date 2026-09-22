-- plan.md §31 follow-up (2026-09-22) — real bug, not just "no key configured yet".
-- Once a genuine OpenRouteService key was set, every call still failed: ORS returned
-- 406 Not Acceptable ("Acceptable representations: [application/geo+json;charset=UTF-8]")
-- because road_distance_km() sent `Accept: application/json`, not the more specific
-- content type ORS's v2 directions endpoint actually requires. Confirmed the fix live
-- against Puneet Sharma's real coordinates before applying: with the corrected header,
-- ORS returned a real route, 16.7km (app's old straight-line estimate was 10.7km, and
-- close to the ~15km seen on Google Maps — small cross-engine differences are normal).
--
-- Same function, same signature, only the Accept header text changes.

create or replace function public.road_distance_km(p_lat1 numeric, p_lon1 numeric, p_lat2 numeric, p_lon2 numeric)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_key text;
  v_resp extensions.http_response;
  v_url text;
  v_meters numeric;
begin
  select ors_api_key into v_key from travel_routing_settings where id = 1;
  if v_key is null or btrim(v_key) = '' then
    return null; -- no key configured yet — caller keeps showing the haversine estimate
  end if;

  v_url := format(
    'https://api.openrouteservice.org/v2/directions/driving-car?api_key=%s&start=%s,%s&end=%s,%s',
    v_key, p_lon1, p_lat1, p_lon2, p_lat2
  );

  begin
    select * into v_resp from extensions.http((
      'GET', v_url,
      array[extensions.http_header('Accept', 'application/geo+json; charset=UTF-8')],
      null, null
    )::extensions.http_request);
  exception when others then
    return null; -- road distance is a refinement, never the reason anything fails
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
