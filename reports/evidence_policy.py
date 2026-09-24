"""Conservative publication rules around AI interpretation, with auditable citations."""
import hashlib
import json
import re
import unicodedata
from datetime import timedelta
from urllib.parse import urlsplit

from django.conf import settings
from django.utils.dateparse import parse_datetime


class EvidenceError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def normalized(text):
    text = unicodedata.normalize("NFKC", text).translate(str.maketrans({"’": "'", "“": '"', "”": '"'}))
    return " ".join(text.casefold().split())


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def validate_analysis(data, reports):
    by_id = {r.code: r for r in reports}
    required = {"statements", "uncertainties", "condition", "location_name", "location_quotes", "facts", "contradictions"}
    if not isinstance(data, dict) or set(data) != required:
        raise EvidenceError("invalid_analysis", "The evidence response did not match its schema.")
    if data["condition"] not in {"reported", "disputed", "clearance_reported"}:
        raise EvidenceError("invalid_analysis", "The incident condition was invalid.")
    if not isinstance(data["facts"], list) or len(data["facts"]) != len(reports):
        raise EvidenceError("invalid_analysis", "A source assessment was missing.")

    def quote_valid(item):
        return isinstance(item, dict) and item.get("report_id") in by_id and isinstance(item.get("text"), str) and bool(item["text"].strip()) and normalized(item["text"]) in normalized(by_id[item["report_id"]].original_text)

    facts = {}
    for fact in data["facts"]:
        if not isinstance(fact, dict) or fact.get("report_id") not in by_id or fact["report_id"] in facts:
            raise EvidenceError("invalid_analysis", "The model cited an unknown or repeated source.")
        if fact.get("basis") not in {"firsthand", "attributed_primary", "hearsay", "unknown"} or fact.get("stance") not in {"supports", "contradicts", "clearance", "context"}:
            raise EvidenceError("invalid_analysis", "A source classification was invalid.")
        if not isinstance(fact.get("relevant"), bool) or not isinstance(fact.get("explicit_confirmation"), bool):
            raise EvidenceError("invalid_analysis", "A source assessment was invalid.")
        if not quote_valid({"report_id": fact["report_id"], "text": fact.get("quote")}):
            raise EvidenceError("invalid_citation", "A source quote could not be verified against the original text.")
        if not isinstance(fact.get("origin_group"), str) or not fact["origin_group"].strip() or len(fact["origin_group"]) > 100 or not isinstance(fact.get("origin_reason"), str):
            raise EvidenceError("invalid_analysis", "A source origin was missing.")
        observed = fact.get("observed_at")
        if observed is not None:
            if not isinstance(observed, str) or (parsed := parse_datetime(observed)) is None or parsed.tzinfo is None:
                raise EvidenceError("invalid_time", "An observation time was invalid.")
            source = by_id[fact["report_id"]]
            if source.observed_at is None:
                quote = fact.get("time_quote")
                if not quote_valid({"report_id": source.code, "text": quote}) or not re.search(r"\b20\d{2}\b", quote) or not re.search(r"\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b", quote, re.I):
                    raise EvidenceError("invalid_time", "An observation date was not established by the source.")
        facts[fact["report_id"]] = fact

    for field in ("statements", "contradictions"):
        claims = data[field]
        if not isinstance(claims, list) or len(claims) > 6 or (field == "statements" and not claims):
            raise EvidenceError("invalid_analysis", "The briefing contained an invalid number of claims.")
        for claim in claims:
            if not isinstance(claim, dict) or not isinstance(claim.get("text"), str) or not 1 <= len(claim["text"]) <= 1000:
                raise EvidenceError("invalid_analysis", "A briefing statement was invalid.")
            if field == "statements" and re.search(r"\b(?:road|route)\s+is\s+safe\b|\bsafe to (?:travel|go)\b|\bguaranteed safe\b", claim["text"], re.I):
                raise EvidenceError("unsupported_safety_claim", "The briefing attempted to make an unsupported safety assurance.")
            ids = claim.get("report_ids")
            quotes = claim.get("quotes")
            if not isinstance(ids, list) or not ids or any(code not in by_id for code in ids) or not isinstance(quotes, list) or not quotes:
                raise EvidenceError("invalid_citation", "A briefing statement has missing source references.")
            if any(not quote_valid(quote) for quote in quotes) or set(ids) != {quote["report_id"] for quote in quotes}:
                raise EvidenceError("invalid_citation", "A briefing quote or citation could not be verified.")
            if field == "contradictions" and len(set(ids)) < 2:
                raise EvidenceError("invalid_citation", "A contradiction needs opposing source references.")
    if not isinstance(data["uncertainties"], list) or not all(isinstance(text, str) and len(text) <= 800 for text in data["uncertainties"]):
        raise EvidenceError("invalid_analysis", "The uncertainty description was invalid.")
    if not isinstance(data["location_name"], str) or len(data["location_name"]) > 300 or not isinstance(data["location_quotes"], list) or any(not quote_valid(quote) for quote in data["location_quotes"]):
        raise EvidenceError("invalid_citation", "The place description was not supported by its sources.")
    if data["location_name"] and not data["location_quotes"]:
        data["location_name"] = ""
    return data


def decide(data, reports):
    by_id = {r.code: r for r in reports}
    parent = {code: code for code in by_id}

    def root(code):
        while parent[code] != code:
            parent[code] = parent[parent[code]]
            code = parent[code]
        return code

    def union(a, b):
        a, b = root(a), root(b)
        if a != b:
            first = min((a, b), key=lambda code: by_id[code].pk)
            parent[b if first == a else a] = first

    model_groups = {}
    identical = {}
    urls = {}
    submitted = None
    for fact in data["facts"]:
        code = fact["report_id"]
        group = normalized(fact["origin_group"])
        if group in model_groups: union(code, model_groups[group])
        else: model_groups[group] = code
        report = by_id[code]
        if report.source_name == "Submitted demo account":
            if submitted: union(code, submitted)
            else: submitted = code
        if report.origin_id and report.origin.code in by_id: union(code, report.origin.code)
        if report.source_url:
            if report.source_url in urls: union(code, urls[report.source_url])
            else: urls[report.source_url] = code
        text = normalized(report.original_text)
        if len(text) >= 60:
            if text in identical: union(code, identical[text])
            else: identical[text] = code

    support, opposing = set(), set()
    authority = ""
    observations = set()
    supporting_times = {}
    relevant = False
    expected_stance = "clearance" if data["condition"] == "clearance_reported" else "supports"
    for fact in data["facts"]:
        report = by_id[fact["report_id"]]
        fact["canonical_origin"] = root(report.code)
        if not fact["relevant"]: continue
        relevant = True
        observed = report.observed_at or (parse_datetime(fact["observed_at"]) if fact["observed_at"] else None)
        if observed: observations.add(observed.isoformat())
        known_hearsay = bool(report.origin_id) or any(word in report.relationship.casefold() for word in ("secondhand", "repeats", "repost", "forward"))
        primary = fact["basis"] in {"firsthand", "attributed_primary"} and not known_hearsay
        if primary and fact["stance"] == expected_stance:
            support.add(root(report.code))
            if observed: supporting_times[root(report.code)] = observed
        if fact["stance"] == "contradicts": opposing.add(root(report.code))
        domain = (urlsplit(report.source_url).hostname or "").lower().removeprefix("www.")
        if primary and domain and domain in settings.EVIDENCE_TRUSTED_DOMAINS and fact["explicit_confirmation"] and fact["stance"] == expected_stance:
            authority = domain
    conflict = bool(data["contradictions"] or opposing or data["condition"] == "disputed")
    times = list(supporting_times.values())
    time_match = len(times) >= 2 and max(times) - min(times) <= timedelta(hours=3)
    status = "unconfirmed" if conflict else "confirmed" if authority else "corroborated" if len(support) >= 2 and time_match else "unconfirmed"
    if conflict: authority = ""
    material = {"status": status, "condition": data["condition"], "support": sorted(support), "opposing": sorted(opposing), "observations": sorted(observations), "authority": authority, "relevant": relevant}
    return {**material, "signature": digest(material), "confirmation_source": authority, "support_count": len(support), "matching_observation_times": time_match, "has_relevant_evidence": relevant}
