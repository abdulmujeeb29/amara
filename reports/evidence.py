"""Bounded provider adapters, durable jobs, and atomic evidence publication."""
from datetime import timedelta
import json
import re
import uuid
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .contracts import incident_data
from .demo import at
from .evidence_policy import EvidenceError, decide, digest, normalized, validate_analysis
from .evidence_schema import INSTRUCTIONS, PROMPT_VERSION, SCHEMA
from .local_places import LANDMARKS
from .models import EvidenceJob, Incident, IncidentUpdate, Preference, Report


def canonical_url(value):
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        return ""
    query = [(key, val) for key, val in parse_qsl(parsed.query) if not key.lower().startswith("utm_") and key.lower() not in {"fbclid", "gclid"}]
    result = urlunsplit((parsed.scheme, parsed.netloc.lower(), parsed.path, urlencode(query), ""))
    return result if len(result) <= 2048 else ""


def add_report(incident, *, name, text, url="", published_at=None, observed_at=None, relationship="Origin not independently established", origin=None, content_kind="submitted", retrieved_at=None):
    text = text.strip()[:6000]
    fingerprint = digest([canonical_url(url) if url else name, normalized(text)])
    report, _ = Report.objects.get_or_create(incident=incident, fingerprint=fingerprint, defaults={
        "code": "e-" + uuid.uuid4().hex[:24], "source_name": name[:120], "original_text": text,
        "source_url": canonical_url(url) if url else "", "published_at": published_at,
        "observed_at": observed_at, "relationship": relationship[:180], "origin": origin,
        "content_kind": content_kind, "retrieved_at": retrieved_at, "is_demo": incident.is_demo,
    })
    report.full_clean()
    return report


@transaction.atomic
def new_demo_case(pref):
    template = Incident.objects.filter(slug="market-junction", case_owner__isnull=True, is_demo=True).first()
    if template is None:
        raise EvidenceError("demo_unavailable", "Seed the example reports before starting the AI demonstration.")
    case = Incident.objects.create(
        slug="demo-evidence-" + uuid.uuid4().hex[:16], case_owner=pref.visitor_id,
        template_slug="market-junction", title=template.title, summary=template.summary,
        uncertainty=template.uncertainty, location_name=template.location_name,
        longitude=template.longitude, latitude=template.latitude,
        updated_at=template.updated_at, is_demo=True,
    )
    copies = {}
    for source in template.reports.select_related("origin").order_by("published_at", "pk"):
        copies[source.pk] = add_report(case, name=source.source_name, text=source.original_text,
            published_at=source.published_at, observed_at=source.observed_at,
            relationship=source.relationship, origin=copies.get(source.origin_id))
    pref.active_demo_case = case
    pref.save()
    return case


def enqueue(owner_id, incident, kind, payload):
    cutoff = timezone.now() - timedelta(hours=1)
    if EvidenceJob.objects.filter(created_at__gte=cutoff).count() >= settings.EVIDENCE_MAX_JOBS_PER_HOUR:
        raise EvidenceError("rate_limited", "The hourly evidence-processing limit has been reached. Existing briefings remain available.")
    if EvidenceJob.objects.filter(owner_id=owner_id, created_at__gte=cutoff).count() >= 20:
        raise EvidenceError("rate_limited", "Please reuse the completed briefing or try again later.")
    if EvidenceJob.objects.filter(incident=incident, status__in=["queued", "running"]).exists():
        raise EvidenceError("already_processing", "This incident is already being checked.")
    return EvidenceJob.objects.create(owner_id=owner_id, incident=incident, kind=kind, payload=payload)


def add_demo_stage(case, stage):
    if not case.is_demo or case.case_owner is None:
        raise EvidenceError("invalid_demo", "Demo inputs must belong to a private demonstration case.")
    if stage == "support":
        add_report(case, name="Demo observer A", text="At 6:37 PM on 22 September 2026, I stood at Market Junction in Yaba and saw two vehicles blocking the eastbound lane. This is my own observation.", published_at=at("18:39"), observed_at=at("18:37"), relationship="Firsthand demo observer A; independent origin established in the fictional scenario")
        add_report(case, name="Demo observer B", text="I independently observed Market Junction in Yaba at 6:38 PM on 22 September 2026 from the opposite side. Two stationary vehicles obstructed the eastbound lane. I did not get this account from observer A or any forwarded message.", published_at=at("18:41"), observed_at=at("18:38"), relationship="Firsthand demo observer B; independent origin established in the fictional scenario")
    elif stage == "conflict":
        add_report(case, name="Conflicting demo observer", text="At 6:38 PM on 22 September 2026 I was at the same Market Junction in Yaba. I saw no vehicles blocking the eastbound lane. This directly disagrees with the two blockage observations for that same place and time.", published_at=at("18:43"), observed_at=at("18:38"), relationship="Firsthand conflicting demo observation; unresolved contradiction")
    elif stage == "clearance":
        add_report(case, name="Later demo observer", text="At 6:44 PM on 22 September 2026 at Market Junction in Yaba, the two vehicles had moved and traffic was passing. This is my own later observation, not a statement about conditions at 6:38 PM.", published_at=at("18:45"), observed_at=at("18:44"), relationship="Firsthand later demo clearance claim; independently unconfirmed")
    elif stage not in {"baseline", "reanalyze"}:
        raise EvidenceError("invalid_stage", "Unknown demonstration stage.")


def retrieve_reports(case, query):
    if case.is_demo:
        raise EvidenceError("mixed_namespace", "Public sources cannot corroborate a fictional incident.")
    if not settings.TAVILY_API_KEY:
        raise EvidenceError("tavily_unconfigured", "Public-source search is not configured.")
    try:
        response = httpx.post("https://api.tavily.com/search", headers={"Authorization": "Bearer " + settings.TAVILY_API_KEY}, json={
            "query": query, "search_depth": "basic", "max_results": 4,
            "include_raw_content": True, "time_range": "week",
        }, timeout=25)
        if response.status_code != 200:
            raise EvidenceError("retrieval_failed", "Public-source search could not complete. The last briefing is retained.")
        results = response.json().get("results", [])
        if not isinstance(results, list):
            raise ValueError()
    except (httpx.HTTPError, ValueError, TypeError) as error:
        raise EvidenceError("retrieval_failed", "Public-source search is temporarily unavailable.") from error
    added = 0
    for result in results[:4]:
        if not isinstance(result, dict): continue
        url = canonical_url(result.get("url", ""))
        text = result.get("raw_content") or result.get("content")
        if not url or not isinstance(text, str) or len(text.strip()) < 30: continue
        raw_date = result.get("published_date")
        published = parse_datetime(raw_date) if isinstance(raw_date, str) else None
        if published is not None and published.tzinfo is None: published = None
        add_report(case, name=urlsplit(url).hostname or "Public source", text=text, url=url,
            published_at=published, content_kind=("excerpt" if len(text) > 6000 else "full_text") if result.get("raw_content") else "snippet", retrieved_at=timezone.now())
        added += 1
    return added


def analyze(case, reports):
    if not settings.AZURE_OPENAI_API_KEY or not settings.AZURE_OPENAI_DEPLOYMENT:
        raise EvidenceError("azure_unconfigured", "AI evidence analysis is not configured.")
    base = settings.AZURE_OPENAI_BASE_URL.rstrip("/") + "/"
    parsed = urlsplit(base)
    if parsed.scheme != "https" or parsed.path != "/openai/v1/":
        raise EvidenceError("azure_unconfigured", "The configured Azure inference endpoint is invalid.")
    payload = {
        "context": {"incident": case.title, "location": case.location_name, "is_demo": case.is_demo, "reference_time": (max((r.published_at for r in reports if r.published_at), default=timezone.now()) if case.is_demo else timezone.now()).isoformat()},
        "reports": [{"id": r.code, "source": r.source_name, "url": r.source_url or None, "text": r.original_text[:6000],
            "origin_id": r.origin.code if r.origin_id else None, "provenance_note": r.relationship,
            "observed_at": r.observed_at.isoformat() if r.observed_at else None,
            "published_at": r.published_at.isoformat() if r.published_at else None, "content_kind": r.content_kind} for r in reports],
    }
    try:
        response = httpx.post(base + "responses", headers={"Authorization": "Bearer " + settings.AZURE_OPENAI_API_KEY}, json={
            "model": settings.AZURE_OPENAI_DEPLOYMENT, "store": False,
            "instructions": INSTRUCTIONS, "input": json.dumps(payload, ensure_ascii=False),
            "text": {"format": {"type": "json_schema", "name": "amara_evidence", "strict": True, "schema": SCHEMA}},
            "max_output_tokens": 4500,
        }, timeout=80)
        if response.status_code != 200:
            raise EvidenceError("analysis_failed", "The AI service could not complete this check. The previous briefing is retained.")
        result = response.json()
        if result.get("status") != "completed":
            raise EvidenceError("analysis_incomplete", "The AI response did not complete; no update was published.")
        text = "".join(part.get("text", "") for item in result.get("output", []) if item.get("type") == "message" for part in item.get("content", []) if part.get("type") == "output_text")
        data = json.loads(text)
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as error:
        raise EvidenceError("analysis_failed", "AI analysis is temporarily unavailable; no new status was published.") from error
    return validate_analysis(data, reports)


def input_digest(case, reports):
    return digest({"prompt": PROMPT_VERSION, "model": settings.AZURE_OPENAI_DEPLOYMENT, "case": case.title, "is_demo": case.is_demo, "trusted": settings.EVIDENCE_TRUSTED_DOMAINS,
        "reports": [(r.code, r.original_text, r.source_url, r.origin_id, r.published_at, r.observed_at, r.relationship) for r in reports]})


@transaction.atomic
def publish(job_id, token, source_digest, analysis, decision, reports):
    job = EvidenceJob.objects.select_for_update().get(pk=job_id)
    if job.claim_token != token or job.status != "running":
        raise EvidenceError("lease_lost", "This processing attempt was superseded.")
    case = Incident.objects.select_for_update().get(pk=job.incident_id)
    previous_signature = case.evidence_signature
    previous_status = case.status
    case.status = decision["status"]
    case.condition = analysis["condition"]
    case.confirmation_source = decision["confirmation_source"]
    case.summary = " ".join(statement["text"] for statement in analysis["statements"])[:2500]
    case.uncertainty = " ".join(analysis["uncertainties"])[:2400] or "Current conditions are not independently established."
    observed = [parse_datetime(value) for value in decision["observations"]]
    case.observed_at = max(observed) if observed else None
    # A broad area name is not converted into a falsely precise incident marker.
    if not case.is_demo and case.longitude is None and analysis["location_quotes"]:
        name = normalized(analysis["location_name"])
        for landmark in LANDMARKS:
            explicit_stop = any("alagomeji" in normalized(q["text"]) and "bus stop" in normalized(q["text"]) for q in analysis["location_quotes"])
            if explicit_stop and landmark["precision"] == "bus_stop" and name in {"alagomeji bus stop", normalized(landmark["label"])}:
                case.longitude, case.latitude = landmark["coordinates"]
                case.location_name = landmark["label"]
                break
    case.analyzed_at = timezone.now()
    case.evidence = {**analysis, "decision": decision, "model": settings.AZURE_OPENAI_DEPLOYMENT, "prompt_version": PROMPT_VERSION,
        "source_ids": [r.code for r in reports], "input_digest": source_digest}
    case.evidence_signature = digest([decision["signature"], case.longitude, case.latitude])
    changed = previous_signature != case.evidence_signature
    if changed:
        case.revision += 1
        case.updated_at = timezone.now()
    case.full_clean()
    case.save()
    for report in reports:
        fact = next(f for f in analysis["facts"] if f["report_id"] == report.code)
        report.assessment = fact
        report.save(update_fields=["assessment"])
    update = None
    if changed:
        reason = "AI-assisted briefing published" if not previous_signature else "Conflicting evidence found" if analysis["condition"] == "disputed" else "Evidence status changed" if previous_status != case.status else "New independent evidence or observation time"
        snapshot = incident_data(case)
        update = IncidentUpdate.objects.create(incident=case, revision=case.revision, reason=reason, snapshot=snapshot)
    job.status = "succeeded"
    job.progress = "Briefing updated" if changed else "Checked — no material change"
    job.input_digest = source_digest
    job.result = {"incident_id": case.slug, "revision": case.revision, "changed": changed, "update_id": update.pk if update else None,
        "status": case.status, "report_count": len(reports), "summary": case.summary, "analysis": analysis, "decision": decision}
    job.finished_at = timezone.now()
    job.lease_until = None
    job.save()
    return job.result


def process_job(job):
    token = job.claim_token
    try:
        case = job.incident
        if job.kind == "demo": add_demo_stage(case, job.payload.get("stage", "baseline"))
        elif job.kind == "search":
            EvidenceJob.objects.filter(pk=job.pk, claim_token=token).update(progress="Finding accessible public sources")
            retrieve_reports(case, job.payload["query"])
        elif job.kind == "submit":
            add_report(case, name="Submitted demo account", text=job.payload["text"], relationship="User-supplied demonstration text; provenance unverified")
        reports = list(case.reports.filter(is_demo=case.is_demo).select_related("origin").order_by("ingested_at", "pk"))
        if not reports:
            case.summary = "No usable public reports were found for this query."
            case.uncertainty = "Search coverage is incomplete. No reports found does not establish road safety."
            case.save(update_fields=["summary", "uncertainty"])
            EvidenceJob.objects.filter(pk=job.pk, claim_token=token).update(status="succeeded", progress="No usable reports found; conditions remain unknown", result={"no_sources": True, "changed": False, "report_count": 0, "status": "unconfirmed", "summary": case.summary, "incident_id": case.slug, "revision": case.revision}, finished_at=timezone.now(), lease_until=None)
            return
        if len(reports) > 10:
            raise EvidenceError("batch_limit", "This case has reached the prototype's bounded source limit. Start a new focused case.")
        source_digest = input_digest(case, reports)
        cached = EvidenceJob.objects.filter(incident=case, input_digest=source_digest, status="succeeded").exclude(pk=job.pk).order_by("-finished_at").first()
        if cached:
            EvidenceJob.objects.filter(pk=job.pk, claim_token=token).update(status="succeeded", progress="Existing evidence reused — no duplicate update", input_digest=source_digest, result={**cached.result, "changed": False, "cached": True, "update_id": None}, finished_at=timezone.now(), lease_until=None)
            return
        EvidenceJob.objects.filter(pk=job.pk, claim_token=token).update(progress="Comparing source evidence with AI")
        analysis = analyze(case, reports)
        decision = decide(analysis, reports)
        publish(job.pk, token, source_digest, analysis, decision, reports)
    except EvidenceError as error:
        if error.code == "lease_lost": return
        EvidenceJob.objects.filter(pk=job.pk, claim_token=token, status="running").update(status="failed", progress=str(error)[:160], error_code=error.code, finished_at=timezone.now(), lease_until=None)
    except Exception:
        EvidenceJob.objects.filter(pk=job.pk, claim_token=token, status="running").update(status="failed", progress="The evidence check could not finish. The previous briefing remains available.", error_code="processing_failed", finished_at=timezone.now(), lease_until=None)


@transaction.atomic
def claim_job():
    now = timezone.now()
    EvidenceJob.objects.filter(status="running", lease_until__lt=now, attempts__gte=2).update(status="failed", error_code="interrupted", progress="Processing was interrupted. You can retry the check.", finished_at=now)
    job = EvidenceJob.objects.select_for_update(skip_locked=True).filter(Q(status="queued") | Q(status="running", lease_until__lt=now, attempts__lt=2)).order_by("created_at").first()
    if job is None: return None
    job.status = "running"; job.attempts += 1; job.claim_token = uuid.uuid4()
    job.lease_until = now + timedelta(seconds=180); job.progress = "Preparing source reports"
    job.save(update_fields=["status", "attempts", "claim_token", "lease_until", "progress"])
    return job
