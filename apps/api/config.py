"""Shared runtime constants and Indonesian incident copy."""

import os

RING_TIMEOUT_S = 30
MAX_ATTEMPTS = 3
MAX_TOTAL_ATTEMPTS = 6
WAIT_TICK_S = 8
LLM_TIMEOUT_S = 1.5
HALF_DUPLEX_TAIL_S = 0.3
USER_LINK_LOST_S = 15


def env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name, default)


INCIDENTS: dict[str, dict] = {
    'kebakaran': {"label": 'Kebakaran', "phrase": 'kebakaran', "colorVar": '--incident-fire', "icon": 'flame', "ready_phrases": ['Api di dapur', 'Api sudah besar', 'Ada orang di dalam']},
    'kecelakaan': {"label": 'Kecelakaan', "phrase": 'kecelakaan lalu lintas', "colorVar": '--incident-crash', "icon": 'car-crash', "ready_phrases": ['Motor tertabrak', 'Korban di jalan', 'Ada yang berdarah']},
    'sakit': {"label": 'Sakit', "phrase": 'keadaan darurat medis', "colorVar": '--incident-medical', "icon": 'heartbeat', "ready_phrases": ['Pingsan tiba-tiba', 'Sesak napas', 'Nyeri dada']},
    'kejahatan': {"label": 'Kejahatan', "phrase": 'tindak kejahatan', "colorVar": '--incident-crime', "icon": 'user-exclamation', "ready_phrases": ['Orang masuk rumah', 'Pelaku masih ada', 'Saya dirampok']},
    'kdrt': {"label": 'KDRT', "phrase": 'kekerasan dalam rumah tangga', "colorVar": '--incident-dv', "icon": 'home-exclamation', "ready_phrases": ['Saya dipukul', 'Pelaku di rumah', 'Saya tidak aman']},
    'bencana': {"label": 'Bencana', "phrase": 'bencana', "colorVar": '--incident-disaster', "icon": 'ripple', "ready_phrases": ['Rumah kebanjiran', 'Tanah longsor', 'Gempa, rumah rusak']},
    'umum': {"label": 'Darurat', "phrase": 'keadaan darurat', "colorVar": '--color-sos', "icon": 'alert-triangle', "ready_phrases": ['Saya butuh bantuan', 'Ada yang terluka', 'Saya tidak aman']},
}

PHRASES: dict[str, str] = {
    'P_INTRO': 'Ini panggilan relay otomatis atas nama seorang warga tuli yang tidak bisa berbicara lewat telepon.',
    'P_WAIT': 'Mohon tunggu, pengguna sedang memilih jawaban.',
    'P_REPEAT': 'Mohon ulangi pertanyaannya, pelan-pelan.',
    'P_YES': 'Ya.',
    'P_NO': 'Tidak.',
    'P_DONTKNOW': 'Saya tidak tahu.',
    'P_UNDERSTOOD': 'Baik, saya mengerti.',
    'P_REPEAT_INSTR': 'Mohon ulangi arahannya.',
    'P_CANCEL': 'Panggilan dibatalkan oleh pengguna. Maaf, ini tidak sengaja.',
    'P_USER_LOST': 'Sambungan pengguna terputus. Jenis kejadian dan lokasi sudah disampaikan di awal panggilan.',
    'P_TYPED_PREFIX': 'Pengguna mengetik:',
    "P_DIGITS_1": 'Satu.',
    "P_DIGITS_2": 'Dua.',
    "P_DIGITS_3": 'Tiga.',
    "P_DIGITS_4": 'Empat.',
    "P_DIGITS_5": 'Lima.',
}
