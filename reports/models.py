import uuid
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone


class Incident(models.Model):
    class Status(models.TextChoices):
        UNCONFIRMED = "unconfirmed", "Unconfirmed"
        CORROBORATED = "corroborated", "Corroborated"
        CONFIRMED = "confirmed", "Confirmed by a source"

    slug = models.SlugField(unique=True)
    title = models.CharField(max_length=180)
    summary = models.TextField()
    uncertainty = models.TextField()
    location_name = models.CharField(max_length=120)
    longitude = models.FloatField(null=True, blank=True, validators=[MinValueValidator(-180), MaxValueValidator(180)])
    latitude = models.FloatField(null=True, blank=True, validators=[MinValueValidator(-90), MaxValueValidator(90)])
    status = models.CharField(max_length=16, choices=Status, default=Status.UNCONFIRMED)
    confirmation_source = models.CharField(max_length=120, blank=True)
    observed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField()
    revision = models.PositiveIntegerField(default=1)
    is_demo = models.BooleanField(default=True)
    case_owner = models.UUIDField(null=True, blank=True, db_index=True)
    template_slug = models.CharField(max_length=80, blank=True)
    area_scope = models.CharField(max_length=40, default="yaba")
    condition = models.CharField(max_length=24, default="reported")
    evidence = models.JSONField(default=dict, blank=True)
    evidence_signature = models.CharField(max_length=64, blank=True)
    analyzed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "amara_incident"
        ordering = ["-updated_at"]
        constraints = [
            models.CheckConstraint(condition=Q(status__in=["unconfirmed", "corroborated", "confirmed"]), name="amara_incident_valid_status"),
            models.CheckConstraint(condition=~Q(status="confirmed") | ~Q(confirmation_source=""), name="amara_confirmation_attribution"),
            models.CheckConstraint(condition=(Q(latitude__isnull=True) & Q(longitude__isnull=True)) | (Q(latitude__isnull=False, longitude__isnull=False, latitude__gte=-90, latitude__lte=90, longitude__gte=-180, longitude__lte=180)), name="amara_incident_location_bounds"),
        ]

    def clean(self):
        if self.status == self.Status.CONFIRMED and not self.confirmation_source.strip():
            raise ValidationError({"confirmation_source": "Explicit confirmation requires attribution."})
        if (self.latitude is None) != (self.longitude is None):
            raise ValidationError("Supply both coordinates or leave both unresolved.")

    @property
    def status_label(self):
        return f"Confirmed by {self.confirmation_source}" if self.status == self.Status.CONFIRMED else self.get_status_display()


class Report(models.Model):
    incident = models.ForeignKey(Incident, related_name="reports", on_delete=models.CASCADE)
    code = models.SlugField(unique=True)
    source_name = models.CharField(max_length=120)
    original_text = models.TextField()
    relationship = models.CharField(max_length=180)
    source_url = models.URLField(blank=True, max_length=2048)
    origin = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="reposts")
    observed_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    is_demo = models.BooleanField(default=True)
    ingested_at = models.DateTimeField(default=timezone.now)
    retrieved_at = models.DateTimeField(null=True, blank=True)
    content_kind = models.CharField(max_length=20, default="submitted")
    fingerprint = models.CharField(max_length=64, blank=True, db_index=True)
    assessment = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "amara_report"
        ordering = ["published_at", "code"]
        constraints = [models.UniqueConstraint(fields=["incident", "fingerprint"], condition=~Q(fingerprint=""), name="amara_report_fingerprint_unique")]

    def clean(self):
        if self.source_url and urlsplit(self.source_url).scheme not in {"http", "https"}:
            raise ValidationError({"source_url": "Source links must use HTTP or HTTPS."})
        if self.incident_id and self.is_demo != self.incident.is_demo:
            raise ValidationError("Demo reports cannot support live incidents, or vice versa.")
        if self.origin_id:
            if self.origin_id == self.pk:
                raise ValidationError("A report cannot originate from itself.")
            if self.origin.incident_id != self.incident_id or self.origin.is_demo != self.is_demo:
                raise ValidationError("Origins must belong to the same incident and data namespace.")


class Preference(models.Model):
    visitor_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    follow_market_road = models.BooleanField(default=True)
    muted = models.BooleanField(default=False)
    follow_yaba_area = models.BooleanField(default=True)
    active_demo_case = models.ForeignKey(Incident, null=True, blank=True, on_delete=models.SET_NULL, related_name="demo_visitors")
    travel_mode = models.CharField(max_length=8, choices=[("walking", "Walking"), ("driving", "Driving")], default="driving")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "amara_preference"
        constraints = [models.CheckConstraint(condition=Q(travel_mode__in=["walking", "driving"]), name="amara_preference_valid_mode")]


class EvidenceJob(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner_id = models.UUIDField(db_index=True)
    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name="jobs")
    kind = models.CharField(max_length=20)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=16, default="queued", db_index=True)
    progress = models.CharField(max_length=160, default="Waiting to process")
    attempts = models.PositiveSmallIntegerField(default=0)
    claim_token = models.UUIDField(null=True)
    lease_until = models.DateTimeField(null=True, blank=True)
    input_digest = models.CharField(max_length=64, blank=True, db_index=True)
    result = models.JSONField(default=dict, blank=True)
    error_code = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "amara_evidence_job"
        ordering = ["created_at"]
        constraints = [models.UniqueConstraint(fields=["incident"], condition=Q(status__in=["queued", "running"]), name="amara_one_active_incident_job")]


class IncidentUpdate(models.Model):
    incident = models.ForeignKey(Incident, related_name="updates", on_delete=models.CASCADE)
    revision = models.PositiveIntegerField()
    reason = models.CharField(max_length=180)
    snapshot = models.JSONField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "amara_incident_update"
        ordering = ["id"]
        constraints = [models.UniqueConstraint(fields=["incident", "revision"], name="amara_incident_revision_unique")]


class UpdateReceipt(models.Model):
    visitor_id = models.UUIDField(db_index=True)
    update = models.ForeignKey(IncidentUpdate, related_name="receipts", on_delete=models.CASCADE)
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    dismissed_at = models.DateTimeField(null=True, blank=True)
    context = models.CharField(max_length=32, blank=True)

    class Meta:
        db_table = "amara_update_receipt"
        constraints = [models.UniqueConstraint(fields=["visitor_id", "update"], name="amara_update_receipt_unique")]


class PreparedDemo(models.Model):
    """Published fictional replay pack; serving it never invokes a provider."""
    key = models.SlugField(primary_key=True, max_length=64)
    payload = models.JSONField()
    prepared_at = models.DateTimeField(default=timezone.now)
    model_name = models.CharField(max_length=120)
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "amara_prepared_demo"
        constraints = [models.UniqueConstraint(fields=["active"], condition=Q(active=True), name="amara_one_active_demo_pack")]
