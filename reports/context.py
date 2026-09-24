from django.conf import settings
from django.templatetags.static import static


def shell(request):
    from .views import data_mode, preference
    mode = data_mode(request)
    return {
        "demo_enabled": mode == "demo",
        "data_mode": mode,
        "app_config": {
            "phase": "4+5",
            "is_demo": mode == "demo",
            "data_mode": mode,
            "has_demo_case": bool(preference(request).active_demo_case_id),
            "map_config_url": "/api/map-config/",
            "mapbox_js": static("vendor/mapbox-gl.js"),
            "mapbox_compat_js": static("vendor/mapbox-compat.js"),
            "raster_url": "/raster/{z}/{x}/{y}.png",
            "places_url": "/api/places/",
            "routes_url": "/api/routes/",
            "demo_scenario_url": "/api/demo/scenario/",
            "lagos_bounds": [2.65, 6.2, 4.15, 6.9],
            "feed_url": "/api/updates/",
            "evidence_jobs_url": "/api/evidence/jobs/",
        },
    }
