"""Live end-to-end AI check using a private, explicitly fictional case.

Makes up to three AI calls (baseline, supporting evidence, conflict) and checks
cache reuse and notification deduplication. No credentials or raw model output logged.
"""
import argparse
import time

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?", default="http://localhost:8001")
    args = parser.parse_args()
    with httpx.Client(base_url=args.url, timeout=20) as client:
        client.get("/evidence/").raise_for_status()

        def post(path, data):
            response = client.post(path, json=data, headers={"X-CSRFToken": client.cookies["csrftoken"]})
            response.raise_for_status()
            return response.json()

        def job(action):
            submitted = post("/api/evidence/jobs/", {"action": action})
            start = time.monotonic()
            while time.monotonic() - start < 120:
                response = client.get(submitted["status_url"])
                response.raise_for_status()
                result = response.json()
                if result["status"] in {"succeeded", "failed"}:
                    print(action, result["status"], result.get("error_code"), round(time.monotonic() - start, 1), "seconds")
                    assert result["status"] == "succeeded", "Evidence processing did not complete."
                    return result
                time.sleep(1.5)
            raise AssertionError("Evidence job exceeded the verification deadline.")

        baseline = job("new_demo")
        assert baseline["result"]["status"] == "unconfirmed"
        initial_update = baseline["result"]["update_id"]
        assert post(f"/api/updates/{initial_update}/receipt/", {"action": "claim", "context": "followed_road"})["show"]
        assert not post(f"/api/updates/{initial_update}/receipt/", {"action": "claim", "context": "followed_road"})["show"]
        supporting = job("support")
        assert supporting["result"]["status"] == "corroborated"
        unchanged = job("reanalyze")
        assert unchanged["result"]["cached"] and not unchanged["result"]["changed"]
        assert unchanged["result"]["revision"] == supporting["result"]["revision"]
        conflict = job("conflict")
        assert conflict["result"]["status"] == "unconfirmed"
        feed = client.get("/api/updates/", params={"after": initial_update}).json()
        assert len(feed["updates"]) == 2
        assert all(item["previously_notified"] for item in feed["updates"])
        assert client.get(conflict["detail_url"]).status_code == 200
        with httpx.Client(base_url=args.url, timeout=20) as outsider:
            assert outsider.get(f"/api/evidence/jobs/{conflict['id']}/").status_code == 404
        print("PASS: unconfirmed → corroborated → disputed/unconfirmed; unchanged evidence cached; popup claim deduplicated; case isolated.")


if __name__ == "__main__":
    try:
        main()
    except (httpx.HTTPError, AssertionError, KeyError) as error:
        print("FAIL:", type(error).__name__, "— inspect the relevant job/check; credentials omitted.")
        raise SystemExit(1)
