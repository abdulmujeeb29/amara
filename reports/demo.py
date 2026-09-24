from datetime import datetime
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError
from django.db import transaction

from .models import Incident, Report

ORIGIN = [3.3740, 6.5094]
DESTINATION = [3.3796, 6.5182]
ROUTES = {
    "driving": [ORIGIN, [3.3730, 6.5105], [3.3757, 6.5121], [3.3772, 6.5145], [3.3777, 6.5161], DESTINATION],
    "walking": [ORIGIN, [3.3753, 6.5108], [3.3774, 6.5134], [3.3781, 6.5157], DESTINATION],
}


def at(time):
    return datetime.fromisoformat(f"2026-09-22T{time}:00").replace(tzinfo=ZoneInfo("Africa/Lagos"))


@transaction.atomic
def seed_demo():
    """Insert namespaced fixtures idempotently; never overwrite existing records."""
    created_count = 0
    definitions = [
        {
            "slug": "market-junction", "title": "Roadblock reported near the market",
            "summary": "Three messages mention an obstruction at Market Junction. They trace back to one account, with no independent confirmation yet.",
            "uncertainty": "When the original observation happened, whether it was firsthand, and whether the road is currently obstructed.",
            "location_name": "Market Junction · Yaba, Lagos", "longitude": 3.3757, "latitude": 6.5121,
            "status": "unconfirmed", "observed_at": None, "updated_at": at("18:35"),
            "sources": [
                ("demo-r1", "Original community message", "My cousin says vehicles are being stopped at Market Junction. I don’t know when they saw it.", "Secondhand · original account", None, "18:32", None),
                ("demo-r2", "Forwarded message", "Forwarding R1: someone’s cousin says vehicles are being stopped at Market Junction.", "Repeats R1 · not independent", None, "18:34", "demo-r1"),
                ("demo-r3", "Neighbourhood group repost", "Copied from the neighbourhood group: the same cousin’s report about Market Junction.", "Repeats R2 → R1", None, "18:35", "demo-r2"),
            ],
        },
        {
            "slug": "herbert-macaulay-roadworks", "title": "Roadworks on Herbert Macaulay Way",
            "summary": "Two independent fictional observers describe cones and a work crew along the road.",
            "uncertainty": "The extent of disruption and whether the work has finished.",
            "location_name": "Herbert Macaulay Way · Yaba, Lagos", "longitude": 3.3772, "latitude": 6.5145,
            "status": "corroborated", "observed_at": at("18:15"), "updated_at": at("18:20"),
            "sources": [
                ("demo-rw1", "Demo observer A", "I can see cones and a work crew on this stretch of Herbert Macaulay Way.", "Firsthand · independent in this fixture", "18:15", "18:18", None),
                ("demo-rw2", "Demo observer B", "A work crew and traffic cones are present on this stretch of road.", "Firsthand · independent in this fixture", "18:15", "18:20", None),
            ],
        },
        {
            "slug": "junction-traffic", "title": "Slow traffic at the junction",
            "summary": "One fictional observer reports slow-moving vehicles. No independent support is available.",
            "uncertainty": "The cause, duration, and current extent of the slow traffic.",
            "location_name": "Yaba, Lagos", "longitude": 3.3745, "latitude": 6.5110,
            "status": "unconfirmed", "observed_at": at("18:25"), "updated_at": at("18:28"),
            "sources": [("demo-t1", "Demo traffic observer", "Traffic is moving slowly here.", "Firsthand claim · unconfirmed", "18:25", "18:28", None)],
        },
    ]
    for definition in definitions:
        sources = definition.pop("sources")
        slug = definition.pop("slug")
        incident, created = Incident.objects.get_or_create(slug=slug, defaults={**definition, "is_demo": True})
        if not incident.is_demo:
            raise ValidationError("A demo fixture collides with a live incident. No records were changed.")
        incident.full_clean()
        created_count += int(created)
        for code, name, text, relationship, observed, published, origin_code in sources:
            origin = Report.objects.get(code=origin_code) if origin_code else None
            report, created = Report.objects.get_or_create(code=code, defaults={
                "incident": incident, "source_name": name, "original_text": text,
                "relationship": relationship, "observed_at": at(observed) if observed else None,
                "published_at": at(published), "origin": origin, "is_demo": True,
            })
            if report.incident_id != incident.id or not report.is_demo:
                raise ValidationError("A source fixture collides with unrelated data. No records were changed.")
            report.full_clean()
            created_count += int(created)
    return created_count
