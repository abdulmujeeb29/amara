"""Validated, transient Mapbox navigation requests. No location history is stored."""
import math

import httpx
from django.conf import settings

from .local_places import local_matches, normalize_query

LAGOS_BOUNDS = (2.65, 6.2, 4.15, 6.9)


class NavigationError(Exception):
    def __init__(self, message, code="provider_unavailable", status=503):
        super().__init__(message)
        self.code = code
        self.status = status


def valid_point(point):
    return (
        isinstance(point, (list, tuple)) and len(point) >= 2
        and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in point[:2])
        and -180 <= point[0] <= 180 and -90 <= point[1] <= 90
    )


def in_lagos(point):
    west, south, east, north = LAGOS_BOUNDS
    return valid_point(point) and west <= point[0] <= east and south <= point[1] <= north


def provider_get(path, params):
    token = settings.MAPBOX_PUBLIC_TOKEN
    if not token.startswith("pk."):
        raise NavigationError("Address and route search are not configured yet.", "not_configured")
    try:
        result = httpx.get(
            "https://api.mapbox.com/" + path,
            params={**params, "access_token": token},
            headers={"Referer": settings.PUBLIC_ORIGIN + "/"}, timeout=12,
        )
        if result.status_code == 429:
            raise NavigationError("The route service is busy. Please try again shortly.", "rate_limited")
        if result.status_code != 200:
            raise NavigationError("The map service could not complete this request. Please try again.")
        return result.json()
    except (httpx.HTTPError, ValueError, TypeError) as error:
        raise NavigationError("The map service is unavailable. Your existing briefing is still available.") from error


def search_places(query):
    query = normalize_query(query)
    if len(query) < 3:
        return []
    local = local_matches(query)
    if local:
        return local
    data = provider_get("search/geocode/v6/forward", {
        "q": query, "country": "ng", "bbox": ",".join(map(str, LAGOS_BOUNDS)),
        "limit": 6, "autocomplete": "true", "language": "en",
    })
    if not isinstance(data, dict) or not isinstance(data.get("features"), list):
        raise NavigationError("Address search returned an unreadable result.", "invalid_response")
    places = []
    for feature in data["features"][:6]:
        if not isinstance(feature, dict):
            continue
        geometry, properties = feature.get("geometry"), feature.get("properties")
        if not isinstance(geometry, dict) or not isinstance(properties, dict):
            continue
        point = geometry.get("coordinates")
        if not in_lagos(point):
            continue
        label = properties.get("full_address") or ", ".join(filter(None, [properties.get("name"), properties.get("place_formatted")]))
        if not isinstance(label, str) or not label.strip():
            continue
        places.append({"id": str(feature.get("id", ""))[:180], "label": label[:300], "coordinates": list(point[:2]), "source": "mapbox", "source_label": "Mapbox address result"})
    return places


def calculate_route(origin, destination, mode, via=None):
    if mode not in {"walking", "driving"} or not in_lagos(origin) or not in_lagos(destination) or (via is not None and not in_lagos(via)):
        raise NavigationError("Choose a starting point and destination within Lagos.", "outside_area", 400)
    requested_points = [origin, *([via] if via is not None else []), destination]
    coordinates = ";".join(f"{point[0]:.6f},{point[1]:.6f}" for point in requested_points)
    data = provider_get(f"directions/v5/mapbox/{mode}/{coordinates}", {
        "geometries": "geojson", "overview": "full", "steps": "false", "alternatives": "false",
    })
    if not isinstance(data, dict) or data.get("code") not in {None, "Ok"} or not data.get("routes"):
        raise NavigationError("No route was found for these points and travel mode. Choose another point.", "no_route", 422)
    try:
        route = data["routes"][0]
        geometry = route["geometry"]
        points = geometry["coordinates"]
        distance, duration = route["distance"], route["duration"]
        if geometry["type"] != "LineString" or not isinstance(points, list) or not 2 <= len(points) <= 25000:
            raise ValueError()
        if not all(valid_point(point) for point in points):
            raise ValueError()
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0 for v in (distance, duration)):
            raise ValueError()
        if distance > 200000:
            raise NavigationError("This route is outside the prototype’s local journey range.", "route_too_long", 422)
        snap_distances = [waypoint.get("distance", 0) for waypoint in data.get("waypoints", [])[:len(requested_points)]]
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in snap_distances):
            raise ValueError()
        if any(v > 1000 for v in snap_distances):
            raise NavigationError("A routable road is too far from a selected point. Pick a nearby street.", "snap_too_far", 422)
    except (KeyError, TypeError, ValueError, IndexError) as error:
        raise NavigationError("The route service returned an unreadable route.", "invalid_response") from error
    return {
        "source": "mapbox", "mode": mode, "origin": origin, "destination": destination,
        "geometry": {"type": "LineString", "coordinates": [list(point[:2]) for point in points]},
        "distance_m": distance, "duration_s": duration, "snap_distances_m": snap_distances,
        "via": via,
    }
