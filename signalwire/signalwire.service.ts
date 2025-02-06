import axios from "axios";
import { RestClient } from "@signalwire/compatibility-api";
import { incomingCallNotificationRequest } from "./signalwire.model";
import { query } from "./signalwire.database";
import { Logger } from "../shared/logger";
import { Pool } from "pg";

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
  private signalWireDBClient: any; // from global.signalWirePool
  private appDBClient: Pool;

  constructor(ioServer: any) {
    this.ioServer = ioServer;
    this.signalWireClient = RestClient(
      this.SIGNALWIRE_PROJECT_ID,
      this.SIGNALWIRE_AUTH_TOKEN,
      { signalwireSpaceUrl: process.env.SIGNALWIRE_API_URL }
    );
    if (!global.signalWirePool) {
      throw new Error("SignalWire pool not initialized.");
    }
    this.signalWireDBClient = global.signalWirePool;
    if (!global.pool) {
      throw new Error("Main App Database pool is not initialized.");
    }
    this.appDBClient = global.pool as Pool;
  }

  /**
   * Retrieves all users with their status for the Team Status panel.
   * Returns an array of objects:
   *   { first_name, last_name, sw_phone_number, master_status }
   */
  public async getTeamStatus() {
    if (!global.userManagementPool) {
      Logger.error("Database connection to user_management is not initialized.");
      throw new Error("Database connection to user_management is missing.");
    }
    const sqlQuery = `
      SELECT
        u.first_name,
        u.last_name,
        u.sw_phone_number,
        s.master_status
      FROM public.users AS u
      LEFT JOIN public.user_status AS s ON u.username = s.user_id
      ORDER BY u.first_name, u.last_name;
    `;
    try {
      const result = await global.userManagementPool.query(sqlQuery);
      return result.rows;
    } catch (error: any) {
      Logger.error("Error fetching team status from user_management", { error: error.message });
      throw new Error("Failed to fetch team status from user_management");
    }
  }

  /**
   * Processes an incoming call notification from SignalWire.
   */
  public async incomingCallNotification(input: incomingCallNotificationRequest) {
    try {
      const { StatusCallbackEvent, CallStatus, To = "" } = input;
      if (StatusCallbackEvent) {
        switch (StatusCallbackEvent) {
          case "participant-join": {
            Logger.info("Participant joined the conference", {
              conferenceSid: input.ConferenceSid,
              callSid: input.CallSid,
            });
            const participantResponse = await this.signalWireClient
              .calls(input.CallSid)
              .fetch();
            Logger.info("Participant details", { participantResponse });
            await this.logCallStatus(
              participantResponse.sid,
              participantResponse.status,
              "inbound",
              participantResponse.from,
              participantResponse.to,
              undefined,
              undefined,
              undefined,
              input.ConferenceSid
            );
            const existingLead = await this.findLeadByPhoneNumber(participantResponse.from);
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
            Logger.info("Looking up user by 'to' phone number", { to: participantResponse?.to });
            const user = await this.findUserByPhoneNumber(participantResponse?.to);
            if (user && user.status.toLowerCase() === "assigned") {
              Logger.info("User found and assigned", { user });
              this.ioServer.emit(`user-notification-${user.assigned_user}`, {
                conferenceSid: input.ConferenceSid,
                callSid: input.CallSid,
                from: participantResponse.from,
                to: To,
                leadData: existingLead,
              });
            } else {
              const ringGroup = await this.findRingGroupByPhoneNumber(participantResponse?.to);
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
            Logger.info("Conference ended", { conferenceSid: input.ConferenceSid });
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

  /**
   * Logs call status into the database and emits an outbound-call-status event.
   */
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
      Logger.info("Call status logged successfully", { callSid, callStatus });
      this.ioServer.emit("outbound-call-status", {
        callSid,
        status: callStatus,
        from,
        to,
      });
      return result.rows[0];
    } catch (error: any) {
      Logger.error("Error logging call status:", { error: error.message, stack: error.stack });
      throw new Error("Failed to insert call log into database");
    }
  }

  /**
   * Private helper: Finds a lead by phone number.
   */
  private async findLeadByPhoneNumber(phoneNumber: string) {
    const sqlQuery = `
      SELECT * FROM app.combined_leads
      WHERE cell_phone = $1
      LIMIT 1
    `;
    const result = await this.appDBClient.query(sqlQuery, [phoneNumber]);
    return result.rows[0] || null;
  }

  /**
   * Private helper: Finds a user by phone number.
   */
  public async findUserByPhoneNumber(phoneNumber: string) {
    try {
      const sqlQuery = `
        SELECT phone_number, status, assigned_user
        FROM public.did_numbers
        WHERE phone_number = $1
        LIMIT 1
      `;
      const result = await this.signalWireDBClient.query(sqlQuery, [phoneNumber]);
      if (result.rows.length === 0) {
        Logger.warn("No user found for phone number", { phoneNumber });
        return null;
      }
      return result.rows[0];
    } catch (error: any) {
      Logger.error("Error finding user by phone number:", { error: error.message });
      throw new Error("Failed to find user by phone number");
    }
  }

  /**
   * Private helper: Finds a ring group by phone number.
   */
  public async findRingGroupByPhoneNumber(phoneNumber: string) {
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
