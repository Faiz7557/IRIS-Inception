import asyncio

import httpx
import pytest

import geocode
from dispatch import is_dispatch, is_repeat_opener
from opener import build_opener, format_coord, gps_utterance

FULL_PROFILE = {
    "display_name": "Budi",
    "landmark": "depan masjid",
    "medical_notes": "asma",
    "blood_type": "O",
    "address": "Jl. Mawar 1, Sukun, Malang",
    "medical_consent": True,
}
LOC_GOOD = {"lat": -7.257523, "lng": 112.75213, "accuracy_m": 12.0}


def test_opener_all_slots_gps_accurate():
    text = build_opener(FULL_PROFILE, "sakit", LOC_GOOD, "Jl. Mawar 1, Sukun, Malang")
    assert text.splitlines() == [
        "Ini panggilan relay otomatis atas nama seorang warga tuli yang tidak bisa berbicara lewat telepon.",
        "Nama pelapor Budi.",
        "Terjadi keadaan darurat medis di Jl. Mawar 1, Sukun, Malang, koordinat -7,25752, 112,75213.",
        "Patokan: depan masjid.",
        "Catatan medis pelapor: asma. Golongan darah O.",
        "Silakan bertanya; jawaban akan dibacakan sistem.",
    ]


def test_opener_empty_slots_are_dropped():
    profile = {"display_name": "", "landmark": "", "medical_notes": "", "blood_type": "",
               "address": "", "medical_consent": False}
    lines = build_opener(profile, "umum", None, None).splitlines()
    assert lines == [
        "Ini panggilan relay otomatis atas nama seorang warga tuli yang tidak bisa berbicara lewat telepon.",
        "Terjadi keadaan darurat di lokasi belum diketahui.",
        "Silakan bertanya; jawaban akan dibacakan sistem.",
    ]


def test_opener_none_profile():
    text = build_opener(None, "kebakaran", None, None)
    assert "Terjadi kebakaran di lokasi belum diketahui." in text
    assert "Nama pelapor" not in text


@pytest.mark.parametrize("consent, incident", [(False, "sakit"), (True, "kebakaran"), (True, "kejahatan")])
def test_medical_line_gated(consent, incident):
    profile = {**FULL_PROFILE, "medical_consent": consent}
    assert "Catatan medis" not in build_opener(profile, incident, LOC_GOOD, "X")


@pytest.mark.parametrize("incident", ["sakit", "kecelakaan"])
def test_medical_line_shown_for_medical_incidents(incident):
    assert "Golongan darah O." in build_opener(FULL_PROFILE, incident, LOC_GOOD, "X")


def test_gps_exactly_100m_uses_coordinates():
    loc = {**LOC_GOOD, "accuracy_m": 100}
    text = build_opener(FULL_PROFILE, "kebakaran", loc, "Jl. Mawar")
    assert "Terjadi kebakaran di Jl. Mawar, koordinat -7,25752, 112,75213." in text


def test_gps_over_100m_uses_profile_address_with_warning():
    loc = {**LOC_GOOD, "accuracy_m": 100.1}
    text = build_opener(FULL_PROFILE, "kebakaran", loc, "Jl. Mawar")
    assert "Terjadi kebakaran di Jl. Mawar 1, Sukun, Malang, lokasi GPS tidak akurat." in text


def test_no_gps_uses_profile_address_with_unavailable():
    text = build_opener(FULL_PROFILE, "kebakaran", None, None)
    assert "Terjadi kebakaran di Jl. Mawar 1, Sukun, Malang, lokasi GPS tidak tersedia." in text


def test_gps_good_without_address_text_gives_coordinates_only():
    text = build_opener(FULL_PROFILE, "kebakaran", LOC_GOOD, None)
    assert "Terjadi kebakaran di koordinat -7,25752, 112,75213." in text


def test_format_coord():
    assert format_coord(-7.257523) == "-7,25752"
    assert format_coord(112.75213) == "112,75213"
    assert format_coord(3) == "3,00000"


def test_gps_utterance_with_and_without_address():
    assert gps_utterance("Jl. Mawar", -7.257523, 112.75213, 12.4) == (
        "Lokasi saya sesuai GPS: Jl. Mawar. Koordinat -7,25752, 112,75213. Akurasi sekitar 12 meter."
    )
    assert gps_utterance(None, -7.257523, 112.75213, 12.6) == (
        "Lokasi saya sesuai GPS. Koordinat -7,25752, 112,75213. Akurasi sekitar 13 meter."
    )


POSITIVE_DISPATCH = [
    "Petugas sudah dikirim ke lokasi",
    "Ambulans sedang menuju ke sini",
    "Pemadam kebakaran sudah berangkat",
    "Polisi segera datang ya",
    "Tim bantuan dalam perjalanan",
    "Damkar meluncur sekarang",
    "Ambulan otw",
    "Bantuan sudah jalan",
    "Petugas segera datang",
    "Tim medis sudah berangkat dari pos",
]

NEGATIVE_DISPATCH = [
    "Api sudah besar di dapur",
    "Ada orang di dalam rumah",
    "Saya butuh bantuan",
    "Saya perlu ambulans",
    "Polisi sudah ada di sini",
    "Pelakunya masih di rumah",
    "Saya tidak tahu harus bagaimana",
    "Tolong cepat, rumah saya kebanjiran",
    "Jalan menuju stasiun macet",
    "Timnya belum datang",
]


@pytest.mark.parametrize("text", POSITIVE_DISPATCH)
def test_dispatch_positive(text):
    assert is_dispatch(text)


@pytest.mark.parametrize("text", NEGATIVE_DISPATCH)
def test_dispatch_negative(text):
    assert not is_dispatch(text)


@pytest.mark.parametrize("text", [
    "Ulangi alamatnya tadi",
    "tolong ulang lokasinya",
    "ULANG LOKASI dong",
    "Bisa ulang alamat?",
])
def test_repeat_opener_positive(text):
    assert is_repeat_opener(text)


@pytest.mark.parametrize("text", [
    "ulangi pesan pembukanya",
    "alamatnya di mana?",
    "lokasi rumah saya di Sukun",
    "",
])
def test_repeat_opener_negative(text):
    assert not is_repeat_opener(text)


def test_reverse_geocode_parses_address_and_sends_headers(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["ua"] = request.headers["user-agent"]
        return httpx.Response(200, json={"address": {
            "road": "Jl. Mawar", "village": "Sukun", "city": "Malang", "postcode": "65000"}})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(geocode.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    result = asyncio.run(geocode.reverse_geocode(-7.257523, 112.75213))
    assert result == "Jl. Mawar, Sukun, Malang"
    assert "accept-language=id" in seen["url"] and "format=jsonv2" in seen["url"]
    assert seen["ua"] == "jembatan112/1.0"


def test_reverse_geocode_returns_none_on_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline")

    real_client = httpx.AsyncClient
    monkeypatch.setattr(geocode.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    assert asyncio.run(geocode.reverse_geocode(-7.0, 112.0)) is None
