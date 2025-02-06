//Server Side\src\signalwire\conference\conference.service.ts
import axios from "axios";
import { RestClient } from "@signalwire/compatibility-api";
import { Logger } from "../../shared/logger";
import { CallInstance } from "@signalwire/compatibility-api/lib/rest/api/v2010/account/call";

class ConferenceService {
  private SIGNALWIRE_PROJECT_ID = process.env.SIGNALWIRE_PROJECT_ID || "";
  private SIGNALWIRE_AUTH_TOKEN = process.env.SIGNALWIRE_AUTH_TOKEN || "";
  private SIGNALWIRE_API_URL = process.env.SIGNALWIRE_API_URL || "";
  private authString = Buffer.from(
    `${this.SIGNALWIRE_PROJECT_ID}:${this.SIGNALWIRE_AUTH_TOKEN}`
  ).toString("base64");
  private SIGNALWIRE_API_FULL_URL = `https://${this.SIGNALWIRE_API_URL}/api/laml/2010-04-01/Accounts/${this.SIGNALWIRE_PROJECT_ID}`;
  private signalWireClient: any;

  constructor(ioServer: any) {
    // The ioServer parameter is preserved for consistency (if logging or events are needed)
    this.signalWireClient = RestClient(
      this.SIGNALWIRE_PROJECT_ID,
      this.SIGNALWIRE_AUTH_TOKEN,
      {
        signalwireSpaceUrl: process.env.SIGNALWIRE_API_URL,
      }
    );
  }

  // ---------------------------------------------------------------------------
  // CREATE OR FETCH CONFERENCE ROOM
  // ---------------------------------------------------------------------------
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

        const conference = await this.getActiveConference(formattedConferenceName);

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

      // LAML content enabling per‑leg recording
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
      const conference = await this.getActiveConference(formattedConferenceName);

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
        throw new Error("Failed to fetch/create conference due to an unknown error");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DISCONNECT CONFERENCE
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // LIST ALL CONFERENCES
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // RETRIEVE A SPECIFIC CONFERENCE
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // GET ACTIVE CONFERENCE
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // SEND CONFERENCE DTMF TONE
  // ---------------------------------------------------------------------------
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
}

export default new ConferenceService(null);
