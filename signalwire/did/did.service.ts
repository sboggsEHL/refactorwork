import { Logger } from "../../shared/logger";
import { RestClient } from "@signalwire/compatibility-api";
import { Pool } from "pg";

// The DID service handles only the DID-specific operations.
export class DidService {
  private SIGNALWIRE_PROJECT_ID: string;
  private SIGNALWIRE_AUTH_TOKEN: string;
  private SIGNALWIRE_API_URL: string;
  private authString: string;
  private SIGNALWIRE_API_FULL_URL: string;
  private signalWireClient: any;
  private signalWireDBClient: Pool;

  constructor() {
    this.SIGNALWIRE_PROJECT_ID = process.env.SIGNALWIRE_PROJECT_ID || "";
    this.SIGNALWIRE_AUTH_TOKEN = process.env.SIGNALWIRE_AUTH_TOKEN || "";
    this.SIGNALWIRE_API_URL = process.env.SIGNALWIRE_API_URL || "";

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

    this.authString = Buffer.from(
      `${this.SIGNALWIRE_PROJECT_ID}:${this.SIGNALWIRE_AUTH_TOKEN}`
    ).toString("base64");

    this.SIGNALWIRE_API_FULL_URL = `https://${this.SIGNALWIRE_API_URL}/api/laml/2010-04-01/Accounts/${this.SIGNALWIRE_PROJECT_ID}`;

    // Initialize the SignalWire compatibility client
    this.signalWireClient = RestClient(
      this.SIGNALWIRE_PROJECT_ID,
      this.SIGNALWIRE_AUTH_TOKEN,
      { signalwireSpaceUrl: process.env.SIGNALWIRE_API_URL }
    );

    // Use the SignalWire pool for DID-related database operations.
    if (!global.signalWirePool) {
      throw new Error("SignalWire pool not initialized.");
    }
    this.signalWireDBClient = global.signalWirePool;
  }

  /**
   * Retrieves the DID numbers assigned to the specified user.
   */
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

  /**
   * Purchases new phone numbers (DIDs) for the given area code and quantity.
   */
  public async buyNumbers(areaCode: string, quantity: number = 1): Promise<void> {
    try {
      Logger.info("Attempting to purchase phone numbers", {
        areaCode,
        quantity,
      });

      const areaCodeAsNumber = parseInt(areaCode, 10);
      if (isNaN(areaCodeAsNumber)) {
        throw new Error(
          `Invalid areaCode: must be numeric. Got "${areaCode}"`
        );
      }

      // Search for available phone numbers via SignalWire.
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

      // Purchase each number and insert into the did_numbers table.
      for (const candidate of availableNumbers) {
        const purchased = await this.signalWireClient.incomingPhoneNumbers.create({
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

  /**
   * Assigns a free DID to a user by selecting the first available free DID,
   * marking it as assigned, and configuring the number in SignalWire.
   */
  public async assignDidToUser(username: string): Promise<string> {
    try {
      // 1. Grab the first 'Free' DID.
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

      // 2. Update the record to mark the DID as 'Assigned' for the user.
      const updateSQL = `
        UPDATE public.did_numbers
        SET status = 'Assigned',
            assigned_user = $1
        WHERE phone_number = $2
      `;
      await this.signalWireDBClient.query(updateSQL, [username, phoneNumber]);

      // 3. Optionally configure the number in SignalWire.
      await this.configureNumber(phoneNumber);

      return phoneNumber;
    } catch (error: any) {
      Logger.error("Error assigning DID to user", { error: error.message });
      throw new Error(error.message);
    }
  }

  /**
   * Private helper to configure a purchased DID in SignalWire.
   */
  private async configureNumber(phoneNumber: string): Promise<void> {
    try {
      // Endpoints for voice and SMS handling.
      const voiceUrl =
        "https://elevatedhl.signalwire.com/laml-bins/55dd7d20-df8e-47fe-b436-a5b7da533f75";
      const statusCallback =
        "https://elecrm-serverside-kvg9r.ondigitaloceanspaces.app/api/signalwire/webhook/voice-status-callback";
      const smsUrl =
        "https://elecrm-serverside-kvg9r.ondigitaloceanspaces.app/api/signalwire/sms/inbound";

      // Look up the number in the SignalWire account.
      const incomingNumbers = await this.signalWireClient.incomingPhoneNumbers.list({
        phoneNumber,
        limit: 1,
      });

      if (!incomingNumbers || incomingNumbers.length === 0) {
        throw new Error(`Incoming phone number ${phoneNumber} not found`);
      }

      const numberInfo = incomingNumbers[0];

      // Update the phone number configuration.
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
}
