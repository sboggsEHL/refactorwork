// signalwire.context.tsx

import React, {
  createContext,
  useState,
  ReactNode,
  useEffect,
  useContext,
  useRef,
} from "react";
import { useUser } from "./UserContext";
import {
  SignalWire,
  SignalWireContract,
} from "@signalwire/js/dist/js/src/fabric";
import { SignalWire as SW } from "@signalwire/js";
import {
  CallState,
  ConnectToConferenceRoomResponse,
  DialResponse,
  RingGroupNotification,
} from "../models/signalwire";
import WebSocketClient from "../helpers/WebSocketClient";
import { useToast } from "../context/ToastContext";
import { formatPhoneNumber } from "../utils";
import { WebRTC } from "@signalwire/js";

interface SignalWireContextProps {
  client: SignalWireContract | null;
  dialNumber: (number: string) => Promise<void>;
  connectToConferenceRoom: (
    initializedClient?: SignalWireContract
  ) => Promise<void>;
  endCall: () => Promise<void>;
  callState: CallState;
  requestPermissions: () => Promise<void>;
  token?: string;
  mute: () => Promise<void>;
  unmute: () => Promise<void>;

  // In-call microphone & speaker
  currentMicrophone: string | null;
  currentOutputDevice: string | null;

  // Ring speaker device
  currentRingDevice: string | null;

  // Arrays of devices
  availableMicrophones: MediaDeviceInfo[];
  availableSpeakers: MediaDeviceInfo[];

  // Functions to manually switch mic/speaker/ring speaker
  applyMicrophone: (deviceId: string) => Promise<void>;
  applySpeaker: (deviceId: string) => Promise<void>;
  applyRingDevice: (deviceId: string) => Promise<void>;

  holdCall: () => Promise<void>;
  resumeCall: () => Promise<void>;
  disconnectFromConference: () => Promise<void>;
  isLoading: boolean;
  errorMessage: string | null;
  listCalls: () => Promise<void>;
  listConferences: () => Promise<void>;
  updateCall: (callSid: string, status: string, url?: string) => Promise<void>;
  deleteParticipant: (conferenceSid: string, callSid: string) => Promise<void>;
  sendDTMF: (digit: string) => Promise<void>;

  // For demonstration: functions to play/stop a ring tone (incoming)
  playRingtone: () => void;
  stopRingtone: () => void;
}

export const SignalWireContext = createContext<SignalWireContextProps>({
  client: null,
  dialNumber: async () => {},
  connectToConferenceRoom: async () => {},
  endCall: async () => {},
  requestPermissions: async () => {},
  mute: async () => {},
  unmute: async () => {},
  holdCall: async () => {},
  resumeCall: async () => {},
  disconnectFromConference: async () => {},
  currentMicrophone: null,
  currentOutputDevice: null,
  currentRingDevice: null,
  availableMicrophones: [],
  availableSpeakers: [],
  applyMicrophone: async () => {},
  applySpeaker: async () => {},
  applyRingDevice: async () => {},
  callState: {
    activeCall: null,
    conferenceSession: null,
  },
  isLoading: false,
  errorMessage: null,
  listCalls: async () => {},
  listConferences: async () => {},
  updateCall: async () => {},
  deleteParticipant: async () => {},
  sendDTMF: async () => {},
  playRingtone: () => {},
  stopRingtone: () => {},
});

export const SignalWireProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { isAuthenticated, username, userApprovedStates } = useUser();
  const { showToast } = useToast();

  const [client, setClient] = useState<SignalWireContract | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  // Device IDs for mic, call speaker, ring speaker
  const [currentMicrophone, setCurrentMicrophone] = useState<string | null>(
    null
  );
  const [currentOutputDevice, setCurrentOutputDevice] = useState<string | null>(
    null
  );
  const [currentRingDevice, setCurrentRingDevice] = useState<string | null>(
    null
  );

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [callState, setCallState] = useState<CallState>({
    activeCall: null,
    conferenceSession: null,
  });

  const [token, setToken] = useState("");
  const [assignedDidNumber, setAssignedDidNumber] = useState("");
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  // Audio references
  const ringAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringBackAudioRef = useRef<HTMLAudioElement | null>(null);

  // Arrays for enumerated devices
  const [availableMicrophones, setAvailableMicrophones] = useState<
    MediaDeviceInfo[]
  >([]);
  const [availableSpeakers, setAvailableSpeakers] = useState<MediaDeviceInfo[]>(
    []
  );

  // Track laML URL from the conference
  const laMLBinUrlRef = useRef(callState?.conferenceSession?.laMLBinUrl || "");
  useEffect(() => {
    laMLBinUrlRef.current = callState?.conferenceSession?.laMLBinUrl || "";
  }, [callState?.conferenceSession?.laMLBinUrl]);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1) Create a ref that always contains the latest activeCallSid
  // ─────────────────────────────────────────────────────────────────────────────
  const activeCallSidRef = useRef<string | null>(null);

  // Whenever our activeCall changes, update that ref
  useEffect(() => {
    activeCallSidRef.current = callState.activeCall?.callSid ?? null;
  }, [callState.activeCall?.callSid]);

  /**
   * Create hidden audio elements for ring tones. We'll do this once on mount.
   */
  useEffect(() => {
    console.log("[useEffect] Creating <audio> elements for ring/ringBack...");

    // --- Incoming call ring tone
    const audioEl = document.createElement("audio");
    audioEl.src =
      "https://.digitaloceanspaces.com/mp3/incoming_call.mp3";
    audioEl.loop = true;
    audioEl.volume = 1.0;
    document.body.appendChild(audioEl);
    ringAudioRef.current = audioEl;

    // --- Outbound call ringback tone
    const ringBackEl = document.createElement("audio");
    ringBackEl.src =
      "https://.cdn.digitaloceanspaces.com/mp3/US_ringback_tone.mp3";
    ringBackEl.loop = true;
    ringBackEl.volume = 1.0;
    document.body.appendChild(ringBackEl);
    ringBackAudioRef.current = ringBackEl;

    // Create remote audio element for speaker
    const remoteAudioEl = document.createElement("audio");
    remoteAudioEl.autoplay = true;
    document.body.appendChild(remoteAudioEl);

    return () => {
      console.log("[useEffect cleanup] Removing <audio> elements...");
      if (ringAudioRef.current) {
        ringAudioRef.current.pause();
        document.body.removeChild(ringAudioRef.current);
      }
      if (ringBackAudioRef.current) {
        ringBackAudioRef.current.pause();
        document.body.removeChild(ringBackAudioRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const setupDeviceWatchers = async () => {
      // Speaker watcher
      const speakerWatcher = await WebRTC.createSpeakerDeviceWatcher();
      speakerWatcher.on("changed", ({ devices }) => {
        console.log("[Speaker Watcher] Device change event:", devices);

        // If we have a current output device, verify it still exists
        if (currentOutputDevice) {
          const deviceStillExists = devices.some(
            (device) =>
              device.deviceId === currentOutputDevice ||
              device.label === currentOutputDevice
          );

          if (!deviceStillExists) {
            // Device was removed, fall back to default
            const defaultDevice = devices[0]?.deviceId;
            if (defaultDevice) {
              applySpeaker(defaultDevice);
            }
          }
        }
      });

      // Microphone watcher
      const micWatcher = await WebRTC.createMicrophoneDeviceWatcher();
      micWatcher.on("changed", ({ devices }) => {
        console.log("[Microphone Watcher] Device change event:", devices);

        // If we have a current microphone, verify it still exists
        if (currentMicrophone) {
          const deviceStillExists = devices.some(
            (device) =>
              device.deviceId === currentMicrophone ||
              device.label === currentMicrophone
          );

          if (!deviceStillExists) {
            // Device was removed, fall back to default
            const defaultDevice = devices[0]?.deviceId;
            if (defaultDevice) {
              applyMicrophone(defaultDevice);
            }
          }
        }
      });

      // Cleanup function
      return () => {
        // speakerWatcher.destroy();
        // micWatcher.destroy();
      };
    };

    setupDeviceWatchers().catch((err) => {
      console.error("[Device Watchers] Setup error:", err);
    });
  }, []); // Empty dependency array since we only want to set this up once

  /**
   * If the user changes currentRingDevice, apply it to both ringAudioRef & ringBackAudioRef
   */
  useEffect(() => {
    if (currentRingDevice) {
      console.log(
        `[useEffect] currentRingDevice changed => ${currentRingDevice}`
      );

      // For incoming ring
      if (ringAudioRef.current && "setSinkId" in ringAudioRef.current) {
        (ringAudioRef.current as any)
          .setSinkId(currentRingDevice)
          .then(() => {
            console.log("[ringAudioRef] sinkId set to:", currentRingDevice);
          })
          .catch((err: any) => {
            console.error("[ringAudioRef] Failed to set sink:", err);
          });
      }

      // For outbound ringback
      if (ringBackAudioRef.current && "setSinkId" in ringBackAudioRef.current) {
        (ringBackAudioRef.current as any)
          .setSinkId(currentRingDevice)
          .then(() => {
            console.log("[ringBackAudioRef] sinkId set to:", currentRingDevice);
          })
          .catch((err: any) => {
            console.error("[ringBackAudioRef] Failed to set sink:", err);
          });
      }
    }
  }, [currentRingDevice]);

  // ------------------------------------------------------------------------------
  // WEBHOOK & SOCKET LOGIC
  // ------------------------------------------------------------------------------
  useEffect(() => {
    console.log("[useEffect] Checking authentication status...");
    if (isAuthenticated) {
      console.log(
        "[useEffect] User is authenticated. Initializing WebSocket..."
      );
      const signalWireSocket = new WebSocketClient(
        import.meta.env.VITE_WEBSOCKET_BASE_URL,
        "/signalwire"
      );

      fetchAssignedDIDNumber();
      signalWireSocket.connect();

      signalWireSocket.on("incoming-call", (data: any) => {
        console.log("[incoming-call] event =>", data);

        showToast("Incoming Call", `From: ${formatPhoneNumber(data.from)}`, {
          toastType: "call",
          callSid: data.callSid,
          fromNumber: data.from,
          primaryActionLabel: window.electron ? "Answer" : "Accept call",
          primaryAction: async () => {
            console.log("[incoming-call] => user clicked Accept");
            await connectIncomingCall(
              data.callSid,
              laMLBinUrlRef.current,
              data.from
            );
          },
          secondaryActionLabel: window.electron ? "Decline" : "Ignore",
          secondaryAction: () => {
            console.log("[incoming-call] => user clicked Ignore");
            stopRingtone();
          },
        });
      });

      signalWireSocket.on("call-ended", (data: any) => {
        console.log("[call-ended] =>", data);
        // Compare data.callSid to your active call. If they match, clear UI.
        if (data.callSid === activeCallSidRef.current) {
          clearActiveCallState();
          stopRingtone();
        }
      });

      signalWireSocket.on(
        "ring-group-notification",
        (data: RingGroupNotification) => {
          console.log("[ring-group-notification] =>", data);
          const leadData = data.leadData;
          if (
            userApprovedStates.includes(leadData?.state?.toUpperCase() || "")
          ) {
            showToast(
              `Incoming call from: ${data?.leadData?.first_name || data.from}`,
              `Phone: ${formatPhoneNumber(data.from)}`,
              {
                toastType: "call",
                callSid: data.callSid,
                fromNumber: data.from,
                primaryActionLabel: window.electron ? "Answer" : "Accept call",
                primaryAction: async () => {
                  console.log("[ring-group] => user clicked Accept");
                  await connectIncomingCall(
                    data.callSid,
                    laMLBinUrlRef.current,
                    data.from
                  );
                },
                secondaryActionLabel: window.electron ? "Decline" : "Ignore",
                secondaryAction: () => {
                  console.log("[ring-group] => user clicked Ignore");
                  stopRingtone();
                },
              }
            );
          }
        }
      );

      // agent-specific notifications
      signalWireSocket.on(`user-notification-${username}`, (data: any) => {
        console.log("[user-notification] =>", data);
        playRingtone();

        showToast(
          data.leadData
            ? `Incoming call from: ${data.leadData.first_name}`
            : "Direct Call",
          `Phone: ${formatPhoneNumber(data.from)}`,
          {
            toastType: "call",
            callSid: data.callSid,
            fromNumber: data.from,
            primaryActionLabel: window.electron ? "Answer" : "Accept call",
            primaryAction: async () => {
              console.log("[user-notification] => user clicked Accept");
              stopRingtone();
              await connectIncomingCall(
                data.callSid,
                laMLBinUrlRef.current,
                data.from
              );
            },
            secondaryActionLabel: window.electron ? "Decline" : "Ignore",
            secondaryAction: () => {
              console.log("[user-notification] => user clicked Ignore");
              stopRingtone();
            },
          }
        );
      });

      // ─────────────────────────────────────────────────────────────────────────
      // Use the callSid ref to check if this event matches our active call
      // ─────────────────────────────────────────────────────────────────────────
      signalWireSocket.on("outbound-call-status", (data: any) => {
        console.log("[outbound-call-status] event =>", data);
        if (data.callSid === activeCallSidRef.current) {
          if (data.status === "answered" || data.status === "in-progress") {
            setCallState((prev) => ({
              ...prev,
              activeCall: {
                ...prev.activeCall!,
                status: "connected",
              },
            }));
            // Also stop the ringBack tone
            if (ringBackAudioRef.current) {
              ringBackAudioRef.current.pause();
              ringBackAudioRef.current.currentTime = 0;
            }
          } else if (
            data.status === "completed" ||
            data.status === "no-answer"
          ) {
            clearActiveCallState();
          }
        }
      });

      return () => {
        console.log("[useEffect cleanup] Disconnecting WebSocket...");
        signalWireSocket.disconnect();
      };
    } else {
      console.log(
        "[useEffect] User is not authenticated; skipping socket init"
      );
    }
  }, [isAuthenticated, userApprovedStates, username, showToast]);

  // ------------------------------------------------------------------------------
  // PERMISSIONS & DEVICE ENUMERATION
  // ------------------------------------------------------------------------------
  const enumerateAudioDevices = async () => {
    try {
      console.log("[enumerateAudioDevices] Listing devices...");
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioIn = devices.filter((d) => d.kind === "audioinput");
      const audioOut = devices.filter((d) => d.kind === "audiooutput");

      setAvailableMicrophones(audioIn);
      setAvailableSpeakers(audioOut);

      if (!currentMicrophone && audioIn.length > 0) {
        setCurrentMicrophone(audioIn[0].deviceId);
      }
      if (!currentOutputDevice && audioOut.length > 0) {
        setCurrentOutputDevice(audioOut[0].deviceId);
      }
      if (!currentRingDevice && audioOut.length > 0) {
        setCurrentRingDevice(audioOut[0].deviceId);
      }
    } catch (err) {
      console.error("[enumerateAudioDevices] Error:", err);
    }
  };

  const requestPermissions = async () => {
    try {
      console.log("[requestPermissions] requesting audio permission...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      setMediaStream(stream);
      console.log("[requestPermissions] Microphone permission granted");

      await enumerateAudioDevices();

      // Identify which mic device is used by getUserMedia
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const settings = audioTrack.getSettings();
        const actualDeviceId = settings.deviceId;
        if (actualDeviceId) {
          setCurrentMicrophone(actualDeviceId);
          console.log(
            "[requestPermissions] Using mic deviceId:",
            actualDeviceId
          );
        }
      }
    } catch (error) {
      console.error("[requestPermissions] Error requesting permission:", error);
      throw new Error("Microphone permission denied");
    }
  };

  // ------------------------------------------------------------------------------
  // applyMicrophone / applySpeaker / applyRingDevice
  // ------------------------------------------------------------------------------
  const applyMicrophone = async (deviceId: string) => {
    try {
      console.log("[applyMicrophone] deviceId:", deviceId);
      setCurrentMicrophone(deviceId);

      // Get the current active call session
      const callSession = callState.conferenceSession?.callSession;
      if (!callSession) {
        console.warn("No active call session to apply microphone");
        return;
      }

      callSession?.updateMicrophone({
        deviceId,
      });
    } catch (err) {
      console.error("[applyMicrophone] Error:", err);
    }
  };

  
  const applySpeaker = async (deviceId: string) => {
    try {
        console.log("[applySpeaker] deviceId:", deviceId);
        if (deviceId) {
            await WebRTC.setMediaElementSinkId(
                (callState.conferenceSession?.callSession as any)?._audioEl, 
                deviceId
            );
        } else {
            console.warn("No remote audio element available to set sinkId");
        }
        setCurrentOutputDevice(deviceId);
    } catch (err) {
        console.error("[applySpeaker] Error:", err);
    }
};


  const applyRingDevice = async (deviceId: string) => {
    try {
      console.log("[applyRingDevice] deviceId:", deviceId);
      setCurrentRingDevice(deviceId);
    } catch (err) {
      console.error("[applyRingDevice] Error:", err);
    }
  };

  // ------------------------------------------------------------------------------
  // RING TONE UTILS (INCOMING)
  // ------------------------------------------------------------------------------
  const playRingtone = () => {
    console.log("[playRingtone] invoked");
    if (ringAudioRef.current) {
      ringAudioRef.current.currentTime = 0;
      ringAudioRef.current.play().catch((err) => {
        console.warn("[playRingtone] Failed to autoplay ring tone:", err);
      });
    }
  };

  const stopRingtone = () => {
    console.log("[stopRingtone] invoked");
    if (ringAudioRef.current) {
      ringAudioRef.current.pause();
      ringAudioRef.current.currentTime = 0;
    }
  };

  // ------------------------------------------------------------------------------
  // Stop inbound ring once the inbound call is connected
  // ------------------------------------------------------------------------------
  const [inboundRingStopped, setInboundRingStopped] = useState(false);
  useEffect(() => {
    const active = callState.activeCall;
    if (!active) {
      setInboundRingStopped(false);
      return;
    }
    if (
      active.callType === "inbound" &&
      (active.status === "in-progress" || active.status === "connected") &&
      !inboundRingStopped
    ) {
      stopRingtone();
      setInboundRingStopped(true);
    }
  }, [callState.activeCall, inboundRingStopped]);

  // ------------------------------------------------------------------------------
  // FETCH SIGNALWIRE TOKEN, INIT CLIENT
  // ------------------------------------------------------------------------------
  const fetchSignalWireToken = async (userRef: string): Promise<string> => {
    try {
      console.log("[fetchSignalWireToken] for user:", userRef);
      const response = await fetch(
        `https://${
          import.meta.env.VITE_SIGNALWIRE_SPACE
        }/api/fabric/subscribers/tokens`,
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " +
              btoa(
                `${import.meta.env.VITE_SIGNALWIRE_PROJECT_KEY}:${
                  import.meta.env.VITE_SIGNALWIRE_TOKEN
                }`
              ),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reference: userRef }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch SignalWire token. Status: ${response.status}`
        );
      }

      const result = await response.json();
      return result.token;
    } catch (error) {
      console.error("[fetchSignalWireToken] Error:", error);
      throw error;
    }
  };

  const initializeSignalWireClient = async (
    token: string
  ): Promise<SignalWireContract> => {
    setLoading(true);
    try {
      console.log(
        "[initializeSignalWireClient] token fetched. Requesting permissions..."
      );
      await requestPermissions();
      const newClient = await SW({ token });

      newClient.online({
        incomingCallHandlers: {
          all: async (call) => {
            console.log(
              "[initializeSignalWireClient] incomingCallHandler =>",
              call
            );
          },
        },
      });

      console.log("[initializeSignalWireClient] Client connected!");
      const mics = await WebRTC.getMicrophoneDevices();
      mics?.forEach((mic) => {
        console.log(mic.label, mic.deviceId);
      });

      return newClient;
    } catch (error) {
      console.error("[initializeSignalWireClient] Error:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      if (isAuthenticated) {
        console.log("[useEffect] Auth is true. Checking user token...");
        const storedUser = sessionStorage.getItem("username");
        if (storedUser) {
          const signalWireToken = await fetchSignalWireToken(storedUser);
          setToken(signalWireToken);
          const initializedClient = await initializeSignalWireClient(
            signalWireToken
          );
          setClient(initializedClient);
          sessionStorage.setItem("signalWireToken", signalWireToken);
          connectToConferenceRoom(initializedClient);
        }
      }
    };
    initialize();
  }, [isAuthenticated]);

  // ------------------------------------------------------------------------------
  // DID & CONFERENCE
  // ------------------------------------------------------------------------------
  const fetchAssignedDIDNumber = async () => {
    try {
      console.log(
        "[fetchAssignedDIDNumber] Checking DID for username:",
        username
      );
      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/api/signalwire/dids?username=${username}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch assigned DID number");
      }

      const data = await response.json();
      if (data && data.length > 0) {
        const { phone_number } = data[0];
        console.log("[fetchAssignedDIDNumber] =>", phone_number);
        setAssignedDidNumber(phone_number);
      }
    } catch (error) {
      console.error("[fetchAssignedDIDNumber] Error:", error);
    }
  };

  const connectToConferenceRoom = async (
    initializedClient?: SignalWireContract
  ) => {
    try {
      // Set both loading state and conference session status
      setIsLoading(true);
      setCallState((prev) => ({
        ...prev,
        conferenceSession: prev.conferenceSession
          ? {
              ...prev.conferenceSession,
              status: "connecting" as const,
            }
          : null,
      }));

      console.log("[connectToConferenceRoom] => requesting permissions...");
      await requestPermissions();

      const confUser = username || sessionStorage.getItem("username");
      if (!confUser) {
        throw new Error("Username not available for conference connection");
      }

      // Use passed in client or fall back to stored client
      const activeClient = initializedClient || client;
      if (!activeClient) {
        throw new Error(
          "[connectToConferenceRoom] => No SignalWire client available"
        );
      }

      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/api/signalwire/conference/connect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conferenceName: confUser }),
        }
      );

      const data: ConnectToConferenceRoomResponse = await response.json();
      if (!data.conferenceName) {
        throw new Error("Conference name not received from server");
      }

      const binName = data.binName;
      const newConferenceName = data.conferenceName;
      const laMLBinUrl = data.laMLBinUrl;
      const newConferenceSid = data.conferenceSid;

      const conferenceSession = await activeClient.dial({
        to: `/public/${binName}`,
        audio: true,
        video: false,
      });

      conferenceSession?.on("active", handleConferenceInit);

      console.log(
        "[connectToConferenceRoom] => connected to:",
        newConferenceName
      );
      const conferenceState = {
        status: "connecting" as const,
        isActive: true,
        conferenceName: newConferenceName,
        participants: [],
        conferenceSid: newConferenceSid,
        laMLBinUrl: laMLBinUrl,
        callSession: conferenceSession,
      };

      setCallState((prev) => ({
        ...prev,
        conferenceSession: conferenceState,
      }));

      await conferenceSession.start();
    } catch (error: any) {
      console.error("[connectToConferenceRoom] Error:", error);
      setErrorMessage(error?.message || "Failed to connect to conference");

      // Reset conference session status on error
      setCallState((prev) => ({
        ...prev,
        conferenceSession: prev.conferenceSession
          ? {
              ...prev.conferenceSession,
              status: null,
            }
          : null,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleConferenceInit = async () => {
    try {
      console.log("[handleConferenceInit] => conference session active");
      setIsLoading(true);

      const participantsResponse = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/api/signalwire/conference/participant/getAll?conferenceName=${username}-conference`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }
      );

      let participantsData = await participantsResponse.json();
      if (!participantsData?.participants.length) {
        // Retry once if it comes back empty
        console.log("[handleConferenceInit] => no participants, retrying...");
        const resp2 = await fetch(
          `${
            import.meta.env.VITE_API_BASE_URL
          }/api/signalwire/conference/participant/getAll?conferenceName=${username}-conference`,
          {
            method: "GET",
            headers: { "Content-Type": "application/json" },
          }
        );
        participantsData = await resp2.json();
      }

      console.log("[handleConferenceInit] => participants:", participantsData);

      setCallState((prev) => ({
        ...prev,
        conferenceSession: {
          ...prev.conferenceSession!,
          status: "connected" as const,
          conferenceSid: participantsData?.participants[0]?.conference_sid,
          participants: participantsData,
          agentSid: participantsData.participants[0]?.call_sid,
        },
      }));
    } catch (error) {
      console.error("[handleConferenceInit] => Error:", error);
      setErrorMessage("Error initializing conference");
    } finally {
      setIsLoading(false);
    }
  };

  // ------------------------------------------------------------------------------
  // CALL ACTIONS
  // ------------------------------------------------------------------------------
  const dialNumber = async (phoneNumber: string) => {
    try {
      console.log("[dialNumber] =>", phoneNumber);

      if (!laMLBinUrlRef.current) {
        console.error(
          "[dialNumber] => No laMLBinUrlRef. Connect conference first."
        );
        return;
      }

      const formattedNumber = `+1${phoneNumber.replace(/\D/g, "")}`;
      if (formattedNumber.length <= 2) {
        console.error("[dialNumber] => invalid phone number.");
        if (ringBackAudioRef.current) {
          ringBackAudioRef.current.pause();
          ringBackAudioRef.current.currentTime = 0;
        }
        return;
      }

      const payload = {
        from: assignedDidNumber,
        to: formattedNumber,
        url: laMLBinUrlRef.current,
      };

      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/signalwire/call/dial`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const data: DialResponse = await response.json();
      if (!response.ok) {
        console.error("[dialNumber] => call error:", data.error);
        if (ringBackAudioRef.current) {
          ringBackAudioRef.current.pause();
          ringBackAudioRef.current.currentTime = 0;
        }
        return;
      }

      // Set ref immediately when we get callSid
      activeCallSidRef.current = data.callSid || "";

      // Start outbound ringback tone
      if (ringBackAudioRef.current) {
        console.log("[dialNumber] => playing ringBackAudioRef...");
        ringBackAudioRef.current.currentTime = 0;
        ringBackAudioRef.current
          .play()
          .catch((err) =>
            console.warn("[dialNumber] ringback play error:", err)
          );
      }

      console.log("[dialNumber] => call placed successfully!");
      setCallState((prev) => ({
        ...prev,
        activeCall: {
          status: "connected",
          callType: "outbound",
          connectedNumber: formattedNumber,
          callStartTime: Date.now(),
          callDuration: "00:00",
          isMuted: false,
          isOnHold: false,
          callSid: data.callSid,
          participantSid: data.participantSid,
        },
      }));
    } catch (error) {
      console.error("[dialNumber] => Error:", error);
      // Stop ringback if there's an uncaught error
      if (ringBackAudioRef.current) {
        ringBackAudioRef.current.pause();
        ringBackAudioRef.current.currentTime = 0;
      }
    }
  };

  const connectIncomingCall = async (
    callSid: string,
    lamlBinUrl: string,
    from: string
  ) => {
    try {
      setIsLoading(true);
      console.log(
        "[connectIncomingCall] => callSid:",
        callSid,
        "lamlBin:",
        lamlBinUrl
      );

      if (!callSid || !lamlBinUrl) {
        throw new Error(
          "[connectIncomingCall] => Missing callSid or laMLBinUrl"
        );
      }

      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/api/signalwire/conference/participant/add`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callSid, lamlBinUrl }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        console.error("[connectIncomingCall] => error:", data.error);
        return;
      }

      stopRingtone();

      setCallState((prev) => ({
        ...prev,
        activeCall: {
          status: "connected",
          callType: "inbound",
          connectedNumber: from,
          callStartTime: Date.now(),
          callDuration: "00:00",
          isMuted: false,
          isOnHold: false,
          callSid: data.callSid,
          participantSid: data.callSid,
        },
      }));

      console.log(
        "[connectIncomingCall] => call connected successfully:",
        data
      );
    } catch (error) {
      console.error("[connectIncomingCall] => error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const endCall = async () => {
    const active = callState.activeCall;
    const conf = callState.conferenceSession;

    if (!active?.callSid || !conf?.conferenceSid) {
      console.error("[endCall] => No active call to hang up.");
      clearActiveCallState();
      return;
    }

    try {
      console.log(
        "[endCall] => Attempting to remove participant. callSid:",
        active.callSid
      );
      const removeResponse = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/api/signalwire/conference/participant/delete`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callSid: active.callSid,
            conferenceSid: conf.conferenceSid,
          }),
        }
      );

      if (removeResponse.ok) {
        console.log("[endCall] => call ended via participant/delete");
        clearActiveCallState();
      } else {
        const data = await removeResponse.json();
        console.error("[endCall] => remove participant error:", data.error);

        // If the call never connected, set "canceled", otherwise "completed"
        let finalStatus: string;
        if (["queued", "ringing", "connecting"].includes(active.status || "")) {
          finalStatus = "canceled";
        } else {
          finalStatus = "completed";
        }

        // Attempt a fallback update
        console.log(`[endCall] => Fallback: updateCall(${finalStatus})`);
        const updateResponse = await fetch(
          `${import.meta.env.VITE_API_BASE_URL}/api/signalwire/call/update`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              callSid: active.callSid,
              status: finalStatus,
            }),
          }
        );

        if (!updateResponse.ok) {
          const updateErr = await updateResponse.json();
          console.error("[endCall fallback] => updateCall error:", updateErr);
        } else {
          console.log("[endCall fallback] => call status updated successfully");
        }

        clearActiveCallState();
      }
    } catch (error) {
      console.error("[endCall] => Exception:", error);
      clearActiveCallState();
    }
  };

  const mute = async () => {
    try {
      setIsLoading(true);
      console.log("[mute] => muting call");
      const confName = callState?.conferenceSession?.conferenceName;
      const agentSid = callState?.conferenceSession?.agentSid;
      if (!confName || !agentSid) {
        throw new Error("[mute] => Missing conferenceName or agentSid");
      }

      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/api/signalwire/conference/participant/mute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conferenceName: confName, callSid: agentSid }),
        }
      );

      const data = await response.json();
      if (!response.ok || !data.conferenceSid) {
        throw new Error(data.message || "[mute] => Error muting participant");
      }

      setCallState((prev) => ({
        ...prev,
        activeCall: {
          ...prev.activeCall!,
          isMuted: true,
        },
      }));
    } catch (error) {
      console.error("[mute] => error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const unmute = async () => {
    try {
      setIsLoading(true);
      console.log("[unmute] => unmuting call");
      const agentSid = callState?.conferenceSession?.agentSid;
      const confSid = callState?.conferenceSession?.conferenceSid;
      if (!agentSid || !confSid) {
        throw new Error("[unmute] => Missing agentSid or conferenceSid");
      }

      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/api/signalwire/conference/participant/unmute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conferenceSid: confSid,
            callSid: agentSid,
          }),
        }
      );

      const data = await response.json();
      if (!response.ok || !data.conferenceSid) {
        throw new Error(
          data.message || "[unmute] => Error unmuting participant"
        );
      }

      setCallState((prev) => ({
        ...prev,
        activeCall: {
          ...prev.activeCall!,
          isMuted: false,
        },
      }));
    } catch (error) {
      console.error("[unmute] => error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const holdCall = async () => {
    try {
      setIsLoading(true);
      console.log("[holdCall] => holding call");
      const confName = callState?.conferenceSession?.conferenceName;
      const cSid =
        callState.activeCall?.callSid || callState?.conferenceSession?.agentSid;

      if (!confName || !cSid) {
        throw new Error("[holdCall] => Missing confName or callSid");
      }

      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/api/signalwire/conference/participant/hold`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conferenceName: confName, callSid: cSid }),
        }
      );

      const data = await response.json();
      if (!response.ok || !data.conferenceSid) {
        throw new Error(
          data.message || "[holdCall] => Error holding participant"
        );
      }

      setCallState((prev) => ({
        ...prev,
        activeCall: {
          ...prev.activeCall!,
          isOnHold: true,
        },
      }));
    } catch (error) {
      console.error("[holdCall] => error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const resumeCall = async () => {
    try {
      console.log("[resumeCall] => resuming call");
      const confSid = callState?.conferenceSession?.conferenceSid;
      const cSid =
        callState.activeCall?.callSid || callState?.conferenceSession?.agentSid;

      if (!confSid || !cSid) {
        throw new Error("[resumeCall] => Missing confSid or callSid");
      }

      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/api/signalwire/conference/participant/resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conferenceSid: confSid, callSid: cSid }),
        }
      );

      const data = await response.json();
      if (!response.ok || !data.conferenceSid) {
        throw new Error(
          data.message || "[resumeCall] => Error resuming participant"
        );
      }

      setCallState((prev) => ({
        ...prev,
        activeCall: {
          ...prev.activeCall!,
          isOnHold: false,
        },
      }));
    } catch (error) {
      console.error("[resumeCall] => error:", error);
    }
  };

  const sendDTMF = async (digit: string) => {
    try {
      setIsLoading(true);
      console.log("[sendDTMF] => sending digit:", digit);
      const currentSid = callState?.activeCall?.callSid;
      if (!currentSid) {
        throw new Error("[sendDTMF] => No active call to send DTMF");
      }

      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/signalwire/conference/dtmf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callSid: currentSid,
            dtmfTones: digit,
            lamlBinUrl: callState?.conferenceSession?.laMLBinUrl,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("[sendDTMF] => Failed to send DTMF");
      }

      console.log("[sendDTMF] => success for digit:", digit);
    } catch (error) {
      console.error("[sendDTMF] => error:", error);
      setErrorMessage("Error sending DTMF");
    } finally {
      setIsLoading(false);
    }
  };

  // ------------------------------------------------------------------------------
  // CLEAN UP & DISCONNECT
  // ------------------------------------------------------------------------------
  useEffect(() => {
    if (!isAuthenticated) {
      console.log(
        "[useEffect] => not authenticated. Disconnecting conference..."
      );
      disconnectFromConference();
      setClient(null);
      setCallState({
        activeCall: null,
        conferenceSession: null,
      });
      stopRingtone();
    }
  }, [isAuthenticated]);

  const disconnectFromConference = async () => {
    try {
      console.log("[disconnectFromConference] => triggered");
      const confName = callState?.conferenceSession?.conferenceName;
      if (!confName) {
        if (isAuthenticated) {
          throw new Error("[disconnectFromConference] => No conference name");
        } else {
          return;
        }
      }

      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/api/signalwire/conference/disconnect`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conferenceName: confName }),
        }
      );

      const data = await response.json();
      if (!response.ok || !data.conferenceSid) {
        throw new Error(
          data.message || "[disconnectFromConference] => error disconnecting"
        );
      }

      console.log("[disconnectFromConference] => success");
      clearCallState();
    } catch (error: any) {
      console.error("[disconnectFromConference] => error:", error.message);
    }
  };

  const clearCallState = () => {
    console.log("[clearCallState] => clearing entire call state");
    setCallState({
      activeCall: null,
      conferenceSession: null,
    });
  };

  const clearActiveCallState = () => {
    console.log("[clearActiveCallState] => clearing active call only");
    setCallState((prev) => ({
      ...prev,
      activeCall: null,
    }));
  };

  // ------------------------------------------------------------------------------
  // CALL DURATION TIMER
  // ------------------------------------------------------------------------------
  useEffect(() => {
    if (callState?.activeCall?.callStartTime) {
      console.log("[useEffect] => Starting call duration interval...");
      const intervalId = setInterval(() => {
        const elapsed = Date.now() - callState.activeCall!.callStartTime!;
        const minutes = Math.floor(elapsed / 60000)
          .toString()
          .padStart(2, "0");
        const seconds = Math.floor((elapsed % 60000) / 1000)
          .toString()
          .padStart(2, "0");

        setCallState((prev) => ({
          ...prev,
          activeCall: {
            ...prev.activeCall!,
            callDuration: `${minutes}:${seconds}`,
          },
        }));
      }, 1000);

      return () => {
        console.log("[useEffect cleanup] => stopping call duration interval");
        clearInterval(intervalId);
      };
    }
  }, [callState?.activeCall?.callStartTime]);

  // ------------------------------------------------------------------------------
  // LIST CALLS / CONFERENCES
  // ------------------------------------------------------------------------------
  const listCalls = async () => {
    try {
      console.log("[listCalls] => listing calls...");
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/signalwire/call/list`
      );
      const data = await response.json();

      if (!response.ok) {
        console.error("[listCalls] => error:", data.error);
        return;
      }
      console.log("[listCalls] => success:", data);
    } catch (error) {
      console.error("[listCalls] => error:", error);
    }
  };

  const listConferences = async () => {
    try {
      console.log("[listConferences] => listing conferences...");
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/signalwire/conference/list`
      );
      const data = await response.json();

      if (!response.ok) {
        console.error("[listConferences] => error:", data.error);
        return;
      }
      console.log("[listConferences] => success:", data);
    } catch (error) {
      console.error("[listConferences] => error:", error);
    }
  };

  // ------------------------------------------------------------------------------
  // UPDATE / DELETE PARTICIPANT
  // ------------------------------------------------------------------------------
  const updateCall = async (callSid: string, status: string, url?: string) => {
    try {
      console.log("[updateCall] => callSid:", callSid, "status:", status);
      const payload = { callSid, status, url };
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/signalwire/call/update`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        console.error("[updateCall] => error:", data.error);
        return;
      }
      console.log("[updateCall] => success:", data);
    } catch (error) {
      console.error("[updateCall] => error:", error);
    }
  };

  const deleteParticipant = async (conferenceSid: string, callSid: string) => {
    try {
      console.log(
        "[deleteParticipant] => cSid:",
        conferenceSid,
        "callSid:",
        callSid
      );
      const payload = { conferenceSid, callSid };
      const response = await fetch(
        `${
          import.meta.env.VITE_API_BASE_URL
        }/api/signalwire/conference/participant/delete`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        console.error("[deleteParticipant] => error:", data.error);
        return;
      }
      console.log("[deleteParticipant] => success:", data);
    } catch (error) {
      console.error("[deleteParticipant] => error:", error);
    }
  };

  // ------------------------------------------------------------------------------
  // Electron IPC listeners
  // ------------------------------------------------------------------------------
  useEffect(() => {
    if (window.electron) {
      console.log("[useEffect] => setting up electron IPC listeners");

      window.electron.ipcRenderer.on("stop-ringtone", async () => {
        stopRingtone();
      });

      window.electron.ipcRenderer.on("show-toast", async (message) => {
        console.log("[ipcRenderer] => show-toast:", message);
        if (message.toastType === "call") {
          console.log("[ipcRenderer] => Playing ringtone for incoming call");
          playRingtone();
          // Also show toast in main window if not using electron
          if (!window.electron) {
            showToast(message.title, message.description, {
              primaryActionLabel: message.primaryActionLabel,
              primaryAction: async () => {
                console.log("[show-toast] => user clicked Accept");
                stopRingtone();
                await connectIncomingCall(
                  message.callSid,
                  laMLBinUrlRef.current,
                  message.fromNumber
                );
              },
              secondaryActionLabel: message.secondaryActionLabel,
              secondaryAction: () => {
                console.log("[show-toast] => user clicked Decline");
                stopRingtone();
              },
            });
          }
        }
      });

      window.electron.ipcRenderer.on(
        "accept-incoming-call",
        async ({ callSid, fromNumber }) => {
          console.log("[ipcRenderer] => accept-incoming-call:", callSid);
          stopRingtone();
          await connectIncomingCall(callSid, laMLBinUrlRef.current, fromNumber);
          window.electron?.ipcRenderer.send("call-accepted", {
            callSid,
            fromNumber,
          });
        }
      );

      window.electron.ipcRenderer.on(
        "decline-incoming-call",
        async ({ callSid, fromNumber }) => {
          console.log("[ipcRenderer] => decline-incoming-call:", callSid);
          stopRingtone();
          window.electron?.ipcRenderer.send("call-declined", {
            callSid,
            fromNumber,
          });
        }
      );
    }

    return () => {
      console.log("[useEffect cleanup] => removing electron IPC listeners");
      window.electron?.ipcRenderer.removeAllListeners("show-toast");
      window.electron?.ipcRenderer.removeAllListeners("accept-incoming-call");
      window.electron?.ipcRenderer.removeAllListeners("decline-incoming-call");
    };
  }, []);

  // ------------------------------------------------------------------------------
  // RETURN PROVIDER
  // ------------------------------------------------------------------------------
  return (
    <SignalWireContext.Provider
      value={{
        client,
        dialNumber,
        endCall,
        callState,
        token,
        connectToConferenceRoom,
        requestPermissions,
        mute,
        unmute,
        currentMicrophone,
        currentOutputDevice,
        currentRingDevice,
        availableMicrophones,
        availableSpeakers,
        applyMicrophone,
        applySpeaker,
        applyRingDevice,
        holdCall,
        resumeCall,
        disconnectFromConference,
        listCalls,
        listConferences,
        updateCall,
        deleteParticipant,
        isLoading,
        errorMessage,
        sendDTMF,
        playRingtone,
        stopRingtone,
      }}
    >
      {children}
    </SignalWireContext.Provider>
  );
};

export const useSignalWire = (): SignalWireContextProps => {
  const context = useContext(SignalWireContext);
  if (context === undefined) {
    throw new Error("useSignalWire must be used within a SignalWireProvider");
  }
  return context;
};
