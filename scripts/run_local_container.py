"""Run the built image locally with the configured database or explicit local QA DB.

Default: DATABASE_URL from .env (Supabase). --database local selects the isolated
amara-phase2-db container. Runtime credentials are passed by environment, not logged.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
from urllib.error import URLError
from urllib.request import urlopen

from dotenv import dotenv_values

config = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
parser = argparse.ArgumentParser()
parser.add_argument("--database", choices=("configured", "local"), default="configured")
parser.add_argument("--image", default="amara:replay", help="Local image tag to run.")
args = parser.parse_args()
environment = os.environ.copy()
environment.update({
    "MAPBOX_PUBLIC_TOKEN": config.get("MAPBOX_PUBLIC_TOKEN") or "",
    "DJANGO_SECRET_KEY": config.get("DJANGO_SECRET_KEY") or secrets.token_urlsafe(64),
    "DATABASE_URL": config.get("DATABASE_URL") or "",
})
for name in ("AZURE_OPENAI_BASE_URL", "AZURE_OPENAI_DEPLOYMENT", "AZURE_OPENAI_API_KEY", "TAVILY_API_KEY", "AMARA_TRUSTED_SOURCE_DOMAINS"):
    environment[name] = config.get(name) or ""
for name, default in (("AMARA_EVIDENCE_WORKER", "True"), ("AMARA_MAX_AI_JOBS_PER_HOUR", "60"), ("AMARA_DEMO_ENABLED", "True")):
    environment[name] = config.get(name) or default
if args.database == "local":
    environment["DATABASE_URL"] = "postgresql://amara:local-demo-only@amara-phase2-db:5432/amara?sslmode=disable"
elif not environment["DATABASE_URL"]:
    raise SystemExit("Configure DATABASE_URL in .env before starting the app.")
name = "amara-phase2-app"
existing = subprocess.run(["docker", "inspect", "--format", '{{index .Config.Labels "amara.owner"}}', name], capture_output=True, text=True)
if existing.returncode == 0:
    if existing.stdout.strip() != "phase2-qa":
        raise SystemExit("An unrelated container uses the QA name; it was not modified.")
    if not config.get("DJANGO_SECRET_KEY"):
        settings = subprocess.run(["docker", "inspect", "--format", "{{json .Config.Env}}", name], capture_output=True, text=True, check=True)
        for value in json.loads(settings.stdout):
            if value.startswith("DJANGO_SECRET_KEY="):
                environment["DJANGO_SECRET_KEY"] = value.split("=", 1)[1]
                break
    subprocess.run(["docker", "rm", "-f", name], check=True)
subprocess.run([
    "docker", "run", "-d", "--name", name, "--label", "amara.owner=phase2-qa",
    "--label", "amara.database=" + args.database,
    *(["--network", "amara-phase2"] if args.database == "local" else []),
    "-p", "127.0.0.1:8001:8000",
    "-e", "MAPBOX_PUBLIC_TOKEN", "-e", "DJANGO_SECRET_KEY", "-e", "DATABASE_URL",
    "-e", "AZURE_OPENAI_BASE_URL", "-e", "AZURE_OPENAI_DEPLOYMENT", "-e", "AZURE_OPENAI_API_KEY", "-e", "TAVILY_API_KEY", "-e", "AMARA_TRUSTED_SOURCE_DOMAINS",
    "-e", "AMARA_EVIDENCE_WORKER", "-e", "AMARA_MAX_AI_JOBS_PER_HOUR", "-e", "AMARA_DEMO_ENABLED",
    "-e", "DJANGO_DEBUG=False", "-e", "DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1",
    "-e", "DJANGO_SECURE_SSL_REDIRECT=False", "-e", "DJANGO_SECURE_COOKIES=False",
    "-e", "PUBLIC_ORIGIN=http://localhost:8001",
    args.image,
], env=environment, check=True)
deadline = time.monotonic() + 35
while time.monotonic() < deadline:
    try:
        with urlopen("http://localhost:8001/readyz/", timeout=3) as response:
            if response.status == 200:
                print("Ready: http://localhost:8001/ — database:", args.database)
                break
    except (URLError, OSError):
        pass
    time.sleep(.5)
else:
    raise SystemExit("Container started but readiness was not confirmed. Inspect the app/database configuration.")
