"""Read-only Supabase checks; output never includes connection credentials."""
import argparse
import os
from pathlib import Path

import dj_database_url
import httpx
import psycopg
from dotenv import load_dotenv


def diagnose_dns(host):
    """Optional public DNS lookup: query only the hostname, never the URL/key."""
    counts = {}
    try:
        with httpx.Client(timeout=10) as client:
            for kind, record_type in (("A", 1), ("AAAA", 28)):
                response = client.get("https://dns.google/resolve", params={"name": host, "type": kind})
                response.raise_for_status()
                data = response.json()
                counts[kind] = sum(record.get("type") == record_type for record in data.get("Answer", []))
                print(f"Public DNS {kind}: status={data.get('Status')}, addresses={counts[kind]}")
        if counts.get("A") == 0 and counts.get("AAAA", 0) > 0:
            print("The direct endpoint is IPv6-only. Use Supabase's Session pooler on an IPv4-only network.")
        elif counts.get("A", 0) > 0:
            print("IPv4 records exist; check local DNS, routing, credentials, and pooler configuration.")
    except (httpx.HTTPError, ValueError, TypeError):
        print("Public DNS diagnostic could not complete; no hostname or credentials printed.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--diagnose-dns", action="store_true", help="On failure, check public IPv4/IPv6 DNS records without printing the hostname.")
    args = parser.parse_args()
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    parsed = None
    try:
        parsed = dj_database_url.parse(os.environ["DATABASE_URL"])
        if parsed["ENGINE"] != "django.db.backends.postgresql":
            raise ValueError("The Supabase check requires PostgreSQL.")
        with psycopg.connect(
            dbname=parsed["NAME"], user=parsed["USER"], password=parsed["PASSWORD"],
            host=parsed["HOST"], port=parsed["PORT"] or 5432,
            connect_timeout=8, sslmode="require",
        ) as connection:
            client_tls = bool(connection.pgconn.ssl_in_use)
            with connection.cursor() as cursor:
                cursor.execute("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
                backend_ssl = cursor.fetchone()
                cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'amara_%'")
                print("PASS: PostgreSQL connected; client-to-endpoint TLS:", client_tls)
                print("Database-reported backend TLS (may be the pooler's internal connection):", bool(backend_ssl and backend_ssl[0]))
                print("Existing Amara application tables:", cursor.fetchone()[0])
                cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='django_migrations'")
                print("Migration recorder already exists:", bool(cursor.fetchone()[0]))
        return 0
    except Exception as error:
        print("FAIL:", type(error).__name__, "SQLSTATE:", getattr(error, "sqlstate", None) or "unavailable")
        message = str(error).lower()
        if "password authentication failed" in message:
            print("Database credentials were rejected.")
        elif any(word in message for word in ("network is unreachable", "no route to host")):
            print("Database network is unreachable; use the Supabase Session pooler if IPv6 is unavailable.")
        elif "could not translate host name" in message or "failed to resolve" in message:
            print("No usable database address was resolved locally. Direct Supabase endpoints can be IPv6-only.")
        elif "timeout" in message:
            print("Database connection timed out.")
        else:
            print("Connection details omitted to protect credentials.")
        if args.diagnose_dns and parsed and parsed.get("HOST"):
            diagnose_dns(parsed["HOST"])
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
