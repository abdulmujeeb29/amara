from .settings import *  # noqa: F403

DEBUG = False
SECRET_KEY = "django-insecure-isolated-test-key-not-for-deployment"
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
MAPBOX_PUBLIC_TOKEN = "pk.test-public-token"
AZURE_OPENAI_API_KEY = "private-azure-test-value"
TAVILY_API_KEY = "private-search-test-value"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
