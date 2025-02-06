import axios from "axios";
import qs from "qs";
import { Logger } from "../../../shared/logger";
import { RestClient } from "@signalwire/compatibility-api";
import { CallInstance } from "@signalwire/compatibility-api/lib/rest/api/v2010/account/call";

class ParticipantService {
  private readonly logger = Logger;
  private readonly SIGNALWIRE_PROJECT_ID = process.env.SIGNALWIRE_PROJECT_ID || "";
  private readonly SIGNALWIRE_AUTH_TOKEN = process.env.SIGNALWIRE_AUTH_TOKEN || "";
  private readonly SIGNALWIRE_API_URL = process.env.SIGNALWIRE_API_URL || "";
  private readonly authString = Buffer.from(
    `${this.SIGNALWIRE_PROJECT_ID}:${this.SIGNALWIRE_AUTH_TOKEN}`
  ).toString("base64");
  private readonly SIGNALWIRE_API_FULL_URL = `https://${this.SIGNALWIRE_API_URL}/api/laml/2010-04-01/Accounts/${this.SIGNALWIRE_PROJECT_ID}`;
  private readonly signalWireClient: any;

  constructor() {
    this.signalWireClient = RestClient(
      this.SIGNALWIRE_PROJECT_ID,
      this.SIGNALWIRE_AUTH_TOKEN,
      { signalwireSpaceUrl: process.env.SIGNALWIRE_API_URL }
    );
  }

  // ---------------------------------------------------------------------------
  // ADD PARTICIPANT TO CONFERENCE
  // ---------------------------------------------------------------------------
  async addParticipantToConference(callSid: string, lamlBinUrl: string): Promise<any> {
    try {
      this.logger.info("Adding participant with SignalWire", { callSid, lamlBinUrl });
      const response = await this.signalWireClient.calls(callSid).update({
        method: "POST",
        url: lamlBinUrl,
        record: "record-from-ringing",
        recordingStatusCallback: `${process.env.BASE_URL}/api/signalwire/webhook/recording-status-callback`,
        recordingStatusCallbackMethod: "POST",
      });
      this.logger.info("Participant added successfully", { callSid, lamlBinUrl });
      return {
        message: "Participant added successfully",
        callSid: response.sid,
        status: response.status,
      };
    } catch (error: any) {
      this.logger.error("Error adding participant:", { error: error.message, stack: error.stack });
      throw new Error("Failed to add participant");
    }
  }

  // ---------------------------------------------------------------------------
  // MUTE PARTICIPANT
  // ---------------------------------------------------------------------------
  async muteParticipant(conferenceSid: string, callSid: string): Promise<any> {
    try {
      this.logger.info("Muting participant", { conferenceSid, callSid });
      const response = await this.signalWireClient
        .conferences(conferenceSid)
        .participants(callSid)
        .update({ muted: true });
      if (response?.muted !== true) {
        throw new Error("Failed to mute participant");
      }
      this.logger.info("Participant muted successfully", { conferenceSid, callSid });
      return {
        message: "Participant muted successfully",
        conferenceSid,
        callSid,
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message;
      this.logger.error("Error muting participant:", { error: error.message, stack: error.stack });
      throw new Error(`Failed to mute participant: ${errorMessage}`);
    }
  }

  // ---------------------------------------------------------------------------
  // UNMUTE PARTICIPANT
  // ---------------------------------------------------------------------------
  async unmuteParticipant(conferenceSid: string, callSid: string): Promise<any> {
    try {
      this.logger.info("Unmuting participant", { conferenceSid, callSid });
      const response = await this.signalWireClient
        .conferences(conferenceSid)
        .participants(callSid)
        .update({ muted: false });
      if (response?.muted !== false) {
        throw new Error("Failed to unmute participant");
      }
      this.logger.info("Participant unmuted successfully", { conferenceSid, callSid });
      return {
        message: "Participant unmuted successfully",
        conferenceSid,
        callSid,
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message;
      this.logger.error("Error unmuting participant:", { error: error.message, stack: error.stack });
      throw new Error(`Failed to unmute participant: ${errorMessage}`);
    }
  }

  // ---------------------------------------------------------------------------
  // HOLD PARTICIPANT
  // ---------------------------------------------------------------------------
  async holdParticipant(conferenceSid: string, callSid: string): Promise<any> {
    try {
      this.logger.info("Holding participant", { conferenceSid, callSid });
      const response = await this.signalWireClient
        .conferences(conferenceSid)
        .participants(callSid)
        .update({ hold: true });
      if (response?.hold !== true) {
        throw new Error("Failed to hold participant");
      }
      this.logger.info("Participant held successfully", { conferenceSid, callSid });
      return {
        message: "Participant held successfully",
        conferenceSid,
        callSid,
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message;
      this.logger.error("Error holding participant:", { error: error.message, stack: error.stack });
      throw new Error(`Failed to hold participant: ${errorMessage}`);
    }
  }

  // ---------------------------------------------------------------------------
  // RESUME PARTICIPANT
  // ---------------------------------------------------------------------------
  async resumeParticipant(conferenceSid: string, callSid: string): Promise<any> {
    try {
      this.logger.info("Resuming participant", { conferenceSid, callSid });
      const response = await this.signalWireClient
        .conferences(conferenceSid)
        .participants(callSid)
        .update({ hold: false });
      if (response?.hold !== false) {
        throw new Error("Failed to resume participant");
      }
      this.logger.info("Participant resumed successfully", { conferenceSid, callSid });
      return {
        message: "Participant resumed successfully",
        conferenceSid,
        callSid,
      };
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error.message;
      this.logger.error("Error resuming participant:", { error: error.message, stack: error.stack });
      throw new Error(`Failed to resume participant: ${errorMessage}`);
    }
  }

  // ---------------------------------------------------------------------------
  // GET ALL PARTICIPANTS
  // ---------------------------------------------------------------------------
  async getAllParticipants(conferenceName: string) {
    try {
      Logger.info("Fetching participants for conference:", { conferenceName });
  
      // 1) Find the conference by friendly name
      const confList = await this.signalWireClient.conferences.list({
        friendlyName: conferenceName,
        limit: 1,
      });
  
      if (!confList || confList.length === 0) {
        throw new Error(`No conference found with name ${conferenceName}`);
      }
      const conferenceSid = confList[0].sid;
  
      // 2) Fetch participants using the actual conference SID
      const response = await axios.get(
        `${this.SIGNALWIRE_API_FULL_URL}/Conferences/${conferenceSid}/Participants`,
        {
          headers: { Accept: "application/json", Authorization: `Basic ${this.authString}` },
        }
      );
  
      if (!response.data || !response.data.participants) {
        throw new Error("No participants found");
      }
  
      Logger.info("Successfully fetched participants", { conferenceName });
      return { participants: response.data.participants };
    } catch (error: any) {
      Logger.error("Error fetching participants:", { error: error.message });
      throw new Error(`Failed to fetch participants: ${error.message}`);
    }
  }
  

  // ---------------------------------------------------------------------------
  // DELETE PARTICIPANT
  // ---------------------------------------------------------------------------
  async deleteParticipant(conferenceSid: string, callSid: string): Promise<any> {
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
      this.logger.info("Deleted participant successfully", { conferenceSid, callSid });
      return { message: "Participant deleted successfully" };
    } catch (error: any) {
      this.logger.error("Error deleting participant:", { error: error.message });
      throw new Error("Failed to delete participant");
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE PARTICIPANT
  // ---------------------------------------------------------------------------
  async updateParticipant(conferenceSid: string, callSid: string, data: any): Promise<any> {
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
      this.logger.info("Updated participant status successfully", { conferenceSid, callSid });
      return response.data;
    } catch (error: any) {
      this.logger.error("Error updating participant:", { error: error.message });
      throw new Error("Failed to update participant");
    }
  }
}

export default new ParticipantService();
