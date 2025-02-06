import { Request, Response } from "express";
import axios from "axios";
import { RestClient } from "@signalwire/compatibility-api";
import qs from "qs";
import {
  CombinedLeadData,
  didNumbersResponse,
  incomingCallNotificationRequest,
  RingGroup,
  VoiceStatusCallback,
} from "./signalwire.model";
import { query } from "./signalwire.database";
import { Pool } from "pg";
import { Logger } from "../shared/logger";
import { CallInstance } from "@signalwire/compatibility-api/lib/rest/api/v2010/account/call";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export class SignalWireService {
  private SIGNALWIRE_PROJECT_ID = process.env.SIGNALWIRE_PROJECT_ID || "";
  private SIGNALWIRE_AUTH_TOKEN = process.env.SIGNALWIRE_AUTH_TOKEN || "";
  private SIGNALWIRE_API_URL = process.env.SIGNALWIRE_API_URL || "";
  private authString = Buffer.from(
    `${this.SIGNALWIRE_PROJECT_ID}:${this.SIGNALWIRE_AUTH_TOKEN}`
  ).toString("base64");
  private SIGNALWIRE_API_FULL_URL = `https://${this.SIGNALWIRE_API_URL}/api/laml/2010-04-01/Accounts/${this.SIGNALWIRE_PROJECT_ID}`;
  private signalWireClient: any;
  private ioServer: any;
  private signalWireDBClient: Pool;
  private appDBClient: Pool;

  // ---- ADD THESE FOR DIGITALOCEAN SPACES ----
  private s3Client: S3Client; // <-- Added for DO Spaces
  private s3Bucket: string; // <-- Added for DO Spaces
  // ------------------------------------------

  constructor(ioServer: any) {
    // Validate SignalWire configuration
    if (
      !this.SIGNALWIRE_PROJECT_ID ||
      !this.SIGNALWIRE_AUTH_TOKEN ||
      !this.SIGNALWIRE_API_URL
    ) {
      Logger.error(
        "SignalWire configuration is incomplete. Please check the environment variables."
      );
      throw new Error("SignalWire configuration is incomplete.");
    }

    // Initialize the SignalWire compatibility client
    this.signalWireClient = RestClient(
      this.SIGNALWIRE_PROJECT_ID,
      this.SIGNALWIRE_AUTH_TOKEN,
      {
        signalwireSpaceUrl: process.env.SIGNALWIRE_API_URL,
      }
    );

    // Store Socket.IO server reference
    this.ioServer = ioServer;

    // Obtain DB pools (for DID, calls, etc.)
    this.signalWireDBClient = global.signalWirePool as any;
    if (!global.pool) {
      throw new Error("Main App Database pool is not initialized.");
    }
    this.appDBClient = global.pool as Pool;

    // ---- INITIALIZE S3 CLIENT FOR DO SPACES ----
    this.s3Client = new S3Client({
      region: "us-east-1", // DigitalOcean Spaces region
      endpoint: process.env.DO_SPACES_ENDPOINT, // 
      credentials: {
        accessKeyId: process.env.DO_SPACES_KEY || "",
        secretAccessKey: process.env.DO_SPACES_SECRET || "",
      },
      forcePathStyle: true, // ✅ MUST BE TRUE for DigitalOcean Spaces
    });

    // e.g. "elecrm" or whatever your bucket name is
    this.s3Bucket = process.env.DO_SPACES_BUCKET || "elecrm";
    // ------------------------------------------------
  }

  // ============================================
  // NEW: team status update
  // ============================================
  /**
   * Retrieves all users with their status for the Team Status panel.
   * Returns an array of objects:
   *   { first_name, last_name, sw_phone_number, master_status }
   */
  public async getTeamStatus() {
    // Ensure the correct database pool is used
    if (!global.userManagementPool) {
      Logger.error(
        "Database connection to user_management is not initialized."
      );
      throw new Error("Database connection to user_management is missing.");
    }

    const sqlQuery = `
  SELECT
    u.first_name,
    u.last_name,
    u.sw_phone_number,
    s.master_status
  FROM public.users AS u
  LEFT JOIN public.user_status AS s
    ON u.username = s.user_id  -- Ensure correct JOIN condition
  ORDER BY u.first_name, u.last_name;
`;

    try {
      const result = await global.userManagementPool.query(sqlQuery);
      return result.rows; // array of { first_name, last_name, sw_phone_number, master_status }
    } catch (error: any) {
      Logger.error("Error fetching team status from user_management", {
        error: error.message,
      });
      throw new Error("Failed to fetch team status from user_management");
    }
  }

  // ============================================
  // NEW: saveVoicemail
  // ============================================
  public async saveVoicemail(body: any): Promise<string> {
    console.log("🔥 [DEBUG] Incoming request body:", body);

    // 1️⃣ Validate Inputs
    const { RecordingUrl, CallSid, username } = body;
    if (!RecordingUrl || !CallSid || !username) {
      console.error("❌ [ERROR] Missing parameters in request:", {
        RecordingUrl,
        CallSid,
        username,
      });
      throw new Error(
        "Missing required parameters: 'RecordingUrl', 'CallSid', or 'username'"
      );
    }

    console.log("✅ [INFO] Processing voicemail for user:", username);

    // 2️⃣ Generate Timestamp
    const nowUtc = new Date();
    const offsetMs = 7 * 60 * 60 * 1000; // Phoenix is UTC-7
    const phoenixTime = new Date(nowUtc.getTime() - offsetMs);
    const timestamp = phoenixTime
      .toISOString()
      .replace(/:/g, "-")
      .split(".")[0]; // Safe filename format

    // 3️⃣ Construct File Path
    const folderPath = `User_Assets/User_Voicemails/${username}`;
    const fileKey = `${folderPath}/${CallSid}_${timestamp}.mp3`;
    console.log("📂 [INFO] File will be stored at:", fileKey);

    // 4️⃣ Verify S3 Client Configuration
    console.log("🛠️ [DEBUG] S3 Config Check:");
    console.log("  - DO_SPACES_ENDPOINT:", process.env.DO_SPACES_ENDPOINT);
    console.log(
      "  - DO_SPACES_KEY:",
      process.env.DO_SPACES_KEY ? "Loaded" : "MISSING"
    );
    console.log(
      "  - DO_SPACES_SECRET:",
      process.env.DO_SPACES_SECRET ? "Loaded" : "MISSING"
    );
    console.log("  - DO_SPACES_BUCKET:", this.s3Bucket);

    // 5️⃣ Download Voicemail File
    console.log("⏳ [INFO] Downloading voicemail from:", RecordingUrl);
    let fileBuffer: Buffer;
    try {
      const response = await axios.get(RecordingUrl, {
        responseType: "arraybuffer",
      });
      fileBuffer = Buffer.from(response.data);
      console.log(
        "✅ [INFO] Download complete. File size:",
        fileBuffer.length,
        "bytes"
      );
    } catch (downloadErr) {
      console.error("❌ [ERROR] Failed to download RecordingUrl:", downloadErr);
      throw new Error("Could not download the voicemail from RecordingUrl");
    }

    // 6️⃣ (OPTIONAL) Skip Folder Check - DigitalOcean will create "folders" automatically
    console.log("🚀 [INFO] Uploading voicemail to DigitalOcean Spaces...");
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: fileKey,
          Body: fileBuffer,
          ACL: "public-read",
          ContentType: "audio/mpeg",
        })
      );
      console.log("✅ [SUCCESS] Voicemail uploaded to Spaces:", fileKey);
    } catch (uploadError) {
      console.error(
        "❌ [ERROR] Failed to upload voicemail to Spaces:",
        uploadError
      );
      throw new Error("Failed to upload voicemail to DigitalOcean Spaces");
    }

    // 7️⃣ Return the Public File URL
    const fileUrl = `https://${this.s3Bucket}.sfo3.cdn.digitaloceanspaces.com/${fileKey}`;
    console.log("🔗 [INFO] Voicemail CDN URL:", fileUrl);

    return fileUrl;
  }

  // ----------------------------------------------------------------------------
  // DIAL A CALL
  // ----------------------------------------------------------------------------
  public async dial(from: string, to: string, url: string) {
    try {
      Logger.info("Initiating call with SignalWire", { from, to, url });

      const response = await this.signalWireClient.calls.create({
        url,
        from,
        to,
        statusCallback: `${process.env.BASE_URL}/api/signalwire/webhook/voice-status-callback`,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        record: "record-from-ringing", // <-- Tells SignalWire to record from ring
        recordingStatusCallback: `${process.env.BASE_URL}/api/signalwire/webhook/recording-status-callback`,
        recordingStatusCallbackMethod: "POST",
      });

      // Log the initial call status
      await this.logCallStatus(
        response.sid,
        response.status,
        "outbound",
        from,
        to
      );

      return {
        message: "Call initiated successfully",
        callSid: response.sid,
        participantSid: response.phoneNumberSid,
        status: response.status,
        url: response.events,
      };
    } catch (error: any) {
      Logger.error("Error initiating call:", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error("Failed to initiate call");
    }
  }

  // ----------------------------------------------------------------------------
  // HOLD A CALL
  // ----------------------------------------------------------------------------
  public async hold(callId: string) {
    try {
      Logger.info("Holding call with SignalWire", { callId });

      const payload = qs.stringify({ Status: "paused" });

      const response = await axios.post(
        `${this.SIGNALWIRE_API_FULL_URL}/Calls/${callId}`,
        payload,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            Authorization: `Basic ${this.authString}`,
          },
        }
      );

      // Log the call hold status
      await this.logCallStatus(callId, "paused", "outbound", "", "");

      Logger.info("Call held successfully", { callSid: callId });

      return {
        message: "Call held successfully",
        callSid: callId,
        status: response.data.status,
      };
    } catch (error: any) {
      Logger.error("Error holding call:", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error("Failed to hold call");
    }
  }

  // ----------------------------------------------------------------------------
  // RESUME A CALL
  // ----------------------------------------------------------------------------
  public async resume(callId: string) {
    try {
      Logger.info("Resuming call with SignalWire", { callId });

      const payload = qs.stringify({ Status: "in-progress" });

      const response = await axios.post(
        `${this.SIGNALWIRE_API_FULL_URL}/Calls/${callId}`,
        payload,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            Authorization: `Basic ${this.authString}`,
          },
        }
      );

      // Log the resumed call status
      await this.logCallStatus(callId, "in-progress", "outbound", "", "");

      Logger.info("Call resumed successfully", { callSid: callId });

      return {
        message: "Call resumed successfully",
        callSid: callId,
        status: response.data.status,
      };
    } catch (error: any) {
      Logger.error("Error resuming call:", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error("Failed to resume call");
    }
  }

  // ----------------------------------------------------------------------------
  // HANGUP A CALL
  // ----------------------------------------------------------------------------
  public async hangup(conferenceSid: string) {
    try {
      Logger.info("Hanging up call with SignalWire", { conferenceSid });

      const response = await this.signalWireClient
        .calls(conferenceSid)
        .update({ status: "completed" });

      // Log the hangup status
      await this.logCallStatus(conferenceSid, "completed", "outbound", "", "");

      Logger.info("Call hung up successfully", { conferenceSid });

      return {
        message: "Call hung up successfully",
        conferenceSid,
        status: response.status,
      };
    } catch (error: any) {
      Logger.error("Error hanging up call:", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error("Failed to hang up call");
    }
  }

  // ----------------------------------------------------------------------------
  // CREATE OR FETCH CONFERENCE ROOM (WITH RECORDING)
  // ----------------------------------------------------------------------------
  public async createOrFetchConferenceRoom(conferenceName: string) {
    try {
      const formattedConferenceName = `${conferenceName}-conference`;
      const formattedBinName = `${conferenceName}-bin`;

      Logger.info("Checking if conference exists", { formattedConferenceName });

      // Fetch the list of LamlBins to check if the conference already exists
      const existingBinsResponse = await axios.get(
        `${this.SIGNALWIRE_API_FULL_URL}/LamlBins`,
        {
          headers: {
            Authorization: `Basic ${this.authString}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      // Search for the conferenceName in the existing LamlBins
      const existingBin = existingBinsResponse.data.laml_bins.find(
        (bin: any) => bin.name === formattedBinName
      );

      if (existingBin) {
        Logger.info("Conference room already exists", {
          formattedConferenceName,
          laMLBinUrl: existingBin.request_url,
          conferenceSid: existingBin.conference_sid,
        });

        const conference = await this.getActiveConference(
          formattedConferenceName
        );

        return {
          message: "Conference room already exists",
          conferenceName: formattedConferenceName,
          conferenceSid: conference?.conferenceSid || "",
          laMLBinUrl: existingBin.request_url,
          binName: formattedBinName,
        };
      }

      // If the room does not exist, create it
      Logger.info("Creating a new conference room", {
        formattedConferenceName,
      });

      // LAML content enabling per-leg recording
      const laMLContent = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Dial>
          <Conference 
            record="record-from-start"
            recordingStatusCallback="https://elecrm-serverside-kvg9r.ondigitalocean.app/api/signalwire/webhook/recording-status-callback"
            recordingStatusCallbackMethod="POST"
            startConferenceOnEnter="true" 
            endConferenceOnExit="false" 
            waitUrl="" 
            beep="false"
            statusCallback="https://elecrm-serverside-kvg9r.ondigitalocean.app/api/signalwire/webhook/voice-status-callback"
            statusCallbackMethod="POST"
            statusCallbackEvents="start end join leave mute hold speaker"
          >
            ${formattedConferenceName}
          </Conference>
        </Dial>
      </Response>`;


      // Create new LamlBin
      const createResponse = await axios.post(
        `${this.SIGNALWIRE_API_FULL_URL}/LamlBins`,
        new URLSearchParams({
          Name: formattedBinName,
          Contents: laMLContent,
        }),
        {
          headers: {
            Authorization: `Basic ${this.authString}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      const laMLBinUrl = createResponse.data.request_url;

      Logger.info("Created conference successfully", {
        conferenceName: formattedConferenceName,
        laMLBinUrl,
      });

      // Optionally retrieve the new conference
      const conference = await this.getActiveConference(
        formattedConferenceName
      );

      return {
        message: "Conference created successfully",
        conferenceName: formattedConferenceName,
        conferenceSid: conference?.conferenceSid || "",
        binName: formattedBinName,
        laMLBinUrl,
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        Logger.error("Error fetching/creating conference:", {
          message: error.message,
          stack: error.stack,
        });
        throw new Error(`Failed to fetch/create conference: ${error.message}`);
      } else {
        Logger.error("Unknown error occurred while creating conference", {
          error,
        });
        throw new Error(
          "Failed to fetch/create conference due to an unknown error"
        );
      }
    }
  }

  // ----------------------------------------------------------------------------
  // GET ACTIVE CONFERENCE
  // ----------------------------------------------------------------------------
  public async getActiveConference(conferenceName: string) {
    try {
      // Fetch the list of active conferences
      const activeConferences = await this.signalWireClient.conferences.list();

      // Search for the matching name
      const matchingConference = activeConferences.find(
        (conf: any) => conf.friendlyName === conferenceName
      );

      if (matchingConference) {
        Logger.info("Found active conference", { sid: matchingConference.sid });
        return {
          message: "Conference created and found successfully",
          conferenceSid: matchingConference.sid,
          friendlyName: matchingConference.friendlyName,
          matchingConference,
        };
      } else {
        return null;
      }
    } catch (error: any) {
      Logger.error("Error fetching active conference:", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Failed to fetch active conference: ${error.message}`);
    }
  }

  // ----------------------------------------------------------------------------
  // DISCONNECT CONFERENCE
  // ----------------------------------------------------------------------------
  public async disconnectConference(conferenceName: string) {
    try {
      Logger.info("Disconnecting conference", { conferenceName });

      const conference = await this.getActiveConference(conferenceName);
      if (!conference) {
        throw new Error(`Conference ${conferenceName} not found`);
      }

      const response = await this.signalWireClient
        .conferences(conference.conferenceSid)
        .update({
          status: "completed",
        });

      if (response?.status !== "completed") {
        throw new Error("Failed to disconnect conference");
      }

      Logger.info("Conference disconnected successfully", { conference });
      return {
        message: "Conference disconnected successfully",
        conferenceSid: conference.conferenceSid,
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message;
      Logger.error("Error disconnecting conference:", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Failed to disconnect conference: ${errorMessage}`);
    }
  }

  // ----------------------------------------------------------------------------
  // MUTE PARTICIPANT
  // ----------------------------------------------------------------------------
  public async muteParticipant(conferenceName: string, callSid: string) {
    try {
      Logger.info("Muting participant", { conferenceName, callSid });

      const conference = await this.getActiveConference(conferenceName);
      if (!conference) {
        throw new Error(`Conference ${conferenceName} not found`);
      }

      const response = await this.signalWireClient
        .conferences(conference.conferenceSid)
        .participants(callSid)
        .update({ muted: true });

      if (response?.muted !== true) {
        throw new Error("Failed to mute participant");
      }

      Logger.info("Participant muted successfully", {
        conferenceName,
        callSid,
      });
      return {
        message: "Participant muted successfully",
        conferenceSid: conference.conferenceSid,
        callSid,
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message;
      Logger.error("Error muting participant:", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Failed to mute participant: ${errorMessage}`);
    }
  }

  // ----------------------------------------------------------------------------
  // UNMUTE PARTICIPANT
  // ----------------------------------------------------------------------------
  public async unmuteParticipant(conferenceSid: string, callSid: string) {
    try {
      Logger.info("Unmuting participant", { conferenceSid, callSid });

      const response = await this.signalWireClient
        .conferences(conferenceSid)
        .participants(callSid)
        .update({ muted: false });

      if (response?.muted !== false) {
        throw new Error("Failed to unmute participant");
      }

      Logger.info("Participant unmuted successfully", {
        conferenceSid,
        callSid,
      });
      return {
        message: "Participant unmuted successfully",
        conferenceSid,
        callSid,
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message;
      Logger.error("Error unmuting participant:", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Failed to unmute participant: ${errorMessage}`);
    }
  }

  // ----------------------------------------------------------------------------
  // HOLD PARTICIPANT
  // ----------------------------------------------------------------------------
  public async holdParticipant(conferenceName: string, callSid: string) {
    try {
      Logger.info("Holding participant", { conferenceName, callSid });

      const conference = await this.getActiveConference(conferenceName);
      if (!conference) {
        throw new Error(`Conference ${conferenceName} not found`);
      }

      const response = await this.signalWireClient
        .conferences(conference.conferenceSid)
        .participants(callSid)
        .update({ hold: true });

      if (response?.hold !== true) {
        throw new Error("Failed to hold participant");
      }

      Logger.info("Participant held successfully", { conferenceName, callSid });
      return {
        message: "Participant held successfully",
        conferenceSid: conference.conferenceSid,
        callSid,
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message;
      Logger.error("Error holding participant:", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Failed to hold participant: ${errorMessage}`);
    }
  }

  // ----------------------------------------------------------------------------
  // RESUME PARTICIPANT
  // ----------------------------------------------------------------------------
  public async resumeParticipant(conferenceSid: string, callSid: string) {
    try {
      Logger.info("Resuming participant", { conferenceSid, callSid });

      if (!conferenceSid) {
        throw new Error(`Conference ${conferenceSid} not found`);
      }

      const response = await this.signalWireClient
        .conferences(conferenceSid)
        .participants(callSid)
        .update({ hold: false });

      if (response?.hold !== false) {
        throw new Error("Failed to resume participant");
      }

      Logger.info("Participant resumed successfully", {
        conferenceSid,
        callSid,
      });
      return {
        message: "Participant resumed successfully",
        conferenceSid,
        callSid,
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message;
      Logger.error("Error resuming participant:", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Failed to resume participant: ${errorMessage}`);
    }
  }

  // ----------------------------------------------------------------------------
  // LIST ALL PARTICIPANTS
  // ----------------------------------------------------------------------------
  public async getAllParticipants(conferenceName: string) {
    try {
      Logger.info("Fetching all participants for conference", {
        conferenceName,
      });

      const conference = await this.getActiveConference(conferenceName);
      if (!conference || !conference.conferenceSid) {
        throw new Error(`Conference ${conferenceName} not found`);
      }

      const response = await axios.get(
        `${this.SIGNALWIRE_API_FULL_URL}/Conferences/${conference.conferenceSid}/Participants`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${this.authString}`,
          },
        }
      );

      if (!response.data || !response.data.participants) {
        throw new Error(
          `No participants found for conference ${conferenceName}`
        );
      }

      Logger.info("Fetched participants successfully", {
        conferenceSid: conference.conferenceSid,
      });
      return {
        message: "Participants fetched successfully",
        participants: response.data.participants,
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message;
      Logger.error("Error fetching participants:", {
        error: errorMessage,
        stack: error.stack,
      });
      throw new Error(`Failed to fetch participants: ${errorMessage}`);
    }
  }

  // ----------------------------------------------------------------------------
  // LIST ALL CALLS
  // ----------------------------------------------------------------------------
  public async listAllCalls() {
    try {
      const response = await axios.get(
        `${this.SIGNALWIRE_API_FULL_URL}/Calls`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${this.authString}`,
          },
        }
      );
      Logger.info("Fetched all calls successfully");
      return response.data.calls;
    } catch (error: any) {
      Logger.error("Error listing all calls:", { error: error.message });
      throw new Error("Failed to list all calls");
    }
  }

  // ----------------------------------------------------------------------------
  // LIST ALL CONFERENCES
  // ----------------------------------------------------------------------------
  public async listAllConferences() {
    try {
      const response = await axios.get(
        `${this.SIGNALWIRE_API_FULL_URL}/Conferences`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${this.authString}`,
          },
        }
      );
      Logger.info("Fetched all conferences successfully");
      return response.data.conferences;
    } catch (error: any) {
      Logger.error("Error listing all conferences:", { error: error.message });
      throw new Error("Failed to list all conferences");
    }
  }

  // ----------------------------------------------------------------------------
  // RETRIEVE A SPECIFIC CONFERENCE
  // ----------------------------------------------------------------------------
  public async retrieveConference(conferenceSid: string) {
    try {
      const response = await axios.get(
        `${this.SIGNALWIRE_API_FULL_URL}/Conferences/${conferenceSid}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Basic ${this.authString}`,
          },
        }
      );
      Logger.info("Fetched conference details successfully", { conferenceSid });
      return response.data;
    } catch (error: any) {
      Logger.error("Error retrieving conference:", { error: error.message });
      throw new Error("Failed to retrieve conference");
    }
  }

  // ----------------------------------------------------------------------------
  // DELETE A PARTICIPANT (KICK THEM OUT)
  // ----------------------------------------------------------------------------
  public async deleteParticipant(conferenceSid: string, callSid: string) {
    try {
      const response = await axios.delete(
        `${this.SIGNALWIRE_API_FULL_URL}/Conferences/${conferenceSid}/Participants/${callSid}`,
        {
          headers: {
            Authorization: `Basic ${this.authString}`,
          },
        }
      );

      if (response.status !== 204) {
        throw new Error("Failed to delete participant");
      }

      Logger.info("Deleted participant successfully", {
        conferenceSid,
        callSid,
      });
      return { message: "Participant deleted successfully" };
    } catch (error: any) {
      Logger.error("Error deleting participant:", { error: error.message });
      throw new Error("Failed to delete participant");
    }
  }

  // ----------------------------------------------------------------------------
  // UPDATE A CALL (CANCEL, COMPLETE, ETC.)
  // ----------------------------------------------------------------------------
  public async updateCall(callSid: string, status: string, url?: string) {
    try {
      const payload: any = { Status: status };
      if (url) payload.Url = url;

      const response = await axios.post(
        `${this.SIGNALWIRE_API_FULL_URL}/Calls/${callSid}`,
        qs.stringify(payload),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            Authorization: `Basic ${this.authString}`,
          },
        }
      );
      Logger.info("Updated call status successfully", { callSid, status });
      return response.data;
    } catch (error: any) {
      Logger.error("Error updating call:", { error: error.message });
      throw new Error("Failed to update call");
    }
  }

  // ----------------------------------------------------------------------------
  // UPDATE A PARTICIPANT (MUTE/HOLD VIA POST)
  // ----------------------------------------------------------------------------
  public async updateParticipant(
    conferenceSid: string,
    callSid: string,
    data: any
  ) {
    try {
      const response = await axios.post(
        `${this.SIGNALWIRE_API_FULL_URL}/Conferences/${conferenceSid}/Participants/${callSid}`,
        qs.stringify(data),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            Authorization: `Basic ${this.authString}`,
          },
        }
      );
      Logger.info("Updated participant status successfully", {
        conferenceSid,
        callSid,
      });
      return response.data;
    } catch (error: any) {
      Logger.error("Error updating participant:", { error: error.message });
      throw new Error("Failed to update participant");
    }
  }

  // ----------------------------------------------------------------------------
  // ADD PARTICIPANT TO CONFERENCE
  // ----------------------------------------------------------------------------
  public async addParticipantToConference(callSid: string, lamlBinUrl: string) {
    try {
      Logger.info("Adding participant with SignalWire", {
        callSid,
        lamlBinUrl,
      });

      // Update the call with the new URL and include recording instructions.
      const response = await this.signalWireClient.calls(callSid).update({
        method: "POST",
        url: lamlBinUrl,
        // These recording parameters mirror what you do in the dial function.
        record: "record-from-ringing", // Instructs SignalWire to start recording.
        recordingStatusCallback: `${process.env.BASE_URL}/api/signalwire/webhook/recording-status-callback`,
        recordingStatusCallbackMethod: "POST",
      });

      Logger.info("Participant added successfully", { callSid, lamlBinUrl });
      return {
        message: "Participant added successfully",
        callSid: response.sid,
        status: response.status,
      };
    } catch (error: any) {
      Logger.error("Error adding participant:", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error("Failed to add participant");
    }
  }

  // ----------------------------------------------------------------------------
  // CALL STATUS UPDATE (LAML BIN WEBHOOK)
  // ----------------------------------------------------------------------------
  public async callStatusUpdate(data: any) {
    try {
        const {
            CallSid,
            CallStatus,
            Timestamp,
            Direction,
            From,
            To,
            CallDuration,
            RecordingUrl,
        } = data;

        Logger.info("Logging the lamlbin info...", { From, To, CallSid });

        const sqlQuery = `
            INSERT INTO public.call_logs (
                call_sid,
                call_status,
                timestamp,
                direction,
                from_number,
                to_number,
                call_duration,
                recording_url
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (call_sid) DO UPDATE SET
                call_status = EXCLUDED.call_status,
                timestamp = EXCLUDED.timestamp,
                call_duration = EXCLUDED.call_duration,
                recording_url = EXCLUDED.recording_url
            RETURNING *;
        `;

        const values = [
            CallSid,
            CallStatus,
            Timestamp || new Date().toISOString(),
            Direction,
            From,
            To,
            CallDuration ? parseInt(CallDuration, 10) : null,
            RecordingUrl
        ];

        const result = await query(sqlQuery, values);

        Logger.info("Inserted/Updated call log in database", {
            result: result.rows[0],
        });

        return result.rows[0];
    } catch (error: any) {
        Logger.error("Error inserting call log into database:", {
            error: error.message,
            stack: error.stack,
        });
        throw new Error("Failed to insert call log into database");
    }
}


  // ----------------------------------------------------------------------------
  // SEND CONFERENCE DTMF TONE
  // ----------------------------------------------------------------------------
  public async sendConferenceDtmfTone(
    callSid: string,
    dtmfTones: string,
    lamlBinUrl: string
  ): Promise<CallInstance> {
    try {
      Logger.info("Starting to send DTMF tones", {
        callSid,
        dtmfTones,
        lamlBinUrl,
      });

      // Build instructions to play tones
      const response = new RestClient.LaML.VoiceResponse();
      response.play({ digits: `w${dtmfTones}` });
      response.redirect(lamlBinUrl);

      Logger.info("Generated LaML Response", {
        callSid,
        laMlResponse: response.toString(),
      });

      // Send instructions over to SignalWire
      const updateResponse = await this.signalWireClient.calls(callSid).update({
        twiml: response.toString(),
      });

      Logger.info("Update response received from SignalWire", {
        callSid,
        updateResponse,
      });

      Logger.info("Finished sending DTMF tones", { callSid, updateResponse });
      return updateResponse;
    } catch (error) {
      Logger.error("Error occurred while sending DTMF tones", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      if (error instanceof Error) {
        throw new Error(`Failed to send DTMF tone: ${error.message}`);
      }
      throw new Error("An unknown error occurred");
    }
  }

  // ----------------------------------------------------------------------------
  // HANDLE VOICE STATUS CALLBACK
  // ----------------------------------------------------------------------------
  public async handleVoiceStatusCallback(
    payload: VoiceStatusCallback
  ): Promise<void> {
    const {
      CallSid,
      CallStatus,
      From,
      To,
      CallDuration,
      RecordingUrl,
      participantSid,
    } = payload;

    console.log("Received Status Callback:", payload);

    try {
      // Check if the call log already exists
      const existingCallLog = await query(
        "SELECT * FROM call_logs WHERE call_sid = $1",
        [CallSid]
      );

      if (existingCallLog.rowCount > 0) {
        console.log("Updating existing call log for CallSid:", CallSid);
        await query(
          `UPDATE call_logs
           SET call_status = $1,
               call_duration = $2,
               recording_url = $3,
               participant_sid = $4,
               recording_Url = $5
               timestamp = NOW()
           WHERE call_sid = $6
          `,
          [CallStatus, CallDuration, participantSid, CallSid]
        );
      } else {
        console.log("Inserting new call log for CallSid:", CallSid);
        await query(
          `INSERT INTO call_logs
           (call_sid, call_status, from_number, to_number, call_duration, recording_url, participant_sid, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          `,
          [
            CallSid,
            CallStatus,
            From,
            To,
            CallDuration,
            RecordingUrl,
            participantSid,
          ]
        );
      }

      console.log("Call log processed successfully for CallSid:", CallSid);
      Logger.info("Call log processed successfully", { CallSid });
    } catch (error) {
      console.error("Error processing call log:", error);
      Logger.error("Error processing call log", { error, CallSid });
      throw error;
    }
  }
  // ----------------------------------------------------------------------------
  // HANDLE RECORDING STATUS CALLBACK
  // ----------------------------------------------------------------------------
  public async recordingStatusCallback(req: Request, res: Response): Promise<Response> {
    const {
      CallSid,
      ConferenceSid,
      RecordingSid,
      RecordingUrl,
      RecordingDuration,
    } = req.body as {
      CallSid?: string;
      ConferenceSid?: string;
      RecordingSid?: string;
      RecordingUrl?: string;
      RecordingDuration?: string;
    };
  
    Logger.info("Received Recording Status Callback", {
      CallSid,
      ConferenceSid,
      RecordingSid,
      RecordingUrl,
      RecordingDuration,
    });
  
    try {
      // If neither CallSid nor ConferenceSid is present, we can't match the DB record
      if (!CallSid && !ConferenceSid) {
        Logger.warn("Missing required fields - no CallSid or ConferenceSid", {
          CallSid,
          ConferenceSid,
        });
        return res.status(400).json({ error: "Missing callSid or conferenceSid" });
      }
  
      if (!RecordingUrl) {
        Logger.warn("Missing RecordingUrl in recording callback", { CallSid, ConferenceSid });
        return res.status(400).json({ error: "Missing RecordingUrl" });
      }
  
      // We'll match on whichever SID is present
      const sidUsedForLookup = CallSid || ConferenceSid;
  
      // Parse the RecordingDuration to an integer (or null)
      const parsedDuration = RecordingDuration
        ? parseInt(RecordingDuration, 10)
        : null;
  
      // We updated call_logs to have both call_sid and conference_sid columns
      // so let's match either one:
      const sql = `
        UPDATE public.call_logs
        SET recording_url = $1,
            call_duration = $2
        WHERE call_sid = $3 OR conference_sid = $3
      `;
  
      const values = [RecordingUrl, parsedDuration, sidUsedForLookup];
  
      Logger.info("About to run SQL on call_logs", { query: sql, values });
  
      const result = await query(sql, values);
  
      Logger.info("SQL execution result for updating call_logs", {
        rowCount: result.rowCount,
        rows: result.rows,
      });
  
      if (result.rowCount === 0) {
        Logger.warn("No matching row found to update (call_sid or conference_sid)", {
          sidUsedForLookup,
        });
        return res.status(404).json({ error: "No matching record found" });
      }
  
      Logger.info("Recording URL updated", {
        sidUsedForLookup,
        RecordingUrl,
        updatedDuration: parsedDuration,
      });
      return res.status(200).send("OK");
    } catch (error) {
      Logger.error("Error updating call logs with recording", { error });
      return res.status(500).send("Failed to update call logs");
    }
  }
  

  // ----------------------------------------------------------------------------
  // LOG CALL STATUS (Helper)
  // ----------------------------------------------------------------------------
  public async logCallStatus(
    callSid: string,
    callStatus: string,
    direction: string,
    from: string,
    to: string,
    callDuration?: number,
    recordingUrl?: string,
    participantSid?: string,
    conferenceSid?: string // NEW PARAM
  ) {
    console.log("Log Call Status:", {
      callSid,
      callStatus,
      direction,
      from,
      to,
      callDuration,
      recordingUrl,
      participantSid,
      conferenceSid,
    });
  
    try {
      const queryText = `
        INSERT INTO call_logs (
          call_sid,
          call_status,
          direction,
          from_number,
          to_number,
          call_duration,
          recording_url,
          participant_sid,
          conference_sid,
          timestamp
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (call_sid) DO UPDATE
          SET call_status     = EXCLUDED.call_status,
              call_duration   = EXCLUDED.call_duration,
              participant_sid = EXCLUDED.participant_sid,
              conference_sid  = EXCLUDED.conference_sid,
              timestamp       = EXCLUDED.timestamp
              ${
                recordingUrl
                  ? ", recording_url = EXCLUDED.recording_url"
                  : ""
              };
      `;
  
      const values = [
        callSid,
        callStatus,
        direction,
        from,
        to,
        callDuration || null,
        recordingUrl || null,
        participantSid || null,
        conferenceSid || null,
      ];
  
      await query(queryText, values);
      Logger.info("Call status logged successfully", { callSid, callStatus });
  
      // Emit an event if needed
      this.ioServer.emit("outbound-call-status", {
        callSid,
        status: callStatus,
        from,
        to,
      });
    } catch (error) {
      console.error("Error logging call status:", error);
      Logger.error("Error logging call status", { error, callSid, callStatus });
      throw error;
    }
  }
  

  // ----------------------------------------------------------------------------
  // GET CALL LOGS LIST (PAGINATED)
  // ----------------------------------------------------------------------------
  /**
   * Retrieves a paginated list of call logs with minimal details.
   * This endpoint is optimized for list views where full details aren't needed.
   *
   * @param page - The page number to retrieve (1-based indexing)
   * @param pageSize - Number of records per page
   * @returns {
   *   logs: Array of call logs with basic info (id, call_sid, from_number, to_number, start_time, direction)
   *   pagination: {
   *     currentPage: number,
   *     pageSize: number,
   *     totalPages: number,
   *     totalCount: number
   *   }
   * }
   * @throws Error if database query fails
   */
  public async getCallLogsList() {
    try {
      // Get all call logs with assigned users from signalwire database
      const logsQuery = `
        SELECT 
          cl.call_sid,
          cl.from_number,
          cl.to_number,
          cl.timestamp as start_time,
          cl.direction,
          cl.call_duration,
          cl.call_status,
          cl.recording_url,
          dn.assigned_user as username
        FROM public.call_logs cl
        LEFT JOIN public.did_numbers dn ON 
          CASE 
            WHEN cl.direction = 'inbound' THEN cl.to_number = dn.phone_number
            WHEN cl.direction = 'outbound' THEN cl.from_number = dn.phone_number
          END
        ORDER BY cl.timestamp DESC
      `;

      const logsResult = await query(logsQuery);

      // Get unique usernames that need user details
      const usernames = logsResult.rows
        .map((log: { username?: string }) => log.username)
        .filter((username: string): username is string => !!username);

      // If we have any usernames, get their details from user_management database
      let userDetails: Record<
        string,
        { first_name: string; last_name: string }
      > = {};
      if (usernames.length > 0) {
        const userQuery = `
          SELECT username, first_name, last_name
          FROM public.users
          WHERE username = ANY($1)
        `;

        if (!global.userManagementPool) {
          throw new Error("User management database connection not available");
        }

        const userResult = await global.userManagementPool.query(userQuery, [
          usernames,
        ]);
        userDetails = Object.fromEntries(
          userResult.rows.map(
            (user: {
              username: string;
              first_name: string;
              last_name: string;
            }) => [
              user.username,
              { first_name: user.first_name, last_name: user.last_name },
            ]
          )
        );
      }

      // Merge user details into the logs
      const logsWithUserDetails = logsResult.rows.map(
        (log: { username?: string }) => ({
          ...log,
          user: log.username ? userDetails[log.username] : null,
        })
      );

      return {
        logs: logsWithUserDetails,
      };
    } catch (error: any) {
      Logger.error("Error fetching call logs list:", { error: error.message });
      throw new Error("Failed to fetch call logs list");
    }
  }

  // ----------------------------------------------------------------------------
  // GET CALL LOG DETAILS
  // ----------------------------------------------------------------------------
  /**
   * Retrieves detailed information about a specific call log, including associated user information.
   * This endpoint performs the following:
   * 1. Queries the call_logs table for the specified log
   * 2. Joins with did_numbers to get the assigned_user
   * 3. If an assigned_user exists, queries the users table to get their details
   *
   * @param id - The ID of the call log to retrieve
   * @returns {
   *   id: number,
   *   call_sid: string,
   *   from_number: string,
   *   to_number: string,
   *   direction: string,
   *   start_time: Date,
   *   end_time: Date,
   *   duration: number,
   *   recording_url?: string,
   *   assigned_user?: string,
   *   user?: {
   *     username: string,
   *     firstName: string,
   *     lastName: string
   *   }
   * }
   * @throws Error if call log not found or database query fails
   */
  public async getCallLogDetails(id: number) {
    try {
      // First get the call log details
      const logQuery = `
        SELECT cl.*, dn.assigned_user
        FROM public.call_logs cl
        LEFT JOIN public.did_numbers dn ON 
          CASE 
            WHEN cl.direction = 'inbound' THEN cl.to_number = dn.phone_number
            WHEN cl.direction = 'outbound' THEN cl.from_number = dn.phone_number
          END
        WHERE cl.id = $1
      `;

      const logResult = await query(logQuery, [id]);

      if (logResult.rows.length === 0) {
        throw new Error("Call log not found");
      }

      const callLog = logResult.rows[0];

      // If we have an assigned user, get their details
      if (callLog.assigned_user) {
        const userQuery = `
          SELECT username, first_name, last_name
          FROM public.users
          WHERE username = $1
        `;

        // Check if userManagementPool exists
        if (!global.userManagementPool) {
          Logger.error("User management pool not initialized");
          throw new Error("User management database connection not available");
        }

        const userResult = await global.userManagementPool.query(userQuery, [
          callLog.assigned_user,
        ]);

        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          callLog.user = {
            username: user.username,
            firstName: user.first_name,
            lastName: user.last_name,
          };
        }
      }

      return callLog;
    } catch (error: any) {
      Logger.error("Error fetching call log details:", {
        error: error.message,
      });
      throw new Error("Failed to fetch call log details");
    }
  }

  // ----------------------------------------------------------------------------
  // GET DID NUMBERS BY USER
  // ----------------------------------------------------------------------------
  public async getDidNumbersByUser(username: string) {
    try {
      const sqlQuery = `
        SELECT phone_number, status, assigned_user
        FROM public.did_numbers
        WHERE assigned_user = $1
      `;
      const result = await this.signalWireDBClient.query(sqlQuery, [username]);
      return result.rows;
    } catch (error: any) {
      Logger.error("Error fetching DID numbers by user:", {
        error: error.message,
      });
      throw new Error("Failed to fetch DID numbers by user");
    }
  }

  // ----------------------------------------------------------------------------
  // BUY NUMBERS
  // ----------------------------------------------------------------------------
  public async buyNumbers(
    areaCode: string,
    quantity: number = 1
  ): Promise<void> {
    try {
      Logger.info("Attempting to purchase phone numbers", {
        areaCode,
        quantity,
      });

      const areaCodeAsNumber = parseInt(areaCode, 10);
      if (isNaN(areaCodeAsNumber)) {
        throw new Error(`Invalid areaCode: must be numeric. Got "${areaCode}"`);
      }

      // Search for available phone numbers
      const availableNumbers = await this.signalWireClient
        .availablePhoneNumbers("US")
        .local.list({
          areaCode: areaCodeAsNumber,
          limit: quantity,
        });

      if (!availableNumbers || availableNumbers.length === 0) {
        throw new Error(
          `No available phone numbers found for area code ${areaCode}`
        );
      }

      // Purchase each number and insert into did_numbers
      for (const candidate of availableNumbers) {
        const purchased =
          await this.signalWireClient.incomingPhoneNumbers.create({
            phoneNumber: candidate.phoneNumber,
          });

        const insertSQL = `
          INSERT INTO public.did_numbers (phone_number, status, assigned_user)
          VALUES ($1, 'Free', null)
        `;
        await this.signalWireDBClient.query(insertSQL, [purchased.phoneNumber]);

        Logger.info("Purchased and inserted new DID", {
          phoneNumber: purchased.phoneNumber,
        });
      }

      Logger.info("Completed purchasing phone numbers successfully", {
        areaCode,
        quantity,
      });
    } catch (error: any) {
      Logger.error("Error buying phone numbers", { error: error.message });
      throw new Error(error.message);
    }
  }

  // ----------------------------------------------------------------------------
  // CONFIGURE A SINGLE DID (Optional, for inbound voiceUrl, etc.)
  // ----------------------------------------------------------------------------
  private async configureNumber(phoneNumber: string): Promise<void> {
    try {
      // The endpoints for your calls
      const voiceUrl =
        "https://elevatedhl.signalwire.com/laml-bins/55dd7d20-df8e-47fe-b436-a5b7da533f75";
      const statusCallback =
        "https://elecrm-serverside-kvg9r.ondigitalocean.app/api/signalwire/webhook/voice-status-callback";
      const smsUrl =
        "https://elecrm-serverside-kvg9r.ondigitalocean.app/api/signalwire/sms/inbound";

      // Look up the number in your SignalWire account
      const incomingNumbers =
        await this.signalWireClient.incomingPhoneNumbers.list({
          phoneNumber,
          limit: 1,
        });
      if (!incomingNumbers || incomingNumbers.length === 0) {
        throw new Error(`Incoming phone number ${phoneNumber} not found`);
      }

      const numberInfo = incomingNumbers[0];

      // Update that phone number with new config
      await this.signalWireClient.incomingPhoneNumbers(numberInfo.sid).update({
        voiceUrl,
        statusCallback,
        smsUrl,
      });

      Logger.info("Configured DID in SignalWire", {
        phoneNumber,
        sid: numberInfo.sid,
      });
    } catch (error: any) {
      Logger.error("Error configuring phone number", { error: error.message });
      throw new Error(error.message);
    }
  }

  // ----------------------------------------------------------------------------
  // ASSIGN DID TO USER
  // ----------------------------------------------------------------------------
  public async assignDidToUser(username: string): Promise<string> {
    try {
      // 1. Grab the first 'Free' DID
      const selectSQL = `
        SELECT phone_number
        FROM public.did_numbers
        WHERE status = 'Free'
        ORDER BY phone_number ASC
        LIMIT 1
      `;
      const selectResult = await this.signalWireDBClient.query(selectSQL);

      if (selectResult.rows.length === 0) {
        throw new Error("No 'Free' DIDs available to assign.");
      }

      const phoneNumber = selectResult.rows[0].phone_number;

      // 2. Update record to 'Assigned'
      const updateSQL = `
        UPDATE public.did_numbers
        SET status = 'Assigned',
            assigned_user = $1
        WHERE phone_number = $2
      `;
      await this.signalWireDBClient.query(updateSQL, [username, phoneNumber]);

      // 3. Optionally configure the phone number in SignalWire
      await this.configureNumber(phoneNumber);

      // Return the assigned DID
      return phoneNumber;
    } catch (error: any) {
      Logger.error("Error assigning DID to user", { error: error.message });
      throw new Error(error.message);
    }
  }

  // ----------------------------------------------------------------------------
  // INCOMING CALL NOTIFICATION
  // ----------------------------------------------------------------------------
  public async incomingCallNotification(
    input: incomingCallNotificationRequest
  ) {
    try {
      const { StatusCallbackEvent, CallStatus, To = "" } = input;
  
      if (StatusCallbackEvent) {
        switch (StatusCallbackEvent) {
          case "participant-join": {
            Logger.info("Participant joined the conference", {
              conferenceSid: input.ConferenceSid,
              callSid: input.CallSid,
            });
  
            // Fetch participant call info
            const participantResponse = await this.signalWireClient
              .calls(input.CallSid)
              .fetch();
            Logger.info("Participant details", { participantResponse });
  
            // UPDATED: Log the inbound call, also storing conferenceSid
            await this.logCallStatus(
              participantResponse.sid,      // callSid
              participantResponse.status,   // callStatus
              "inbound",                    // direction
              participantResponse.from,     // from
              participantResponse.to,       // to
              undefined,                    // callDuration
              undefined,                    // recordingUrl
              undefined,                    // participantSid
              input.ConferenceSid          // NEW: store the conference SID
            );
  
            // Check if there is an existing lead
            const existingLead = await this.findLeadByPhoneNumber(
              participantResponse.from
            );
  
            if (existingLead) {
              Logger.info("Existing lead found", {
                leadId: existingLead.id,
                from: participantResponse.from,
              });
            } else {
              Logger.info("No existing lead found for 'from' number", {
                from: participantResponse.from,
              });
            }
  
            Logger.info("Looking up user by 'to' phone number", {
              to: participantResponse?.to,
            });
  
            // Attempt to find assigned user
            const user = await this.findUserByPhoneNumber(participantResponse?.to);
            if (user && user?.status?.toLowerCase() === "assigned") {
              Logger.info("User found and assigned", { user });
              this.ioServer.emit(`user-notification-${user.assigned_user}`, {
                conferenceSid: input.ConferenceSid,
                callSid: input.CallSid,
                from: participantResponse.from,
                to: To,
                leadData: existingLead,
              });
            } else {
              // Attempt ring group
              const ringGroup = await this.findRingGroupByPhoneNumber(
                participantResponse?.to
              );
              if (ringGroup) {
                Logger.info("Ring Group found", { ringGroup });
                this.ioServer.emit("ring-group-notification", {
                  conferenceSid: input.ConferenceSid,
                  callSid: input.CallSid,
                  from: participantResponse.from,
                  to: To,
                  source: ringGroup.display_name,
                  leadData: existingLead,
                });
              } else {
                // If no user or ring group => "incoming-call"
                this.ioServer.emit("incoming-call", {
                  conferenceSid: input.ConferenceSid,
                  callSid: input.CallSid,
                  from: participantResponse.from,
                  leadData: existingLead,
                });
              }
            }
            break;
          }
  
          case "participant-leave":
            Logger.info("Participant left the conference", {
              conferenceSid: input.ConferenceSid,
              callSid: input.CallSid,
            });
            this.ioServer.emit("participant-leave", {
              conferenceSid: input.ConferenceSid,
              callSid: input.CallSid,
              from: input.From,
              to: input.To,
            });
            break;
  
          case "conference-end":
            Logger.info("Conference ended", {
              conferenceSid: input.ConferenceSid,
            });
            this.ioServer.emit("conference-end", {
              conferenceSid: input.ConferenceSid,
              reason: input.ReasonConferenceEnded,
              callSidEndingConference: input.CallSidEndingConference,
            });
            break;
  
          default:
            Logger.warn("Unhandled StatusCallbackEvent", { StatusCallbackEvent });
        }
      } else if (CallStatus) {
        // If the call is not completed, just update status
        if (CallStatus !== "completed") {
          Logger.info("Call status update", {
            callSid: input.CallSid,
            callStatus: CallStatus,
          });
  
          const user = await this.findUserByPhoneNumber(To);
          if (user && user.status.toLowerCase() === "assigned") {
            this.ioServer.emit(`user-call-status-${user.assigned_user}`, {
              callSid: input.CallSid,
              callStatus: CallStatus,
              from: input.From,
              to: To,
              timestamp: input.Timestamp,
            });
          } else {
            this.ioServer.emit("call-status-update", {
              callSid: input.CallSid,
              callStatus: CallStatus,
              from: input.From,
              to: To,
              timestamp: input.Timestamp,
            });
          }
        }
      } else {
        Logger.warn("Unhandled incoming call notification", { input });
      }
    } catch (error) {
      Logger.error("Error receiving webhook data:", { error });
      throw new Error("Error receiving webhook data");
    }
  }
  
  

  // ----------------------------------------------------------------------------
  // Attended and Unattended Transfer Functions
  // ----------------------------------------------------------------------------
  /**
   * Blind (Unattended) Transfer
   * @param callSid The Call SID to be transferred
   * @param redirectUrl A TwiML/LAML endpoint that dials the new party
   */
  public async blindTransfer(callSid: string, redirectUrl: string) {
    Logger.info("Performing blind transfer", { callSid, redirectUrl });
    try {
      // In your code, "updateCall" sets a new "Url" on the existing call
      // so that the call is redirected to new TwiML instructions.
      const updatedCall = await this.updateCall(
        callSid,
        "in-progress",
        redirectUrl
      );

      return {
        message: "Blind transfer initiated",
        callSid: updatedCall.sid || callSid,
        status: updatedCall.status,
        redirectUrl,
      };
    } catch (error: any) {
      Logger.error("Error performing blind transfer", { error: error.message });
      throw new Error(`Failed to perform blind transfer: ${error.message}`);
    }
  }

  /**
   * Hang up a specific Call SID
   */
  public async hangupCall(callSid: string) {
    Logger.info("Hanging up callSid", { callSid });
    try {
      // Reuse your existing "updateCall" with status=completed
      const response = await this.updateCall(callSid, "completed");
      return {
        message: "Call hung up successfully",
        callSid,
        status: response.status,
      };
    } catch (error: any) {
      Logger.error("Error hanging up callSid", { error: error.message });
      throw new Error(`Failed to hang up call: ${error.message}`);
    }
  }

  /**
   * Hold the original participant in a conference (Attended Transfer Step)
   */
  public async holdOriginalParticipant(conferenceSid: string, callSid: string) {
    Logger.info("Attended Transfer: Holding original participant", {
      conferenceSid,
      callSid,
    });
    try {
      // "updateParticipant" is an existing method that sets hold/mute
      const result = await this.updateParticipant(conferenceSid, callSid, {
        Hold: "true",
      });
      return {
        message: "Original participant placed on hold",
        conferenceSid,
        callSid,
        result,
      };
    } catch (error: any) {
      Logger.error("Error holding original participant", {
        error: error.message,
      });
      throw new Error(`Failed to hold original participant: ${error.message}`);
    }
  }

  /**
   * Create a 'consultation' call for Attended Transfer
   */
  public async createConsultationCall(
    fromNumber: string,
    consultNumber: string,
    consultUrl: string
  ) {
    Logger.info("Attended Transfer: Creating consultation call", {
      fromNumber,
      consultNumber,
      consultUrl,
    });
    try {
      // Reuse your existing `dial` method
      const newCall = await this.dial(fromNumber, consultNumber, consultUrl);
      return {
        message: "Consultation call created",
        consultCallSid: newCall.callSid,
        status: newCall.status,
      };
    } catch (error: any) {
      Logger.error("Error creating consultation call", {
        error: error.message,
      });
      throw new Error(`Failed to create consultation call: ${error.message}`);
    }
  }

  /**
   * Add the new consult call into the existing conference
   */
  public async addConsultationCallToConference(
    conferenceSid: string,
    consultCallSid: string,
    lamlBinUrl: string
  ) {
    Logger.info("Attended Transfer: Adding consult call to conference", {
      conferenceSid,
      consultCallSid,
      lamlBinUrl,
    });
    try {
      // Possibly reuse your "addParticipantToConference"
      const result = await this.addParticipantToConference(
        consultCallSid,
        lamlBinUrl
      );
      return {
        message: "Consultation call added to conference",
        conferenceSid,
        consultCallSid,
        result,
      };
    } catch (error: any) {
      Logger.error("Error adding consultation to conference", {
        error: error.message,
      });
      throw new Error(`Failed to add consultation call: ${error.message}`);
    }
  }

  /**
   * Unhold the original participant so they can talk to the consult participant
   */
  public async unholdOriginalParticipant(
    conferenceSid: string,
    callSid: string
  ) {
    Logger.info("Attended Transfer: Unholding original participant", {
      conferenceSid,
      callSid,
    });
    try {
      // Reuse your "updateParticipant" or "resumeParticipant"
      const result = await this.updateParticipant(conferenceSid, callSid, {
        Hold: "false",
      });
      return {
        message: "Original participant unheld",
        conferenceSid,
        callSid,
        result,
      };
    } catch (error: any) {
      Logger.error("Error unholding original participant", {
        error: error.message,
      });
      throw new Error(
        `Failed to unhold original participant: ${error.message}`
      );
    }
  }

  /**
   * Remove (kick) yourself from the conference if you want to drop out
   */
  public async removeSelfFromConference(
    conferenceSid: string,
    callSid: string
  ) {
    Logger.info("Attended Transfer: Removing self from conference", {
      conferenceSid,
      callSid,
    });
    try {
      const result = await this.deleteParticipant(conferenceSid, callSid);
      return {
        message: "You have been removed from the conference",
        conferenceSid,
        callSid,
        result,
      };
    } catch (error: any) {
      Logger.error("Error removing self from conference", {
        error: error.message,
      });
      throw new Error(`Failed to remove self: ${error.message}`);
    }
  }

  // ----------------------------------------------------------------------------
  // UPLOAD VOICEMAIL GREETING TO DIGITALOCEAN SPACES
  // ----------------------------------------------------------------------------
  public async uploadVoicemailGreeting(
    fileBuffer: Buffer,
    username: string,
    voicemailType: string,
    mimeType: string = "audio/mpeg"
  ): Promise<string> {
    try {
      // 1) Construct the final filename e.g. "Imendoza_Standard_Voicemail.mp3"
      const fileName = `${username}_${voicemailType}.mp3`;

      // 2) Path in the bucket
      const Key = `User_Assets/User_Voice_Mail_Recordings/${fileName}`;

      // 3) Upload using the S3Client (already set up in your constructor)
      const command = new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key,
        Body: fileBuffer,
        ACL: "public-read", // or "private"
        ContentType: mimeType,
      });
      await this.s3Client.send(command);

      // 4) Return the final URL
      return `https://${this.s3Bucket}.sfo3.cdn.digitaloceanspaces.com/${Key}`;
    } catch (error) {
      Logger.error("Error uploading voicemail greeting", { error });
      throw new Error("Failed to upload voicemail greeting");
    }
  }

  // ----------------------------------------------------------------------------
  // PRIVATE HELPER: FIND LEAD BY PHONE NUMBER
  // ----------------------------------------------------------------------------
  private async findLeadByPhoneNumber(
    phoneNumber: string
  ): Promise<CombinedLeadData | null> {
    const sqlQuery = `
      SELECT * FROM app.combined_leads
      WHERE cell_phone = $1
      LIMIT 1
    `;
    const result = await this.appDBClient.query(sqlQuery, [phoneNumber]);
    return result.rows[0] || null;
  }

  // ----------------------------------------------------------------------------
  // PRIVATE HELPER: FIND USER BY PHONE NUMBER
  // ----------------------------------------------------------------------------
  public async findUserByPhoneNumber(
    phoneNumber: string
  ): Promise<didNumbersResponse | null> {
    try {
      const sqlQuery = `
        SELECT phone_number, status, assigned_user
        FROM public.did_numbers
        WHERE phone_number = $1
        LIMIT 1
      `;
      const result = await this.signalWireDBClient.query(sqlQuery, [
        phoneNumber,
      ]);

      if (result.rows.length === 0) {
        Logger.warn("No user found for phone number", { phoneNumber });
        return null;
      }

      return result.rows[0]; 
    } catch (error: any) {
      Logger.error("Error finding user by phone number:", {
        error: error.message,
      });
      throw new Error("Failed to find user by phone number");
    }
  }

  // ----------------------------------------------------------------------------
  // PRIVATE HELPER: FIND RING GROUP BY PHONE NUMBER
  // ----------------------------------------------------------------------------
  public async findRingGroupByPhoneNumber(
    phoneNumber: string
  ): Promise<RingGroup | null> {
    const sqlQuery = `
      SELECT phone_number, ring_group, display_name
      FROM public.ring_groups
      WHERE phone_number = $1
      LIMIT 1
    `;
    const result = await this.signalWireDBClient.query(sqlQuery, [phoneNumber]);

    if (result.rows.length === 0) {
      Logger.warn("No ring group found for phone number", { phoneNumber });
      return null;
    }

    return result.rows[0];
  }
}
