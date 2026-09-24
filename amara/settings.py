import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env", override=False)


def flag(name, default=False):
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes"}


DEBUG = flag("DJANGO_DEBUG")
BUILD = flag("DJANGO_BUILD")
TESTING = os.environ.get("DJANGO_SETTINGS_MODULE") == "amara.settings_test"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG or BUILD or TESTING:
        SECRET_KEY = "django-insecure-amara-local-development-or-build-only"
    else:
        raise ImproperlyConfigured("Set DJANGO_SECRET_KEY before starting Amara in production.")

ALLOWED_HOSTS = [h.strip() for h in os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]
CSRF_TRUSTED_ORIGINS = [h.strip() for h in os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if h.strip()]
PUBLIC_ORIGIN = os.getenv("PUBLIC_ORIGIN", "http://localhost:8000").rstrip("/")
INSTALLED_APPS = ["django.contrib.staticfiles", "reports.apps.ReportsConfig"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "amara.urls"
WSGI_APPLICATION = "amara.wsgi.application"
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [BASE_DIR / "templates"],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": ["django.template.context_processors.request", "reports.context.shell"]},
}]

database_url = os.getenv("DATABASE_URL", "")
if BUILD or TESTING:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
elif database_url:
    DATABASES = {"default": dj_database_url.parse(database_url, conn_max_age=60, conn_health_checks=True)}
    if DATABASES["default"]["ENGINE"] == "django.db.backends.postgresql":
        options = DATABASES["default"].setdefault("OPTIONS", {})
        options.update({"connect_timeout": 8, "prepare_threshold": None})
        options.setdefault("sslmode", "require")
    elif not DEBUG:
        raise ImproperlyConfigured("Production requires the configured PostgreSQL database.")
else:
    raise ImproperlyConfigured("Set DATABASE_URL. Amara does not silently fall back to a different database.")

SESSION_ENGINE = "django.contrib.sessions.backends.signed_cookies"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = flag("DJANGO_SECURE_COOKIES", not DEBUG)
CSRF_COOKIE_SECURE = flag("DJANGO_SECURE_COOKIES", not DEBUG)
SECURE_SSL_REDIRECT = flag("DJANGO_SECURE_SSL_REDIRECT", not DEBUG and not BUILD and not TESTING)
SECURE_REDIRECT_EXEMPT = [r"^healthz/$", r"^readyz/$"]
if flag("DJANGO_TRUST_PROXY"):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_HSTS_SECONDS", "0"))
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
WHITENOISE_USE_FINDERS = DEBUG
WHITENOISE_AUTOREFRESH = DEBUG
WHITENOISE_MANIFEST_STRICT = True
LANGUAGE_CODE = "en"
TIME_ZONE = "Africa/Lagos"
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
DATA_UPLOAD_MAX_MEMORY_SIZE = 64 * 1024
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "amara", "OPTIONS": {"MAX_ENTRIES": 160}}}
MAPBOX_PUBLIC_TOKEN = os.getenv("MAPBOX_PUBLIC_TOKEN", "")
DEMO_ENABLED = flag("AMARA_DEMO_ENABLED", True)
# Secrets used by later evidence integrations remain on the server.
AZURE_OPENAI_BASE_URL = os.getenv("AZURE_OPENAI_BASE_URL", "")
AZURE_OPENAI_DEPLOYMENT = os.getenv("AZURE_OPENAI_DEPLOYMENT", "")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
EVIDENCE_WORKER_ENABLED = flag("AMARA_EVIDENCE_WORKER", True)
EVIDENCE_MAX_JOBS_PER_HOUR = int(os.getenv("AMARA_MAX_AI_JOBS_PER_HOUR", "60"))
EVIDENCE_TRUSTED_DOMAINS = tuple(d.strip().lower() for d in os.getenv("AMARA_TRUSTED_SOURCE_DOMAINS", "").split(",") if d.strip())
