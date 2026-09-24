from django.conf import settings
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from django.views.decorators.http import require_GET

from .models import PreparedDemo
from .replay import replay_event
from .views import page


@require_GET
def scenario(request):
    pack = PreparedDemo.objects.filter(active=True).first() if settings.DEMO_ENABLED else None
    if pack is None:
        return JsonResponse({"error": "The saved demo has not been prepared yet. Run the prepare_demo command before presenting.", "code": "demo_not_prepared"}, status=503)
    response = JsonResponse(pack.payload)
    response["Cache-Control"] = "no-store"
    return response


@require_GET
def evidence(request, key, event_key):
    if not settings.DEMO_ENABLED: raise Http404()
    pack = get_object_or_404(PreparedDemo, key=key)
    event = replay_event(pack, event_key)
    if event is None: raise Http404()
    state = request.GET.get("state", "reviewed")
    if state not in {"received", "checking", "reviewed"}: raise Http404()
    result = event["result"]
    sources = result["sources"] if state == "reviewed" else [source for source in result["sources"] if source["id"] in event["incoming_source_ids"]]
    by_id = {source["id"]: source for source in result["sources"]}
    statements = [{"text": statement["text"], "sources": [by_id[code] for code in statement["report_ids"]]} for statement in result["analysis"]["statements"]] if state == "reviewed" else []
    return page(request, "pages/replay_evidence.html", section="incident", title="Saved demo evidence", context={
        "replay_state": state, "event": event, "saved_result": result, "sources": sources, "statements": statements,
        "prepared_at": parse_datetime(result["prepared_at"]), "pack_key": key,
        "map_state": {"page": "incident", "incidents": [result["incident"]], "selected_incident": result["incident"]["id"], "route_visible": False},
    })
