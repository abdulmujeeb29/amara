from django.urls import path

from . import views, evidence_views, replay_views

urlpatterns = [
    path("", views.overview, name="overview"),
    path("incidents/<slug:slug>/", views.incident_detail, name="incident"),
    path("sources/<slug:code>/", views.source_detail, name="source"),
    path("journey/", views.journey, name="journey"),
    path("updates/", views.updates, name="updates"),
    path("following/", views.following, name="following"),
    path("settings/", views.preferences_page, name="settings"),
    path("preferences/", views.save_preferences, name="save-preferences"),
    path("api/incidents/", views.incident_api, name="incident-api"),
    path("api/incidents/<slug:slug>/", views.incident_api, name="incident-detail-api"),
    path("api/map-config/", views.map_config, name="map-config"),
    path("api/demo/scenario/", replay_views.scenario, name="demo-scenario"),
    path("demo/evidence/<slug:key>/<slug:event_key>/", replay_views.evidence, name="demo-evidence"),
    path("evidence/", evidence_views.evidence_page, name="evidence"),
    path("api/evidence/jobs/", evidence_views.create_job, name="create-evidence-job"),
    path("api/evidence/jobs/<uuid:job_id>/", evidence_views.job_status, name="evidence-job"),
    path("api/evidence/mode/", evidence_views.switch_mode, name="evidence-mode"),
    path("api/updates/", evidence_views.update_feed, name="update-feed"),
    path("api/updates/<int:update_id>/receipt/", evidence_views.update_receipt, name="update-receipt"),
    path("api/places/", views.place_search, name="place-search"),
    path("api/routes/", views.route_api, name="route-api"),
    path("raster/<int:z>/<int:x>/<int:y>.png", views.raster_tile, name="raster-tile"),
    path("healthz/", views.health, name="health"),
    path("readyz/", views.ready, name="ready"),
]
