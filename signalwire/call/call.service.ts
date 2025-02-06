//Server Side\src\signalwire\call\call.service.ts
import { Request, Response } from "express";
import axios from "axios";
import { RestClient } from "@signalwire/compatibility-api";
import qs from "qs";
import { CallInstance } from "@signalwire/compatibility-api/lib/rest/api/v2010/account/call";
import { query } from "../signalwire.database";
import { Pool } from "pg";
import { Logger } from "../../shared/logger";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export class CallService {
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
  private s3Client: S3Client;
  private s3Bucket: string;
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
    // Use non-null assertion because we already checked that global.pool exists.
    this.appDBClient = global.pool!;

    // ---- INITIALIZE S3 CLIENT FOR DO SPACES ----
    this.s3Client = new S3Client({
      region: "us-east-1", // DigitalOcean Spaces region
      endpoint: process.env.DO_SPACES_ENDPOINT, // Must be "https://sfo3.digitaloceanspaces.com"
      credentials: {
        accessKeyId: process.env.DO_SPACES_KEY || "",
        secretAccessKey: process.env.DO_SPACES_SECRET || "",
      },
      forcePathStyle: true, // MUST BE TRUE for DigitalOcean Spaces
    });

    // e.g. "elecrm" or whatever your bucket name is
    this.s3Bucket = process.env.DO_SPACES_BUCKET || "elecrm";
  }

  // ============================================================
  // CALL OPERATIONS
  // ============================================================

  /**
   * Initiates a new call.
   */
  public async dial(from: string, to: string, url: string) {
    try {
      Logger.info("CallService: Initiating call", { from, to, url });
      const response = await this.signalWireClient.calls.create({
        url,
        from,
        to,
        statusCallback: `${process.env.BASE_URL}/api/signalwire/webhook/voice-status-callback`,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        record: "record-from-ringing",
        recordingStatusCallback: `${process.env.BASE_URL}/api/signalwire/webhook/recording-status-callback`,
        recordingStatusCallbackMethod: "POST",
      });
      await this.logCallStatus(response.sid, response.status, "outbound", from, to);
      return {
        message: "Call initiated successfully",
        callSid: response.sid,
        participantSid: response.phoneNumberSid,
        status: response.status,
        url: response.events,
      };
    } catch (error: any) {
      Logger.error("CallService: Error initiating call", {
        error: error.message,
        stack: error.stack,
      });
      throw new Error("Failed to initiate call");
    }
  }

  /**
   * Places an active call on hold.
   */
  public async hold(callId: string) {
    try {
      Logger.info("CallService: Holding call", { callId });
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
      await this.logCallStatus(callId, "paused", "outbound", "", "");
      Logger.info("CallService: Call held successfully", { callId });
      return {
        message: "Call held successfully",
        callSid: callId,
        status: response.data.status,
      };
    } catch (error: any) {
      Logger.error("CallService: Error holding call", { error: error.message, stack: error.stack });
      throw new Error("Failed to hold call");
    }
  }

  /**
   * Resumes a call that was on hold.
   */
  public async resume(callId: string) {
    try {
      Logger.info("CallService: Resuming call", { callId });
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
      await this.logCallStatus(callId, "in-progress", "outbound", "", "");
      Logger.info("CallService: Call resumed successfully", { callId });
      return {
        message: "Call resumed successfully",
        callSid: callId,
        status: response.data.status,
      };
    } catch (error: any) {
      Logger.error("CallService: Error resuming call", { error: error.message, stack: error.stack });
      throw new Error("Failed to resume call");
    }
  }

  /**
   * Ends a call.
   */
  public async hangup(conferenceSid: string) {
    try {
      Logger.info("CallService: Hanging up call", { conferenceSid });
      const response = await this.signalWireClient.calls(conferenceSid).update({ status: "completed" });
      await this.logCallStatus(conferenceSid, "completed", "outbound", "", "");
      Logger.info("CallService: Call hung up successfully", { conferenceSid });
      return {
        message: "Call hung up successfully",
        conferenceSid,
        status: response.status,
      };
    } catch (error: any) {
      Logger.error("CallService: Error hanging up call", { error: error.message, stack: error.stack });
      throw new Error("Failed to hang up call");
    }
  }

  /**
   * Lists all calls.
   */
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
      Logger.info("CallService: Fetched all calls successfully");
      return response.data.calls;
    } catch (error: any) {
      Logger.error("CallService: Error listing all calls", { error: error.message });
      throw new Error("Failed to list all calls");
    }
  }

  /**
   * Updates a call's parameters.
   */
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
      Logger.info("CallService: Updated call status successfully", { callSid, status });
      return response.data;
    } catch (error: any) {
      Logger.error("CallService: Error updating call", { error: error.message });
      throw new Error("Failed to update call");
    }
  }

  /**
   * Initiates a blind (unattended) transfer by updating the call's URL.
   */
  public async blindTransfer(callSid: string, redirectUrl: string) {
    try {
      Logger.info("CallService: Performing blind transfer", { callSid, redirectUrl });
      const updatedCall: any = await this.updateCall(callSid, "in-progress", redirectUrl);
      return {
        message: "Blind transfer initiated",
        callSid: updatedCall.sid || callSid,
        status: updatedCall.status,
        redirectUrl,
      };
    } catch (error: any) {
      Logger.error("CallService: Error performing blind transfer", { error: error.message });
      throw new Error(`Failed to perform blind transfer: ${error.message}`);
    }
  }

  /**
   * Hangs up a call as part of a transfer process.
   */
  public async hangupCall(callSid: string) {
    try {
      Logger.info("CallService: Hanging up call (transfer)", { callSid });
      const response = await this.updateCall(callSid, "completed");
      return {
        message: "Call hung up successfully",
        callSid,
        status: response.status,
      };
    } catch (error: any) {
      Logger.error("CallService: Error hanging up call (transfer)", { error: error.message });
      throw new Error(`Failed to hang up call: ${error.message}`);
    }
  }

  /**
   * Processes a call status update from a webhook.
   */
  public async callStatusUpdate(data: any) {
    try {
      const { CallSid, CallStatus, Timestamp, Direction, From, To, CallDuration, RecordingUrl } = data;
      Logger.info("CallService: Logging call status", { From, To, CallSid });
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
        RecordingUrl,
      ];
      const result = await query(sqlQuery, values);
      Logger.info("CallService: Call log inserted/updated", { result: result.rows[0] });
      return result.rows[0];
    } catch (error: any) {
      Logger.error("CallService: Error inserting call log", { error: error.message, stack: error.stack });
      throw new Error("Failed to insert call log into database");
    }
  }

  /**
   * Sends DTMF tones to a call by generating a LaML response and updating the call.
   */
  public async sendConferenceDtmfTone(
    callSid: string,
    dtmfTones: string,
    lamlBinUrl: string
  ): Promise<CallInstance> {
    try {
      Logger.info("CallService: Sending DTMF tones", { callSid, dtmfTones, lamlBinUrl });
      const voiceResponse = new RestClient.LaML.VoiceResponse();
      voiceResponse.play({ digits: `w${dtmfTones}` });
      voiceResponse.redirect(lamlBinUrl);
      Logger.info("CallService: Generated LaML Response", { callSid, laMlResponse: voiceResponse.toString() });
      const updateResponse = await this.signalWireClient.calls(callSid).update({
        twiml: voiceResponse.toString(),
      });
      Logger.info("CallService: DTMF tones sent", { callSid, updateResponse });
      return updateResponse;
    } catch (error: any) {
      Logger.error("CallService: Error sending DTMF tones", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      if (error instanceof Error) {
        throw new Error(`Failed to send DTMF tone: ${error.message}`);
      }
      throw new Error("An unknown error occurred");
    }
  }

  // ------------------------------------------------------------------
  // Helper: Log Call Status
  // ------------------------------------------------------------------
  public async logCallStatus(
    callSid: string,
    callStatus: string,
    direction: string,
    from: string,
    to: string,
    callDuration?: number,
    recordingUrl?: string,
    participantSid?: string,
    conferenceSid?: string
  ) {
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
          SET call_status = EXCLUDED.call_status,
              call_duration = EXCLUDED.call_duration,
              participant_sid = EXCLUDED.participant_sid,
              conference_sid = EXCLUDED.conference_sid,
              timestamp = EXCLUDED.timestamp
              ${recordingUrl ? ", recording_url = EXCLUDED.recording_url" : ""}
        ;
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
      const result = await query(queryText, values);
      Logger.info("CallService: Call status logged successfully", { callSid, callStatus });
      this.ioServer.emit("outbound-call-status", {
        callSid,
        status: callStatus,
        from,
        to,
      });
      return result.rows[0];
    } catch (error: any) {
      Logger.error("CallService: Error logging call status", { error: error.message, stack: error.stack });
      throw new Error("Failed to insert call log into database");
    }
  }

  /**
   * Retrieves a paginated list of call logs.
   */
  public async getCallLogsList() {
    try {
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
      return { logs: logsResult.rows };
    } catch (error: any) {
      Logger.error("CallService: Error fetching call logs list", { error: error.message });
      throw new Error("Failed to fetch call logs list");
    }
  }

  /**
   * Retrieves detailed information about a specific call log.
   */
  public async getCallLogDetails(id: number) {
    try {
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
      return callLog;
    } catch (error: any) {
      Logger.error("CallService: Error fetching call log details", { error: error.message });
      throw new Error("Failed to fetch call log details");
    }
  }
}
