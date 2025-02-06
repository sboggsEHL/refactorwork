import { Request, Response } from "express";
import { SignalWireService } from "./signalwire.service";
import { incomingCallNotificationRequest } from "./signalwire.model";
import { Logger } from "../shared/logger";

export class SignalWireController {
  private signalWireService: SignalWireService;
  private ioServer: any;

  constructor(ioServer: any) {
    this.ioServer = ioServer; // Ensure ioServer is correctly assigned
    this.signalWireService = new SignalWireService(ioServer);
  }

  // =====================================
  //  Get Team Status 
  // =====================================
  /**
   * GET /team-status
   * Returns an array of users with first_name, last_name, sw_phone_number, and master_status.
   */
  public async getTeamStatus(req: Request, res: Response): Promise<void> {
    try {
      const data = await this.signalWireService.getTeamStatus();
      res.status(200).json(data);
    } catch (error: any) {
      Logger.error("Controller error in getTeamStatus", { error: error.message });
      res.status(500).json({ error: "Failed to fetch team status" });
    }
  }

  // =====================================
  //  INCOMING CALL NOTIFICATION
  // =====================================
  /**
   * POST /webhook/incoming-call (and its variants)
   * Processes incoming call notifications from SignalWire.
   */
  public async incomingCallNotification(req: Request, res: Response): Promise<void> {
    const {
      CallSid,
      From,
      To,
      Timestamp,
      CallStatus,
      HangupDirection,
      HangupBy,
      AccountSid,
      Direction,
      StatusCallbackEvent,
      ConferenceSid,
      Muted,
      Hold,
      EndConferenceOnExit,
      StartConferenceOnEnter,
      Coaching,
      CallSidToCoach,
    } = req.body as incomingCallNotificationRequest;

    Logger.info("Incoming Call Notification", {
      requestBody: JSON.stringify(req.body),
      requestParams: JSON.stringify(req.query),
    });

    try {
      const result = await this.signalWireService.incomingCallNotification({
        CallSid,
        From,
        To,
        Timestamp,
        CallStatus,
        HangupDirection,
        HangupBy,
        AccountSid,
        Direction,
        StatusCallbackEvent,
        ConferenceSid,
        Muted,
        Hold,
        EndConferenceOnExit,
        StartConferenceOnEnter,
        Coaching,
        CallSidToCoach,
      });
      Logger.info("Sending /webhook/incomingCall response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error while processing signalwire webhook:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to process incoming webhook from signalwire" });
    }
  }
}
