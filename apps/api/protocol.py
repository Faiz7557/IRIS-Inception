"""Validated payloads and client message envelopes for the relay protocol.

Run ``python apps/api/protocol.py`` for the contract self-check.
"""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID
import unicodedata

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, field_validator


class CallState(StrEnum):
    SIAGA = "SIAGA"
    MEMANGGIL = "MEMANGGIL"
    PEMBUKA = "PEMBUKA"
    MENDENGAR = "MENDENGAR"
    MENYEDERHANAKAN = "MENYEDERHANAKAN"
    MENUNGGU_JAWABAN = "MENUNGGU_JAWABAN"
    MEMBACAKAN = "MEMBACAKAN"
    FALLBACK = "FALLBACK"
    SELESAI = "SELESAI"


Incident = Literal["kebakaran", "kecelakaan", "sakit", "kejahatan", "kdrt", "bencana", "umum"]
Kind = Literal["ya_tidak", "angka", "lokasi", "pilihan", "terbuka", "instruksi"]
Action = Literal["ucap", "kirim_gps", "ketik", "ulangi"]


class Option(BaseModel):
    label: str
    action: Action
    spoken: str


class Card(BaseModel):
    card_id: UUID
    kind: Kind
    question: str
    transcript: str
    options: list[Option]
    degradation: int = Field(default=0, ge=0, le=5)


class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0, le=10_000)
    captured_at: datetime


class CreateCall(BaseModel):
    incident: Incident = "umum"
    mode: Literal["latihan", "simulasi"]
    device_key: UUID
    location: Location | None = None
    client_ts: datetime


class LlmOption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    ucapan: str


class LlmCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pertanyaan_pendek: str
    jenis: Kind
    opsi: list[LlmOption]


class LlmOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kartu: list[LlmCard]


# TODO(integrator): apply the semantic LLM validators from TRD §6.3.4 (outside T02's reading scope).


class Envelope(BaseModel):
    v: int = 1
    type: str
    seq: int
    call_id: UUID
    ts: datetime
    data: dict


def card_for_client(card: Card) -> dict:
    result = card.model_dump(mode="json", exclude={"options"})
    result["options"] = [
        {"index": index, "label": option.label, "action": option.action}
        for index, option in enumerate(card.options)
    ]
    return result


class CardShownData(BaseModel):
    card_id: UUID
    client_ts: datetime


class TapData(CardShownData):
    option_index: int = Field(ge=0)


class GpsData(TapData):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0, le=10_000)


class TextData(TapData):
    text: str = Field(min_length=1, max_length=80)

    @field_validator("text", mode="before")
    @classmethod
    def strip_controls(cls, value: object) -> object:
        if isinstance(value, str):
            return "".join(char for char in value if unicodedata.category(char) != "Cc")
        return value


class CancelData(BaseModel):
    confirm: Literal[True]


class EmptyData(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ResumeData(BaseModel):
    last_seq: int = Field(ge=0)


class AckData(BaseModel):
    seq: int = Field(ge=0)


class PingData(BaseModel):
    client_ts: datetime


class AnswerData(BaseModel):
    codec: Literal["pcm16_16k", "mulaw_8k"]


class OperatorTextData(BaseModel):
    text: str = Field(min_length=1)


class ForceDegradationData(BaseModel):
    llm: bool
    stt: bool
    tts: bool


class Tap(BaseModel):
    type: Literal["tap"] = "tap"
    data: TapData


class Gps(BaseModel):
    type: Literal["gps"] = "gps"
    data: GpsData


class Text(BaseModel):
    type: Literal["text"] = "text"
    data: TextData


class Repeat(BaseModel):
    type: Literal["repeat"] = "repeat"
    data: CardShownData


class Cancel(BaseModel):
    type: Literal["cancel"] = "cancel"
    data: CancelData


class Retry(BaseModel):
    type: Literal["retry"] = "retry"
    data: EmptyData


class Resume(BaseModel):
    type: Literal["resume"] = "resume"
    data: ResumeData


class Ack(BaseModel):
    type: Literal["ack"] = "ack"
    data: AckData


class Ping(BaseModel):
    type: Literal["ping"] = "ping"
    data: PingData


class CardShown(BaseModel):
    type: Literal["card_shown"] = "card_shown"
    data: CardShownData


class Answer(BaseModel):
    type: Literal["answer"] = "answer"
    data: AnswerData


class Reject(BaseModel):
    type: Literal["reject"] = "reject"
    data: EmptyData


class OperatorText(BaseModel):
    type: Literal["operator_text"] = "operator_text"
    data: OperatorTextData


class Dispatch(BaseModel):
    type: Literal["dispatch"] = "dispatch"
    data: EmptyData


class Hangup(BaseModel):
    type: Literal["hangup"] = "hangup"
    data: EmptyData


class AudioStarted(BaseModel):
    type: Literal["audio_started"] = "audio_started"
    data: PingData


class ForceDegradation(BaseModel):
    type: Literal["force_degradation"] = "force_degradation"
    data: ForceDegradationData


UserToServer = Annotated[
    Tap | Gps | Text | Repeat | Cancel | Retry | Resume | Ack | Ping | CardShown,
    Field(discriminator="type"),
]
ConsoleToServer = Annotated[
    Answer | Reject | OperatorText | Dispatch | Hangup | AudioStarted | ForceDegradation,
    Field(discriminator="type"),
]


if __name__ == "__main__":
    from uuid import uuid4

    card = Card(card_id=uuid4(), kind="ya_tidak", question="Korban sadar?",
                transcript="Korbannya masih sadar?",
                options=[Option(label="Ya", action="ucap", spoken="Ya, korban sadar.")])
    public = card_for_client(card)
    assert public["options"] == [{"index": 0, "label": "Ya", "action": "ucap"}]
    assert card.options[0].spoken == "Ya, korban sadar."
    assert public["card_id"] == str(card.card_id)
    payload = {"card_id": str(card.card_id), "option_index": 0, "client_ts": "2026-10-31T00:00:00Z"}
    adapter = TypeAdapter(UserToServer)
    assert adapter.validate_python({"type": "text", "data": {**payload, "text": "Ya\n"}}).data.text == "Ya"
    invalid = [
        {"type": "text", "data": {**payload, "text": ""}},
        {"type": "text", "data": {**payload, "text": "\n"}},
        {"type": "text", "data": {**payload, "text": "x" * 81}},
        {"type": "tap", "data": {**payload, "option_index": -1}},
        {"type": "gps", "data": {**payload, "lat": 91, "lng": 0, "accuracy_m": 1}},
        {"type": "gps", "data": {**payload, "lat": 0, "lng": -181, "accuracy_m": 1}},
        {"type": "gps", "data": {**payload, "lat": 0, "lng": 0, "accuracy_m": -1}},
        {"type": "cancel", "data": {"confirm": False}},
    ]
    for message in invalid:
        try:
            adapter.validate_python(message)
        except ValidationError:
            continue
        raise AssertionError(f"Accepted invalid message: {message['type']}")
    print("protocol self-check ok")
