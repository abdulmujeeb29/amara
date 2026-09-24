from datetime import timedelta
import json
import uuid

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .contracts import incident_data
from .evidence import enqueue, new_demo_case
from .evidence_policy import EvidenceError, digest, normalized
from .models import EvidenceJob, Incident, IncidentUpdate, UpdateReceipt
from .views import data_mode, incidents, page, preference, scoped_incidents


def response(data, status=200):
    result = JsonResponse(data, status=status)
    result["Cache-Control"] = "private, no-store"
    return result


@require_GET
def evidence_page(request):
    pref = preference(request)
    return page(request, "pages/evidence.html", section="evidence", title="Check the evidence", context={"active_case": pref.active_demo_case})


@require_POST
def create_job(request):
    try:
        data = json.loads(request.body)
        if not isinstance(data, dict): raise ValueError()
        action = data.get("action")
        if not isinstance(action, str): raise ValueError()
        with transaction.atomic():
            pref = preference(request)
            if action == "new_demo":
                if not settings.DEMO_ENABLED:
                    raise EvidenceError("demo_disabled", "The demonstration dataset is disabled.")
                case = new_demo_case(pref)
                request.session["evidence_mode"] = "demo"
                job = enqueue(pref.visitor_id, case, "demo", {"stage": "baseline"})
            elif action in {"support", "conflict", "clearance", "reanalyze", "submit"}:
                case = pref.active_demo_case
                if not case or case.case_owner != pref.visitor_id:
                    raise EvidenceError("no_case", "Start an AI demonstration first.")
                if action == "submit":
                    text = data.get("text")
                    if not isinstance(text, str) or not 20 <= len(text.strip()) <= 6000:
                        raise EvidenceError("invalid_input", "Enter a report between 20 and 6,000 characters.")
                    job = enqueue(pref.visitor_id, case, "submit", {"text": text.strip()})
                else:
                    job = enqueue(pref.visitor_id, case, "demo", {"stage": action})
            elif action == "search":
                query = data.get("query")
                if not isinstance(query, str) or not 10 <= len(query.strip()) <= 180:
                    raise EvidenceError("invalid_input", "Describe a focused incident or road question in 10–180 characters.")
                key = digest([str(pref.visitor_id), normalized(query), timezone.localdate().isoformat()])[:24]
                case, _ = Incident.objects.get_or_create(slug="public-check-" + key, defaults={"case_owner": pref.visitor_id,
                    "title": query.strip(), "summary": "Public reports have not been analyzed yet.", "uncertainty": "Current conditions are unknown.",
                    "location_name": "Yaba, Lagos · exact incident location unresolved", "updated_at": timezone.now(), "is_demo": False})
                job = enqueue(pref.visitor_id, case, "search", {"query": query.strip()})
            else:
                raise EvidenceError("invalid_action", "Choose a supported evidence check.")
        return response({"job_id": str(job.pk), "status_url": reverse("evidence-job", args=[job.pk]), "incident_id": case.slug, "data_mode": "demo" if case.is_demo else "live"}, 202)
    except (ValueError, UnicodeDecodeError):
        return response({"error": "Send a valid evidence request."}, 400)
    except IntegrityError:
        return response({"error": "This incident is already being checked.", "code": "already_processing"}, 409)
    except EvidenceError as error:
        return response({"error": str(error), "code": error.code}, 429 if error.code == "rate_limited" else 409 if error.code == "already_processing" else 400)


@require_GET
def job_status(request, job_id):
    job = get_object_or_404(EvidenceJob.objects.select_related("incident"), pk=job_id, owner_id=preference(request).visitor_id)
    result = {key: value for key, value in job.result.items() if key != "analysis"}
    summary = job.result.get("summary") or " ".join(item["text"] for item in job.result.get("analysis", {}).get("statements", []))
    if not summary and job.result.get("no_sources"):
        summary = "No usable public reports were found for this query."
    return response({"id": str(job.pk), "status": job.status, "progress": job.progress, "error_code": job.error_code,
        "result": result, "incident_id": job.incident.slug, "data_mode": "demo" if job.incident.is_demo else "live",
        "detail_url": reverse("incident", args=[job.incident.slug]), "summary": summary if job.status == "succeeded" else ""})


@require_POST
def switch_mode(request):
    try:
        mode = json.loads(request.body).get("mode")
        if mode not in {"demo", "live"} or (mode == "demo" and not settings.DEMO_ENABLED): raise ValueError()
    except (ValueError, AttributeError, TypeError):
        return response({"error": "Choose demo or public-source mode."}, 400)
    request.session["evidence_mode"] = mode
    return response({"mode": mode})


@require_GET
def update_feed(request):
    try:
        after = max(0, int(request.GET.get("after", "0")))
    except ValueError:
        return response({"error": "Invalid update cursor."}, 400)
    pref = preference(request)
    visible = list(incidents(request))
    ids = [incident.pk for incident in visible]
    updates = list(IncidentUpdate.objects.filter(incident_id__in=ids, pk__gt=after).select_related("incident").order_by("pk")[:50])
    receipts = {receipt.update_id: receipt for receipt in UpdateReceipt.objects.filter(visitor_id=pref.visitor_id, update__in=updates)}
    prior_incidents = set(UpdateReceipt.objects.filter(visitor_id=pref.visitor_id, delivered_at__isnull=False, update__incident_id__in=ids).values_list("update__incident_id", flat=True))
    events = []
    for update in updates:
        receipt = receipts.get(update.pk)
        events.append({"id": update.pk, "revision": update.revision, "reason": update.reason,
            "created_at": update.created_at.isoformat(), "incident": update.snapshot,
            "delivered": bool(receipt and receipt.delivered_at), "read": bool(receipt and receipt.read_at),
            "dismissed": bool(receipt and receipt.dismissed_at), "delivery_context": receipt.context if receipt else None, "previously_notified": update.incident_id in prior_incidents})
    pending = EvidenceJob.objects.filter(owner_id=pref.visitor_id, status__in=["queued", "running"]).order_by("created_at").first()
    return response({"schema_version": 1, "mode": data_mode(request), "cursor": updates[-1].pk if updates else after,
        "incidents": [incident_data(incident) for incident in visible], "updates": events,
        "preferences": {"follow_market_road": pref.follow_market_road, "follow_yaba_area": pref.follow_yaba_area, "muted": pref.muted},
        "pending_job": str(pending.pk) if pending else None, "checked_at": timezone.now().isoformat()})


@require_POST
def update_receipt(request, update_id):
    pref = preference(request)
    update = get_object_or_404(IncidentUpdate.objects.select_related("incident"), pk=update_id, incident__in=scoped_incidents(request))
    try:
        body = json.loads(request.body)
        action = body.get("action")
        if action not in {"claim", "read", "dismiss"}: raise ValueError()
    except (ValueError, AttributeError, TypeError):
        return response({"error": "Choose a supported update action."}, 400)
    with transaction.atomic():
        receipt, _ = UpdateReceipt.objects.get_or_create(visitor_id=pref.visitor_id, update=update)
        receipt = UpdateReceipt.objects.select_for_update().get(pk=receipt.pk)
        if action == "claim":
            if pref.muted or receipt.delivered_at or receipt.dismissed_at:
                return response({"show": False})
            receipt.delivered_at = timezone.now()
            context = body.get("context", "area")
            receipt.context = context if isinstance(context, str) and context in {"route", "area", "followed_road"} else "area"
        elif action == "read": receipt.read_at = timezone.now()
        else: receipt.dismissed_at = timezone.now()
        receipt.save()
    return response({"show": action == "claim", "saved": True})
