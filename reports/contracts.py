"""Versioned public contracts. Values come from validated ORM records."""
from django.urls import reverse


def iso(value):
    return value.isoformat() if value is not None else None


def report_data(report):
    return {
        "id": report.code, "incident_id": report.incident.slug,
        "source_name": report.source_name, "original_text": report.original_text,
        "relationship": report.relationship, "origin_id": report.origin.code if report.origin else None,
        "observed_at": iso(report.observed_at), "published_at": iso(report.published_at),
        "source_url": report.source_url or None, "detail_url": reverse("source", args=[report.code]),
        "is_demo": report.is_demo,
        "content_kind": report.content_kind, "retrieved_at": iso(report.retrieved_at),
        "assessment": report.assessment,
    }


def incident_data(incident):
    return {
        "id": incident.slug, "title": incident.title, "summary": incident.summary,
        "uncertainty": incident.uncertainty, "location_name": incident.location_name,
        "coordinates": [incident.longitude, incident.latitude] if incident.longitude is not None else None,
        "status": incident.status, "status_label": incident.status_label,
        "confirmation_source": incident.confirmation_source or None,
        "observed_at": iso(incident.observed_at), "updated_at": iso(incident.updated_at),
        "revision": incident.revision, "is_demo": incident.is_demo,
        "detail_url": reverse("incident", args=[incident.slug]),
        "report_ids": [r.code for r in incident.reports.all()],
        "template_slug": incident.template_slug, "area_scope": incident.area_scope,
        "condition": incident.condition, "analyzed_at": iso(incident.analyzed_at),
        "has_relevant_evidence": incident.evidence.get("decision", {}).get("has_relevant_evidence", True),
    }
