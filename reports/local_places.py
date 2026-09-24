"""Small, attributed Lagos landmark supplement for known geocoder coverage gaps.

Coordinates identify the named OSM feature, not an invented neighbourhood centre.
Data © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright
"""
import re
import unicodedata

LANDMARKS = (
    {
        "id": "local-yabatech", "label": "Yaba College of Technology · campus, Yaba",
        "coordinates": [3.3741408, 6.5187275],
        "aliases": ("yaba", "yabatech", "yaba tech", "yaba college", "yaba college of technology"),
        "source": "local_landmark", "source_label": "Mapped campus · OpenStreetMap",
        "source_url": "https://www.openstreetmap.org/way/671850885",
        "precision": "campus",
    },
    {
        "id": "local-alagomeji", "label": "Alagomeji bus stop · Herbert Macaulay Way",
        "coordinates": [3.3782136, 6.5001473],
        "aliases": ("alagomeji", "alago meji", "alagomeji bus stop", "alagomeji busstop"),
        "source": "local_landmark", "source_label": "Mapped bus stop · OpenStreetMap",
        "source_url": "https://www.openstreetmap.org/node/1513671680",
        "precision": "bus_stop",
    },
)


def normalize_query(query):
    text = unicodedata.normalize("NFKC", query).strip()
    text = re.sub(r"^(?:directions?|route|go|take me)\s+to\s+", "", text, flags=re.I)
    text = re.sub(r"\s+(?:route|directions?)\s*$", "", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def local_matches(query):
    key = re.sub(r"[^a-z0-9]+", " ", normalize_query(query).casefold()).strip()
    key = re.sub(r"(?: lagos)?(?: nigeria)?$", "", key).strip()
    if len(key) < 3:
        return []
    return [
        {name: value for name, value in place.items() if name != "aliases"}
        for place in LANDMARKS
        if any(alias == key or alias.startswith(key) for alias in place["aliases"])
    ]


DEMO_ORIGIN = LANDMARKS[0]
DEMO_DESTINATION = LANDMARKS[1]
