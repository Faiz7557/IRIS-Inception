/** UUIDs and datetimes are strings on the JSON wire. */
export type CallState =
  | "SIAGA" | "MEMANGGIL" | "PEMBUKA" | "MENDENGAR"
  | "MENYEDERHANAKAN" | "MENUNGGU_JAWABAN" | "MEMBACAKAN"
  | "FALLBACK" | "SELESAI";
export type Incident = "kebakaran" | "kecelakaan" | "sakit" | "kejahatan" | "kdrt" | "bencana" | "umum";
export type Kind = "ya_tidak" | "angka" | "lokasi" | "pilihan" | "terbuka" | "instruksi";
export type Action = "ucap" | "kirim_gps" | "ketik" | "ulangi";
export type Mode = "latihan" | "simulasi";

export interface Option { label: string; action: Action; spoken: string }
export interface Card {
  card_id: string;
  kind: Kind;
  question: string;
  transcript: string;
  options: Option[];
  degradation: number;
}
export interface Location {
  lat: number;
  lng: number;
  accuracy_m: number;
  captured_at: string;
}
export interface CreateCall {
  incident?: Incident;
  mode: Mode;
  device_key: string;
  location?: Location | null;
  client_ts: string;
}
export interface LlmOption { label: string; ucapan: string }
export interface LlmCard { pertanyaan_pendek: string; jenis: Kind; opsi: LlmOption[] }
export interface LlmOutput { kartu: LlmCard[] }

export interface Envelope<T extends string = string, D = Record<string, unknown>> {
  v: number;
  type: T;
  seq: number;
  call_id: string;
  ts: string;
  data: D;
}

export interface ClientOption { index: number; label: string; action: Action }
export interface ClientCard extends Omit<Card, "options"> {
  turn_no: number;
  index: number;
  total: number;
  options: ClientOption[];
}
export interface StateData { state: CallState; attempt: number; max_attempts: number }
export interface DispatchData { dispatched_at: string; source: "keyword" | "console" }
export interface TimelineData {
  answered_at: string | null;
  location_confirmed_at: string | null;
  dispatched_at: string | null;
  contacts_notified_at: string | null;
}
export interface FallbackData {
  reason: string;
  contacts_notified: number;
  can_retry: boolean;
  sms_text: string;
}
export interface EndedData {
  reason: "operator_hangup" | "user_cancel" | "fallback_exhausted" | "user_link_lost" | "error";
  duration_s: number;
}

export type ServerToUser =
  | Envelope<"state", StateData>
  | Envelope<"opener", { speaking: true; text: string } | { speaking: false }>
  | Envelope<"operator_speaking", { active: boolean }>
  | Envelope<"transcript_partial", { text: string }>
  | Envelope<"info", { turn_no: number; transcript: string }>
  | Envelope<"card", ClientCard>
  | Envelope<"answer_status", { card_id: string; option_index: number; status: "speaking" | "spoken" | "failed" }>
  | Envelope<"degradation", { level: number; reason: string }>
  | Envelope<"dispatch", DispatchData>
  | Envelope<"timeline", TimelineData>
  | Envelope<"fallback", FallbackData>
  | Envelope<"ended", EndedData>
  | Envelope<"pong", { client_ts: string; server_ts: string }>;

export interface CardShownData { card_id: string; client_ts: string }
export interface TapData extends CardShownData { option_index: number }
export interface GpsData extends TapData { lat: number; lng: number; accuracy_m: number }
export interface TextData extends TapData { text: string }
export interface CancelData { confirm: true }
export type EmptyData = Record<string, never>;
export interface ResumeData { last_seq: number }
export interface AckData { seq: number }
export interface PingData { client_ts: string }
export interface AnswerData { codec: "pcm16_16k" | "mulaw_8k" }
export interface OperatorTextData { text: string }
export interface ForceDegradationData { llm: boolean; stt: boolean; tts: boolean }

export type Tap = { type: "tap"; data: TapData };
export type Gps = { type: "gps"; data: GpsData };
export type Text = { type: "text"; data: TextData };
export type Repeat = { type: "repeat"; data: CardShownData };
export type Cancel = { type: "cancel"; data: CancelData };
export type Retry = { type: "retry"; data: EmptyData };
export type Resume = { type: "resume"; data: ResumeData };
export type Ack = { type: "ack"; data: AckData };
export type Ping = { type: "ping"; data: PingData };
export type CardShown = { type: "card_shown"; data: CardShownData };
export type Answer = { type: "answer"; data: AnswerData };
export type Reject = { type: "reject"; data: EmptyData };
export type OperatorText = { type: "operator_text"; data: OperatorTextData };
export type Dispatch = { type: "dispatch"; data: EmptyData };
export type Hangup = { type: "hangup"; data: EmptyData };
export type AudioStarted = { type: "audio_started"; data: PingData };
export type ForceDegradation = { type: "force_degradation"; data: ForceDegradationData };

export type UserToServer = Tap | Gps | Text | Repeat | Cancel | Retry | Resume | Ack | Ping | CardShown;
export type ConsoleToServer = Answer | Reject | OperatorText | Dispatch | Hangup | AudioStarted | ForceDegradation;

export type ServerToConsole =
  | Envelope<"incoming_call", { call_id: string; incident: Incident; mode: Mode; attempt: number }>
  | Envelope<"call_removed", { call_id: string }>
  | Envelope<"state", { state: CallState; attempt: number }>
  | Envelope<"log", { who: "sistem" | "operator"; text: string; turn_no: number; latency_a_ms: number | null; latency_b_ms: number | null }>
  | Envelope<"card_preview", Card>
  | Envelope<"half_duplex", { muted: boolean }>
  | Envelope<"sms_simulated", { to: string; text: string }>;

export type ServerToContact = Extract<ServerToUser, { type: "state" | "dispatch" | "fallback" | "ended" }>;
