"""Small live capability check using public Lagos fixtures; never prints the token."""
from pathlib import Path

import httpx
from dotenv import dotenv_values

config = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
token = config.get("MAPBOX_PUBLIC_TOKEN")
if not token:
    raise SystemExit("MAPBOX_PUBLIC_TOKEN is missing.")

try:
    with httpx.Client(timeout=20, headers={"Referer": "http://localhost:8001/"}) as client:
        result = client.get("https://api.mapbox.com/search/geocode/v6/forward", params={
            "q": "Herbert Macaulay Way, Yaba, Lagos", "country": "ng",
            "bbox": "2.65,6.2,4.15,6.9", "limit": 5, "access_token": token,
        })
        print("Geocoding HTTP:", result.status_code)
        if result.status_code == 200:
            data = result.json()
            print("Matching features:", len(data.get("features", [])))
            print("Feature types:", [feature.get("properties", {}).get("feature_type") for feature in data.get("features", [])])
        for profile in ("walking", "driving"):
            result = client.get(f"https://api.mapbox.com/directions/v5/mapbox/{profile}/3.374,6.5094;3.3796,6.5182", params={
                "geometries": "geojson", "overview": "full", "steps": "false", "access_token": token,
            })
            print(profile, "HTTP:", result.status_code)
            if result.status_code == 200:
                data = result.json()
                routes = data.get("routes", [])
                print("Routes:", len(routes))
                if routes:
                    print("Distance metres:", routes[0].get("distance"), "duration seconds:", routes[0].get("duration"), "geometry points:", len(routes[0].get("geometry", {}).get("coordinates", [])))
except (httpx.HTTPError, ValueError, TypeError):
    raise SystemExit("Mapbox capability check failed; provider details and credentials omitted.")
