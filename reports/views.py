import uuid
import json

import httpx
from django.conf import settings
from django.core.cache import cache
from django.db import DatabaseError, connection
from django.db.models import Prefetch, Q
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .contracts import incident_data, report_data
from .local_places import DEMO_DESTINATION, DEMO_ORIGIN
from .forms import JourneyForm, PreferenceForm, PlaceSearchForm, RouteForm
from .navigation import NavigationError, calculate_route, search_places
from .models import Incident, Preference, Report, IncidentUpdate, UpdateReceipt


def data_mode(request):
    mode = request.session.get("evidence_mode", "demo" if settings.DEMO_ENABLED else "live")
    return "demo" if mode == "demo" and settings.DEMO_ENABLED else "live"


def scoped_incidents(request):
    pref = preference(request)
    demo = data_mode(request) == "demo"
    sources = Report.objects.filter(is_demo=demo).select_related("origin")
    return Incident.objects.filter(is_demo=demo).filter(Q(case_owner__isnull=True) | Q(case_owner=pref.visitor_id)).prefetch_related(Prefetch("reports", queryset=sources))


def incidents(request):
    pref = preference(request)
    queryset = scoped_incidents(request)
    if data_mode(request) == "demo":
        if pref.active_demo_case_id:
            return queryset.filter(Q(case_owner__isnull=True) | Q(pk=pref.active_demo_case_id)).exclude(slug="market-junction")
        return queryset.filter(case_owner__isnull=True)
    return queryset


def preference(request):
    if hasattr(request, "amara_preference"):
        return request.amara_preference
    visitor_id = request.session.get("visitor_id")
    try:
        visitor_id = uuid.UUID(visitor_id) if visitor_id else uuid.uuid4()
    except (ValueError, TypeError):
        visitor_id = uuid.uuid4()
    request.session["visitor_id"] = str(visitor_id)
    request.amara_preference = Preference.objects.filter(visitor_id=visitor_id).first() or Preference(visitor_id=visitor_id)
    return request.amara_preference


@ensure_csrf_cookie
def page(request, template, *, section, title, context=None, status=200):
    context = dict(context or {})
    context.update({"section": section, "title": title, "panel_template": template})
    if "preference" not in context:
        context["preference"] = preference(request)
    selected = context.get("incident") or (context["report"].incident if context.get("report") else None)
    if "map_state" not in context:
        context["map_state"] = {"page": section, "incidents": [incident_data(i) for i in incidents(request)], "route_visible": False, "selected_incident": selected.slug if selected else None}
    if request.headers.get("X-Amara-Partial") == "1":
        response = JsonResponse({
            "html": render_to_string(template, context, request=request),
            "title": f"{title} · Amara", "section": section,
            "map_state": context["map_state"], "url": request.get_full_path(),
        }, status=status)
    else:
        response = render(request, "base.html", context, status=status)
    response["Cache-Control"] = "private, no-store"
    response["Vary"] = "Cookie, X-Amara-Partial"
    return response


@require_GET
def overview(request):
    records = list(incidents(request))
    primary = next((i for i in records if i.template_slug == "market-junction"), next((i for i in records if i.slug == "market-junction"), records[0] if records else None))
    return page(request, "pages/overview.html", section="overview", title="Your local briefing", context={"primary": primary, "others": [i for i in records if i != primary]})


@require_GET
def incident_detail(request, slug):
    incident = get_object_or_404(scoped_incidents(request), slug=slug)
    citations = {r.code: r for r in incident.reports.all()}
    statements = [{"text": item["text"], "sources": [citations[code] for code in item["report_ids"] if code in citations]} for item in incident.evidence.get("statements", [])]
    return page(request, "pages/incident.html", section="incident", title=incident.title, context={"incident": incident, "statements": statements, "changes": incident.updates.order_by("-created_at")[:6]})


@require_GET
def source_detail(request, code):
    report = get_object_or_404(Report.objects.select_related("incident", "origin"), code=code, is_demo=data_mode(request) == "demo", incident__in=scoped_incidents(request))
    return page(request, "pages/source.html", section="incident", title=report.source_name, context={"report": report})


@require_GET
def journey(request):
    pref = preference(request)
    data = {"destination": request.GET.get("destination", ""), "mode": request.GET.get("mode", pref.travel_mode), "step": request.GET.get("step", "setup")}
    form = JourneyForm(data)
    valid = form.is_valid()
    mode = form.cleaned_data.get("mode", pref.travel_mode)
    records = list(incidents(request))
    map_state = {
        "page": "journey", "incidents": [incident_data(i) for i in records],
        "route_visible": False, "route": [], "mode": mode,
        "sample_origin": DEMO_ORIGIN["coordinates"], "sample_destination": DEMO_DESTINATION["coordinates"],
        "sample_origin_label": DEMO_ORIGIN["label"], "sample_destination_label": DEMO_DESTINATION["label"],
    }
    return page(request, "pages/journey.html", section="journey", title="Your journey", status=200 if valid else 400, context={
        "form": form, "mode": mode, "destination": form.cleaned_data.get("destination", data["destination"]),
        "map_state": map_state, "preference": pref,
    })


def navigation_response(data, status=200):
    response = JsonResponse(data, status=status)
    response["Cache-Control"] = "private, no-store"
    return response


@require_GET
def place_search(request):
    form = PlaceSearchForm(request.GET)
    if not form.is_valid():
        return navigation_response({"errors": form.errors.get_json_data()}, 400)
    try:
        return navigation_response({"places": search_places(form.cleaned_data["q"]), "scope": "Lagos"})
    except NavigationError as error:
        return navigation_response({"error": str(error), "code": error.code}, error.status)


@require_POST
def route_api(request):
    try:
        data = json.loads(request.body)
        if not isinstance(data, dict) or ("demo_route" in data and not isinstance(data["demo_route"], bool)):
            raise ValueError()
    except (ValueError, UnicodeDecodeError):
        return navigation_response({"error": "Send a valid route request."}, 400)
    form = RouteForm(data)
    if not form.is_valid():
        return navigation_response({"errors": form.errors.get_json_data(), "error": "Choose valid points and a travel mode."}, 400)
    values = form.cleaned_data
    try:
        via = None
        if values["demo_route"]:
            incident = None
            if settings.DEMO_ENABLED:
                pref = preference(request)
                incident = pref.active_demo_case or Incident.objects.filter(slug="market-junction", case_owner__isnull=True, is_demo=True).first()
            if incident is None or incident.longitude is None:
                return navigation_response({"error": "The example incident is unavailable. Please plan a custom route.", "code": "demo_unavailable"}, 422)
            via = [incident.longitude, incident.latitude]
        result = calculate_route(
            [values["origin_lng"], values["origin_lat"]],
            [values["destination_lng"], values["destination_lat"]], values["mode"], via=via,
        )
        result["demo_route"] = values["demo_route"]
        return navigation_response({"route": result})
    except NavigationError as error:
        return navigation_response({"error": str(error), "code": error.code}, error.status)


@require_GET
def updates(request):
    changes = list(IncidentUpdate.objects.filter(incident__in=incidents(request)).select_related("incident").order_by("-pk")[:20])
    receipts = {r.update_id: r for r in UpdateReceipt.objects.filter(visitor_id=preference(request).visitor_id, update__in=changes)}
    return page(request, "pages/updates.html", section="updates", title="Your updates", context={"incidents": incidents(request), "evidence_updates": [{"update": update, "receipt": receipts.get(update.pk)} for update in changes]})


@require_GET
def following(request):
    return page(request, "pages/following.html", section="following", title="Places you follow")


@require_GET
def preferences_page(request):
    return page(request, "pages/settings.html", section="settings", title="Make it yours")


@require_POST
def save_preferences(request):
    pref = preference(request)
    form = PreferenceForm(request.POST, instance=pref)
    if not form.is_valid():
        return JsonResponse({"errors": form.errors.get_json_data()}, status=400)
    form.save()
    if request.headers.get("X-Amara-Partial") == "1":
        return JsonResponse({"saved": True, "preferences": {"follow_market_road": pref.follow_market_road, "muted": pref.muted, "travel_mode": pref.travel_mode}})
    target = request.POST.get("next", reverse("following"))
    if not url_has_allowed_host_and_scheme(target, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        target = reverse("following")
    return redirect(target)


@require_GET
def incident_api(request, slug=None):
    queryset = incidents(request)
    if slug:
        incident = get_object_or_404(queryset, slug=slug)
        return JsonResponse({"schema_version": 1, "incident": incident_data(incident), "reports": [report_data(r) for r in incident.reports.all()]})
    return JsonResponse({"schema_version": 1, "data_mode": data_mode(request), "incidents": [incident_data(i) for i in queryset]})


@require_GET
def map_config(request):
    token = settings.MAPBOX_PUBLIC_TOKEN
    response = JsonResponse({"mapboxToken": token if token.startswith("pk.") else ""})
    response["Cache-Control"] = "private, no-store"
    return response


@require_GET
def raster_tile(request, z, x, y):
    if not (0 <= z <= 19 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        return HttpResponse("Invalid tile coordinates", status=400)
    token = settings.MAPBOX_PUBLIC_TOKEN
    if not token.startswith("pk."):
        return HttpResponse("Map service is not configured", status=503)
    key = f"raster:{z}:{x}:{y}"
    data = cache.get(key)
    if data is None:
        try:
            response = httpx.get(
                f"https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}",
                params={"access_token": token}, headers={"Referer": settings.PUBLIC_ORIGIN + "/"}, timeout=12,
            )
            if response.status_code != 200:
                return HttpResponse("Map imagery unavailable", status=502)
            content_type = response.headers.get("Content-Type", "")
            if not content_type.startswith("image/") or len(response.content) > 2 * 1024 * 1024:
                return HttpResponse("Invalid map imagery response", status=502)
            data = (response.content, content_type)
            cache.set(key, data, 300)
        except httpx.HTTPError:
            return HttpResponse("Map service unavailable", status=502)
    response = HttpResponse(data[0], content_type=data[1])
    response["Cache-Control"] = "public, max-age=300"
    return response


@require_GET
def health(request):
    return JsonResponse({"status": "ok", "service": "amara"})


@require_GET
def ready(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        Incident.objects.exists()
    except DatabaseError:
        return JsonResponse({"status": "unavailable", "dependency": "database"}, status=503)
    return JsonResponse({"status": "ready", "service": "amara"})
