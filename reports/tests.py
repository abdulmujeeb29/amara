from unittest.mock import patch

import httpx
from django.core.exceptions import ValidationError
from django.db import IntegrityError, OperationalError, transaction
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from .demo import at, seed_demo
from .models import Incident, Preference, Report


class FoundationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_demo()

    def test_seed_is_idempotent_and_preserves_edits(self):
        incident = Incident.objects.get(slug="market-junction")
        incident.title = "Reviewed fixture title"
        incident.save(update_fields=["title"])
        self.assertEqual(seed_demo(), 0)
        self.assertEqual(Incident.objects.count(), 3)
        self.assertEqual(Report.objects.count(), 6)
        incident.refresh_from_db()
        self.assertEqual(incident.title, "Reviewed fixture title")

    def test_unknown_observation_time_and_origin_chain_survive_storage(self):
        data = self.client.get(reverse("incident-detail-api", args=["market-junction"])).json()
        self.assertIsNone(data["incident"]["observed_at"])
        self.assertEqual(data["incident"]["status"], "unconfirmed")
        self.assertEqual(len(data["reports"]), 3)
        self.assertEqual(data["reports"][1]["origin_id"], "demo-r1")
        self.assertEqual(data["reports"][2]["origin_id"], "demo-r2")

    def test_server_rendered_alert_and_source_work_without_javascript(self):
        response = self.client.get(reverse("overview"))
        self.assertContains(response, "Roadblock reported near the market")
        self.assertContains(response, reverse("incident", args=["market-junction"]))
        response = self.client.get(reverse("source", args=["demo-r1"]))
        self.assertContains(response, "My cousin says vehicles are being stopped")
        self.assertContains(response, "Not supplied")
        self.assertContains(response, "FICTIONAL")

    def test_partial_navigation_preserves_contract(self):
        response = self.client.get(reverse("incident", args=["market-junction"]), HTTP_X_AMARA_PARTIAL="1")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("What remains unclear", data["html"])
        self.assertEqual(data["map_state"]["selected_incident"], "market-junction")
        self.assertEqual(data["section"], "incident")
        self.assertIn("no-store", response["Cache-Control"])

    def test_private_keys_are_not_in_html_or_public_contracts(self):
        for url in [reverse("overview"), reverse("incident-api"), reverse("map-config")]:
            response = self.client.get(url)
            self.assertNotContains(response, "private-azure-test-value")
            self.assertNotContains(response, "private-search-test-value")
        self.assertEqual(self.client.get(reverse("map-config")).json(), {"mapboxToken": "pk.test-public-token"})
        with override_settings(MAPBOX_PUBLIC_TOKEN="sk.must-stay-private"):
            self.assertEqual(self.client.get(reverse("map-config")).json(), {"mapboxToken": ""})

    def test_untrusted_titles_and_destinations_are_escaped(self):
        incident = Incident.objects.get(slug="market-junction")
        incident.title = '<script>alert("unsafe")</script>'
        incident.save(update_fields=["title"])
        response = self.client.get(reverse("incident", args=[incident.slug]))
        self.assertNotContains(response, incident.title)
        self.assertContains(response, "&lt;script&gt;")
        payload = '</script><img src=x onerror=alert(1)>'
        response = self.client.get(reverse("journey"), {"mode": "walking", "step": "review", "destination": payload})
        self.assertNotContains(response, payload)
        self.assertContains(response, "&lt;/script&gt;")

    def test_invalid_journey_mode_returns_validation_not_server_error(self):
        response = self.client.get(reverse("journey"), {"mode": "flying", "step": "review", "destination": "Home"})
        self.assertEqual(response.status_code, 400)
        self.assertContains(response, "Select a valid choice", status_code=400)

    def test_preferences_persist_and_are_isolated_between_visitors(self):
        self.client.get(reverse("following"))
        visitor = self.client.session["visitor_id"]
        response = self.client.post(reverse("save-preferences"), {"travel_mode": "walking", "muted": "on"})
        self.assertEqual(response.status_code, 302)
        saved = Preference.objects.get(visitor_id=visitor)
        self.assertFalse(saved.follow_market_road)
        self.assertTrue(saved.muted)
        self.assertEqual(saved.travel_mode, "walking")
        self.assertContains(self.client.get(reverse("journey")), 'value="walking" checked')
        other = Client()
        self.assertContains(other.get(reverse("journey")), 'value="driving" checked')
        self.assertNotEqual(other.session["visitor_id"], visitor)

    def test_preference_write_requires_csrf(self):
        browser = Client(enforce_csrf_checks=True)
        browser.get(reverse("following"))
        response = browser.post(reverse("save-preferences"), {"travel_mode": "walking"})
        self.assertEqual(response.status_code, 403)
        response = browser.post(reverse("save-preferences"), {"travel_mode": "walking"}, HTTP_X_CSRFTOKEN=browser.cookies["csrftoken"].value)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.get(reverse("save-preferences")).status_code, 405)

    def test_preferences_do_not_redirect_to_an_external_site(self):
        response = self.client.post(reverse("save-preferences"), {"travel_mode": "driving", "next": "https://example.org/"})
        self.assertEqual(response.url, reverse("following"))

    def test_confirmation_requires_named_source(self):
        incident = Incident.objects.get(slug="market-junction")
        incident.status = "confirmed"
        with self.assertRaises(ValidationError):
            incident.full_clean()
        with self.assertRaises(IntegrityError), transaction.atomic():
            incident.save()

    def test_mixed_demo_live_evidence_is_rejected_and_hidden(self):
        incident = Incident.objects.create(slug="live-incident", title="Live claim", summary="Unknown", uncertainty="Unknown", location_name="Lagos", updated_at=at("18:40"), is_demo=False)
        report = Report(incident=incident, code="bad-demo", source_name="Invalid", original_text="Invalid", relationship="Unknown", published_at=at("18:40"), is_demo=True)
        with self.assertRaises(ValidationError):
            report.full_clean()
        report.save()  # Simulate externally corrupted data; public views must still isolate it.
        self.assertEqual(self.client.get(reverse("source", args=[report.code])).status_code, 404)
        self.assertNotContains(self.client.get(reverse("incident-api")), "live-incident")

    def test_unpaired_coordinates_fail_database_constraint(self):
        incident = Incident.objects.get(slug="market-junction")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Incident.objects.filter(pk=incident.pk).update(latitude=None)

    def test_liveness_and_database_readiness_are_distinct(self):
        self.assertEqual(self.client.get(reverse("health")).status_code, 200)
        self.assertEqual(self.client.get(reverse("ready")).status_code, 200)
        with patch("reports.views.Incident.objects.exists", side_effect=OperationalError("unavailable")):
            self.assertEqual(self.client.get(reverse("ready")).status_code, 503)
            self.assertEqual(self.client.get(reverse("health")).status_code, 200)

    def test_invalid_tile_bounds_make_no_provider_request(self):
        with patch("reports.views.httpx.get") as provider:
            response = self.client.get(reverse("raster-tile", args=[2, 99, 0]))
            self.assertEqual(response.status_code, 400)
            provider.assert_not_called()

    def test_tile_outage_does_not_break_evidence_pages(self):
        with patch("reports.views.httpx.get", side_effect=httpx.ConnectError("unavailable")):
            self.assertEqual(self.client.get(reverse("raster-tile", args=[16, 33382, 31579])).status_code, 502)
        self.assertContains(self.client.get(reverse("overview")), "See the evidence")
