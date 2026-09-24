"""Read-only smoke checks for a running Amara URL; no credentials are printed."""
import argparse
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from dotenv import dotenv_values


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        value = attrs.get("src") if tag == "script" else attrs.get("href") if tag == "link" else None
        if value and value.startswith("/static/"):
            self.urls.add(value)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="App origin, e.g. http://localhost:8001 or the deployed HTTPS URL")
    args = parser.parse_args()
    base = args.url.rstrip("/") + "/"
    if urlsplit(base).scheme not in {"http", "https"}:
        raise SystemExit("Use an HTTP or HTTPS application origin.")
    credentials = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
    with httpx.Client(base_url=base, timeout=20, follow_redirects=True) as client:
        home = client.get("")
        assert home.status_code == 200 and "Amara" in home.text, "Home page did not render."
        for path in ("healthz/", "readyz/"):
            assert client.get(path).status_code == 200, "Health/readiness check failed."
        data_response = client.get("api/incidents/")
        data_response.raise_for_status()
        data = data_response.json()
        assert data["schema_version"] == 1, "Unexpected API schema."
        for incident in data["incidents"]:
            assert client.get(incident["detail_url"]).status_code == 200, "Direct incident link failed."
            details = client.get(f"api/incidents/{incident['id']}/").json()
            for report in details["reports"]:
                assert client.get(report["detail_url"]).status_code == 200, "Direct source link failed."
        assets = Assets()
        assets.feed(home.text)
        assert len(assets.urls) >= 4, "Expected bundled assets are missing."
        for path in assets.urls:
            assert client.get(urljoin(base, path)).status_code == 200, "Bundled asset could not load."
        responses = home.text + data_response.text + client.get("api/map-config/").text
        for name in ("AZURE_OPENAI_API_KEY", "TAVILY_API_KEY", "DATABASE_URL", "DJANGO_SECRET_KEY"):
            value = credentials.get(name)
            assert not value or value not in responses, "A private setting appeared in a public response."
        assert client.get(".env").status_code == 404, "Environment file URL must be unavailable."
        print(f"PASS: home, health, readiness, {len(data['incidents'])} incidents, source links, and {len(assets.urls)} assets.")
        print("PASS: sampled public responses exclude configured private values; /.env returns 404.")
        print("Transport checked:", urlsplit(home.url.__str__()).scheme.upper())


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, httpx.HTTPError, KeyError, ValueError) as error:
        print("FAIL:", type(error).__name__, "— inspect the corresponding app/service check; credentials omitted.")
        raise SystemExit(1)
