"""Prepare once, then serve immutable route/evidence snapshots for the demo."""
from concurrent.futures import ThreadPoolExecutor
import copy
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.urls import reverse
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .contracts import incident_data, report_data
from .evidence import add_demo_stage, analyze, new_demo_case
from .evidence_policy import decide
from .local_places import DEMO_DESTINATION, DEMO_ORIGIN
from .models import Incident, Preference, PreparedDemo
from .navigation import calculate_route


def reviewed_snapshot(case, reports, public_id):
    analysis = analyze(case, reports)
    decision = decide(analysis, reports)
    snapshot = incident_data(case)
    snapshot.update({
        "id": public_id, "status": decision["status"],
        "status_label": "Confirmed by " + decision["confirmation_source"] if decision["status"] == "confirmed" else decision["status"].capitalize(),
        "summary": " ".join(statement["text"] for statement in analysis["statements"]),
        "uncertainty": " ".join(analysis["uncertainties"]), "condition": analysis["condition"],
        "observed_at": max((parse_datetime(value) for value in decision["observations"]), default=None),
        "is_demo": True, "report_ids": [report.code for report in reports], "review_state": "reviewed",
    })
    if snapshot["observed_at"] is not None: snapshot["observed_at"] = snapshot["observed_at"].isoformat()
    prepared_at = timezone.now().isoformat()
    snapshot["analyzed_at"] = prepared_at
    sources = []
    for report in reports:
        source = report_data(report)
        source["detail_url"] = "#source-" + report.code
        source["incident_id"] = public_id
        sources.append(source)
    return {"incident": snapshot, "analysis": analysis, "decision": decision, "sources": sources,
        "model": settings.AZURE_OPENAI_DEPLOYMENT, "prepared_at": prepared_at}


def prepare_demo(refresh=False):
    existing = PreparedDemo.objects.filter(active=True).first()
    if existing and not refresh: return existing, False
    if not settings.DEMO_ENABLED:
        raise ValidationError("Enable the fictional demonstration dataset before preparation.")
    # This dedicated preparation identity is not connected to a browser's private case.
    pref = Preference.objects.create(visitor_id=uuid.uuid4())
    market = new_demo_case(pref)
    roadworks = Incident.objects.get(slug="herbert-macaulay-roadworks", case_owner__isnull=True, is_demo=True)
    baseline = list(market.reports.select_related("origin").order_by("published_at", "pk"))
    roads = list(roadworks.reports.select_related("origin").order_by("published_at", "pk"))
    add_demo_stage(market, "support")
    supporting = list(market.reports.select_related("origin").order_by("published_at", "pk"))
    routes = {mode: calculate_route(DEMO_ORIGIN["coordinates"], DEMO_DESTINATION["coordinates"], mode,
        via=[market.longitude, market.latitude]) for mode in ("walking", "driving")}
    with ThreadPoolExecutor(max_workers=2) as pool:
        work = {
            "roadworks": pool.submit(reviewed_snapshot, roadworks, roads, "replay-roadworks"),
            "market-initial": pool.submit(reviewed_snapshot, market, baseline, "replay-market"),
            "market-support": pool.submit(reviewed_snapshot, market, supporting, "replay-market"),
        }
        results = {key: future.result() for key, future in work.items()}
    if results["market-initial"]["decision"]["status"] != "unconfirmed" or results["market-support"]["decision"]["status"] != "corroborated":
        raise ValidationError("Prepared AI results did not establish the intended evidence progression. No replay was published.")
    key = "lagos-" + uuid.uuid4().hex[:16]
    specs = [
        ("roadworks", 8000, "Roadworks report received", "Two accounts describe roadworks along the route. They have not yet been reviewed in this replay.", [r.code for r in roads]),
        ("market-initial", 22000, "Possible roadblock reported", "Three messages mention the same possible obstruction. Their source relationship is being checked.", [r.code for r in baseline]),
        ("market-support", 48000, "New eyewitness accounts received", "Two new accounts are being compared with the earlier roadblock report.", [r.code for r in supporting if r.code not in {b.code for b in baseline}]),
    ]
    events = []
    for event_key, at_ms, title, incoming_text, incoming_ids in specs:
        result = results[event_key]
        url = reverse("demo-evidence", args=[key, event_key])
        result["incident"]["detail_url"] = url
        result["incident"]["revision"] = 2 if event_key == "market-support" else 1
        events.append({"key": event_key, "at_ms": at_ms, "review_after_ms": 3500,
            "received_title": title, "received_text": incoming_text, "incoming_source_ids": incoming_ids,
            "result": result, "detail_url": url})
    payload = {"schema_version": 1, "mode": "demo_replay", "key": key, "model": settings.AZURE_OPENAI_DEPLOYMENT,
        "prepared_at": timezone.now().isoformat(), "origin": dict(DEMO_ORIGIN), "destination": dict(DEMO_DESTINATION),
        "routes": routes, "events": events, "duration_ms": 80000}
    # Aliases are an internal lookup aid, not part of the published demo contract.
    payload["origin"].pop("aliases", None); payload["destination"].pop("aliases", None)
    with transaction.atomic():
        list(PreparedDemo.objects.select_for_update().filter(active=True))
        PreparedDemo.objects.filter(active=True).update(active=False)
        result = PreparedDemo.objects.create(key=key, payload=payload, model_name=settings.AZURE_OPENAI_DEPLOYMENT)
    return result, True


def replay_event(pack, event_key):
    return next((copy.deepcopy(event) for event in pack.payload["events"] if event["key"] == event_key), None)
