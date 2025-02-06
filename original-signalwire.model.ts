//Server Side\src\signalwire\signalwire.model.ts
export interface connectToConferenceRoomResponse {
  message: string;
  conferenceName: string;
  conferenceSid: string;
  binName: string;
  laMLBinUrl: string;
}

export interface incomingCallNotificationRequest {
  CallSid: string;
  AccountSid?: string;
  ApiVersion?: string;
  Direction?: "inbound" | "outbound";
  From?: string;
  To?: string;
  Timestamp?: string; // e.g., 'Wed, 09 Oct 2024 23:42:53 +0000'
  CallStatus?:
    | "queued"
    | "initiated"
    | "ringing"
    | "in-progress"
    | "completed"
    | "busy"
    | "failed"
    | "no-answer"
    | "canceled";
  CallbackSource?: string; // e.g., 'call-progress-events'
  CallDuration?: string; // Duration in seconds as a string
  AudioInMos?: string; // Optional Mean Opinion Score
  HangupDirection?: "inbound" | "outbound"; // Optional
  HangupBy?: string; // Optional, could be a phone number or identifier

  // New fields for event types
  StatusCallbackEvent?:
    | "participant-join"
    | "participant-leave"
    | "conference-start"
    | "conference-end"
    | "ringing"
    | "answered"
    | "completed"
    | string; // Event types from SignalWire

  // Fields specific to conference events
  ConferenceSid?: string;
  FriendlyName?: string; // Name of the conference
  ReasonConferenceEnded?: string; // e.g., 'last-participant-left'
  CallSidEndingConference?: string; // CallSid that ended the conference

  // Additional fields for participant events
  Muted?: "true" | "false"; // Received as strings from SignalWire
  Hold?: "true" | "false";
  EndConferenceOnExit?: "true" | "false";
  StartConferenceOnEnter?: "true" | "false";
  Coaching?: "true" | "false";
  CallSidToCoach?: string;

  // Additional optional fields
  CallerName?: string; // Optional, if available
  SequenceNumber?: string; // Optional sequence number of the event
}

export interface addParticipantRequest {
  from: string;
  to: string;
  lamlBinUrl: string;
}

export interface didNumbersResponse {
  phoneNumber: string;
  status: DIDCallStatus;
  assigned_user: string;
}

export enum DIDCallStatus {
  Assigned = "Assigned",
  Unassigned = "Unassigned",
}

export interface RingGroup {
  phone_number: string;
  ring_group: string;
  display_name: string;
}

export interface CombinedLeadData {
  id: number;
  global_id: string | null;
  lead_id: string | null;
  tu_pk: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
  email: string | null;
  dob: Date | null;
  veteran: boolean | null;
  credit: string | null;
  marital_status: string | null;
  first_name_b2: string | null;
  last_name_b2: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  home_phone: string | null;
  cell_phone: string | null;
  property_use: string | null;
  property_type: string | null;
  loan_purpose: string | null;
  mortgage_balance: number | null;
  second_mortgage_balance: number | null;
  desired_loan_amount: number | null;
  estimated_value: number | null;
  lead_source: string | null;
  ulid: string | null;
  status: string | null;
  assigned_to: string | null;
  assigned_at: Date | null;
  updated_at: Date | null;
  created_at: Date | null;
}

// signalwire.model.ts
export interface VoiceStatusCallback {
  CallSid: string;
  CallStatus: string;
  From: string;
  To: string;
  CallDuration?: number;
  RecordingUrl?: string;
  participantSid: string;
  // Add other relevant fields as needed
}
