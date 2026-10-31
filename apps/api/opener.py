"""Deterministic opening script for the relay call (TRD 5.5)."""

from config import INCIDENTS, PHRASES

MEDICAL_INCIDENTS = {"sakit", "kecelakaan"}
GPS_GOOD_M = 100


def format_coord(x: float) -> str:
    """Five decimals with Indonesian comma so TTS reads it right: -7,25752."""
    return f"{x:.5f}".replace(".", ",")


def gps_utterance(address_text: str | None, lat: float, lng: float, accuracy_m: float) -> str:
    head = f"Lokasi saya sesuai GPS: {address_text}." if address_text else "Lokasi saya sesuai GPS."
    return f"{head} Koordinat {format_coord(lat)}, {format_coord(lng)}. Akurasi sekitar {round(accuracy_m)} meter."


def build_opener(profile: dict | None, incident: str, location: dict | None, address_text: str | None) -> str:
    profile = profile or {}
    phrase = INCIDENTS.get(incident, {}).get("phrase", "keadaan darurat")

    accuracy = location.get("accuracy_m") if location else None
    if location and accuracy is not None and accuracy <= GPS_GOOD_M:
        coords = f"koordinat {format_coord(location['lat'])}, {format_coord(location['lng'])}"
        where = f"{address_text}, {coords}" if address_text else coords
    elif profile.get("address"):
        where = f"{profile['address']}, lokasi GPS {'tidak akurat' if location else 'tidak tersedia'}"
    else:
        where = "lokasi belum diketahui"

    medical = ""
    notes, blood = profile.get("medical_notes"), profile.get("blood_type")
    if profile.get("medical_consent") and incident in MEDICAL_INCIDENTS and (notes or blood):
        parts = []
        if notes:
            parts.append(f"Catatan medis pelapor: {notes}.")
        if blood:
            parts.append(f"Golongan darah {blood}.")
        medical = " ".join(parts)

    lines = [
        PHRASES["P_INTRO"],
        f"Nama pelapor {profile['display_name']}." if profile.get("display_name") else "",
        f"Terjadi {phrase} di {where}.",
        f"Patokan: {profile['landmark']}." if profile.get("landmark") else "",
        medical,
        "Silakan bertanya; jawaban akan dibacakan sistem.",
    ]
    return "\n".join(line for line in lines if line)
