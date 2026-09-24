import json
from unittest.mock import patch

import httpx
from django.test import SimpleTestCase, Client, TestCase, override_settings
from django.urls import reverse

from .navigation import NavigationError, calculate_route, search_places
from .local_places import DEMO_DESTINATION, local_matches, normalize_query
from .demo import seed_demo


VALID = {"origin_lng":3.374,"origin_lat":6.5094,"destination_lng":3.3796,"destination_lat":6.5182,"mode":"walking"}
RESPONSE = {"code":"Ok","routes":[{"distance":1900,"duration":1400,"geometry":{"type":"LineString","coordinates":[[3.374,6.5094],[3.376,6.514],[3.3796,6.5182]]}}],"waypoints":[{"distance":10},{"distance":20}]}


class NavigationTests(SimpleTestCase):
    def post_route(self, data):
        return self.client.post(reverse("route-api"), json.dumps(data), content_type="application/json")

    @patch("reports.navigation.httpx.get")
    def test_real_provider_geometry_is_returned_without_credential_fields(self, get):
        get.return_value=httpx.Response(200,json=RESPONSE)
        response=self.post_route(VALID)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()["route"]["source"],"mapbox")
        self.assertEqual(response.json()["route"]["geometry"]["coordinates"],RESPONSE["routes"][0]["geometry"]["coordinates"])
        self.assertNotIn("access_token",response.content.decode())
        self.assertIn("no-store",response["Cache-Control"])

    @patch("reports.navigation.httpx.get")
    def test_bad_modes_nan_and_outside_area_do_not_reach_provider(self, get):
        for data in [{**VALID,"mode":"flying"},{**VALID,"origin_lat":float("nan")},{**VALID,"origin_lng":30,"origin_lat":-1.9},[]]:
            self.assertEqual(self.post_route(data).status_code,400)
        get.assert_not_called()

    def test_route_posts_require_csrf(self):
        browser=Client(enforce_csrf_checks=True)
        self.assertEqual(browser.post(reverse("route-api"),json.dumps(VALID),content_type="application/json").status_code,403)

    @patch("reports.navigation.httpx.get")
    def test_provider_failure_does_not_fabricate_a_route(self, get):
        get.side_effect=httpx.ConnectError("private provider details")
        response=self.post_route(VALID)
        self.assertEqual(response.status_code,503)
        self.assertNotIn("route",response.json())
        self.assertNotIn("private provider details",response.content.decode())

    @patch("reports.navigation.provider_get")
    def test_no_route_and_bad_geometry_are_controlled_errors(self, get):
        get.return_value={"code":"NoRoute","routes":[]}
        with self.assertRaises(NavigationError) as raised:calculate_route([3.374,6.5094],[3.3796,6.5182],"driving")
        self.assertEqual(raised.exception.code,"no_route")
        get.return_value={"code":"Ok","routes":[{"distance":20,"duration":2,"geometry":{"type":"LineString","coordinates":[[3.3,6.5],[float("nan"),6.5]]}}]}
        with self.assertRaises(NavigationError) as raised:calculate_route([3.374,6.5094],[3.3796,6.5182],"driving")
        self.assertEqual(raised.exception.code,"invalid_response")

    @patch("reports.navigation.provider_get")
    def test_search_discards_unplaced_or_out_of_scope_results(self, get):
        get.return_value={"features":[{"id":"ok","geometry":{"coordinates":[3.37,6.51]},"properties":{"full_address":"Herbert Macaulay Way, Lagos"}},{"geometry":None,"properties":{}},{"geometry":{"coordinates":[30,-1.9]},"properties":{"full_address":"Outside"}}]}
        places=search_places("Herbert Macaulay Way")
        self.assertEqual(len(places),1)
        self.assertEqual(places[0]["id"],"ok")

    @patch("reports.navigation.httpx.get")
    def test_short_search_does_not_call_provider(self, get):
        self.assertEqual(self.client.get(reverse("place-search"),{"q":"ab"}).status_code,400)
        get.assert_not_called()

    @patch("reports.navigation.httpx.get")
    def test_reported_alagomeji_query_has_a_named_attributed_result(self, get):
        response=self.client.get(reverse("place-search"),{"q":"Alagomeji route"})
        self.assertEqual(response.status_code,200)
        places=response.json()["places"]
        self.assertEqual(places[0]["id"],"local-alagomeji")
        self.assertEqual(places[0]["coordinates"],DEMO_DESTINATION["coordinates"])
        self.assertIn("bus stop",places[0]["label"])
        self.assertEqual(places[0]["source"],"local_landmark")
        self.assertIn("openstreetmap.org",places[0]["source_url"])
        get.assert_not_called()

    def test_local_lookup_handles_intent_words_without_relabeling_other_streets(self):
        for query in ("Alagomeji", "ALAGOMEJI ROUTE", "route to Alagomeji", "Alagomeji, Lagos", "Alago Meji"):
            self.assertEqual(local_matches(query)[0]["id"],"local-alagomeji")
        self.assertEqual(local_matches("Yaba Road"),[])
        self.assertEqual(normalize_query("Herbert Macaulay Way"),"Herbert Macaulay Way")

    @override_settings(DEMO_ENABLED=False)
    @patch("reports.views.calculate_route")
    def test_prepared_demo_is_not_used_when_demo_data_is_disabled(self, calculate):
        response=self.post_route({**VALID,"demo_route":True})
        self.assertEqual(response.status_code,422)
        calculate.assert_not_called()


class PreparedDemoRouteTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_demo()

    @patch("reports.views.calculate_route")
    def test_demo_route_uses_existing_fictional_incident_as_waypoint(self, calculate):
        calculate.return_value={"source":"mapbox","geometry":RESPONSE["routes"][0]["geometry"]}
        response=self.client.post(reverse("route-api"),json.dumps({**VALID,"demo_route":True}),content_type="application/json")
        self.assertEqual(response.status_code,200)
        self.assertTrue(response.json()["route"]["demo_route"])
        self.assertEqual(calculate.call_args.kwargs["via"],[3.3757,6.5121])
