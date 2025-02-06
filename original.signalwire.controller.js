//signalwire.controller.ts

import { Request, Response } from "express";
import { SignalWireService } from "./signalwire.service";

import {
  addParticipantRequest,
  incomingCallNotificationRequest,
} from "./signalwire.model";
import { Logger } from "../shared/logger";

export class SignalWireController {
  private signalWireService: SignalWireService;
  private ioServer: any;

  constructor(ioServer: any) {
    this.ioServer = ioServer; // Ensure ioServer is correctly assigned
    this.signalWireService = new SignalWireService(ioServer);
  }

  // =====================================
  //  GET CALL LOGS LIST
  // =====================================
  /**
   * GET /api/signalwire/call-logs
   * 
   * Retrieves a paginated list of call logs with minimal details.
   * This endpoint is optimized for displaying call logs in a list view.
   * 
   * Query Parameters:
   * - page (optional): Page number to retrieve (default: 1)
   * - pageSize (optional): Number of records per page (default: 50)
   * 
   * Response:
   * {
   *   logs: [{
   *     id: number,
   *     call_sid: string,
   *     from_number: string,
   *     to_number: string,
   *     start_time: string,
   *     direction: string
   *   }],
   *   pagination: {
   *     currentPage: number,
   *     pageSize: number,
   *     totalPages: number,
   *     totalCount: number
   *   }
   * }
   * 
   * @param req Express Request object with optional page and pageSize query parameters
   * @param res Express Response object
   */
  public async getCallLogsList(req: Request, res: Response) {
    try {
      const result = await this.signalWireService.getCallLogsList();
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Controller error in getCallLogsList", { error: error.message });
      res.status(500).json({ error: "Failed to fetch call logs list" });
    }
  }

  // =====================================
  //  GET CALL LOG DETAILS
  // =====================================
  /**
   * GET /api/signalwire/call-logs/:id
   * 
   * Retrieves detailed information about a specific call log.
   * Includes user information if the call was associated with a user.
   * 
   * URL Parameters:
   * - id: The ID of the call log to retrieve
   * 
   * Response:
   * {
   *   id: number,
   *   call_sid: string,
   *   from_number: string,
   *   to_number: string,
   *   direction: string,
   *   start_time: string,
   *   end_time: string,
   *   duration: number,
   *   recording_url?: string,
   *   assigned_user?: string,
   *   user?: {
   *     username: string,
   *     firstName: string,
   *     lastName: string
   *   }
   * }
   * 
   * Error Responses:
   * - 400: Invalid call log ID
   * - 404: Call log not found
   * - 500: Server error
   * 
   * @param req Express Request object with id parameter
   * @param res Express Response object
   */
  public async getCallLogDetails(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid call log ID" });
      }

      const result = await this.signalWireService.getCallLogDetails(id);
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Controller error in getCallLogDetails", { error: error.message });
      if (error.message === "Call log not found") {
        res.status(404).json({ error: "Call log not found" });
      } else {
        res.status(500).json({ error: "Failed to fetch call log details" });
      }
    }
  }

  public async recordingStatusCallback(
    req: Request,
    res: Response
  ): Promise<void> {
    Logger.info("Controller: recordingStatusCallback triggered");

    try {
      // Delegate the entire process (including DB update and res.status(...)) to the service
      await this.signalWireService.recordingStatusCallback(req, res);
    } catch (error: any) {
      Logger.error("Controller error in recordingStatusCallback", { error });
      res.status(500).send("Failed to process recording status callback");
    }
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
  //  SAVE VOICEMAILS
  // =====================================
  public async saveVoicemail(req: Request, res: Response): Promise<void> {
    try {
      const fileUrl = await this.signalWireService.saveVoicemail(req.body);
      res.status(200).json({
        message: "Voicemail saved",
        fileUrl,
      });
      return;
    } catch (error: any) {
      Logger.error("Error saving voicemail", { error });
      res.status(500).json({ error: "Failed to save voicemail" });
      return;
    }
  }

  // =====================================
  //  BUY NUMBERS
  // =====================================
  public async buyNumbers(req: Request, res: Response) {
    try {
      const { areaCode, quantity } = req.body;
      Logger.info("Controller: buyNumbers called", { areaCode, quantity });

      await this.signalWireService.buyNumbers(areaCode, Number(quantity) || 1);

      return res.status(200).json({
        message: "Numbers purchased successfully",
        areaCode,
        quantity,
      });
    } catch (error: any) {
      Logger.error("Error in buyNumbers", { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  }

  // =====================================
  // Upload VoiceMail Greetings - Connects To DO Space with AWS Package
  // =====================================
  public async uploadVoicemailGreeting(req: Request, res: Response) {
    try {
      // 1) Make sure we got a file from Multer
      // Casting so TypeScript knows 'file' exists on req
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "No file provided." });
      }

      // 2) Pull voicemailType from body
      const voicemailType = req.body.voicemailType;
      if (!voicemailType) {
        return res
          .status(400)
          .json({ success: false, message: "voicemailType is required." });
      }

      // 3) Suppose you have the username from session or JWT
      // For now, we can hardcode or mock it
      const username = req.body.username || "DefaultUser";
      // TODO:
      // I CHANGE THIS TO BE REQ.BODY INSTEAD OF REQ.SESSION WE CAN CHANGE IT BACK WHEN READY OF IF NEEDED.

      // 4) Call the service method
      const fileUrl = await this.signalWireService.uploadVoicemailGreeting(
        file.buffer,
        username,
        voicemailType,
        file.mimetype || "audio/mpeg"
      );

      return res.status(200).json({
        success: true,
        message: "Voicemail uploaded successfully",
        fileUrl,
      });
    } catch (error: any) {
      Logger.error("Error uploading voicemail greeting via controller", {
        error,
      });
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to upload voicemail",
      });
    }
  }

  // =======================================
  // Attended and Unattended Transfer
  // =======================================
  /**
   * BLIND TRANSFER
   * POST /call/transfer/blind
   * Body: { callSid: string, redirectUrl: string }
   */
  public async blindTransfer(req: Request, res: Response): Promise<any> {
    try {
      const { callSid, redirectUrl } = req.body;
      if (!callSid || !redirectUrl) {
        return res
          .status(400)
          .json({ error: "callSid and redirectUrl are required" });
      }

      const result = await this.signalWireService.blindTransfer(
        callSid,
        redirectUrl
      );
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Controller error in blindTransfer", { error });
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * HANGUP CALL
   * POST /call/transfer/hangup
   * Body: { callSid: string }
   */
  public async hangupCall(req: Request, res: Response): Promise<any> {
    try {
      const { callSid } = req.body;
      if (!callSid) {
        return res.status(400).json({ error: "callSid is required" });
      }

      const result = await this.signalWireService.hangupCall(callSid);
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Controller error in hangupCall", { error });
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * ATTENDED (WARM) TRANSFER
   * This is usually multiple steps.
   * For brevity, here's a single endpoint that "chains" them, but in production
   * you'd likely do these steps in separate endpoints or in sequence from the client.
   *
   * POST /call/transfer/attended
   * Body: {
   *   conferenceSid: string,
   *   originalCallSid: string,
   *   consultFrom: string,
   *   consultTo: string,
   *   consultUrl: string
   * }
   */
  public async attendedTransfer(req: Request, res: Response): Promise<any> {
    try {
      const {
        conferenceSid,
        originalCallSid,
        consultFrom,
        consultTo,
        consultUrl,
      } = req.body;

      // Validate
      if (
        !conferenceSid ||
        !originalCallSid ||
        !consultFrom ||
        !consultTo ||
        !consultUrl
      ) {
        return res.status(400).json({
          error:
            "conferenceSid, originalCallSid, consultFrom, consultTo, consultUrl are required",
        });
      }

      // 1) Hold the original participant
      await this.signalWireService.holdOriginalParticipant(
        conferenceSid,
        originalCallSid
      );

      // 2) Dial out the new 'consult' call
      const consultCall = await this.signalWireService.createConsultationCall(
        consultFrom,
        consultTo,
        consultUrl
      );

      // 3) Once that call is answered, add it to the conference
      //    For example, we can re-use the same LAML bin or a newly created one
      const LAML_BIN_URL_FOR_CONFERENCE = "https://your-laml-bin.com/whatever"; // adapt as needed
      await this.signalWireService.addConsultationCallToConference(
        conferenceSid,
        consultCall.consultCallSid,
        LAML_BIN_URL_FOR_CONFERENCE
      );

      // 4) Unhold the original participant
      await this.signalWireService.unholdOriginalParticipant(
        conferenceSid,
        originalCallSid
      );

      // 5) If your user wants to drop out themselves:
      //    await this.signalWireService.removeSelfFromConference(conferenceSid, myCallSid);

      res.status(200).json({
        message:
          "Attended transfer complete (original unheld, consult call bridged)",
      });
    } catch (error: any) {
      Logger.error("Controller error in attendedTransfer", { error });
      res.status(500).json({ error: error.message });
    }
  }

  // =====================================
  //  ASSIGN NUMBER TO USER
  // =====================================
  public async assignNumber(req: Request, res: Response) {
    try {
      const { username } = req.body;
      Logger.info("Controller: assignNumber called", { username });

      const assignedDid = await this.signalWireService.assignDidToUser(username);

      return res.status(200).json({
        message: `Assigned DID ${assignedDid} to user ${username}`,
        phoneNumber: assignedDid,
      });
    } catch (error: any) {
      Logger.error("Error in assignNumber", { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  }

  public async dial(req: Request, res: Response) {
    const { from, to, url } = req.body;

    Logger.info("Received /dial request", { from, to, url });

    if (!from || !to || !url) {
      Logger.warn("Missing required fields in /dial request", {
        from,
        to,
        url,
      });
      return res
        .status(400)
        .json({ error: "Missing required fields: from, to, url" });
    }

    try {
      const result = await this.signalWireService.dial(from, to, url);
      Logger.info("Sending /dial response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error initiating call:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to initiate call" });
    }
  }

  public async hold(req: Request, res: Response) {
    const { callId } = req.query;

    Logger.info("Received /hold request", { callId });

    if (!callId) {
      Logger.warn("Missing required fields in /hold request", { callId });
      return res.status(400).json({ error: "Missing required fields: callId" });
    }

    try {
      const result = await this.signalWireService.hold(String(callId));
      Logger.info("Sending /hold response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error holding call:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to hold call" });
    }
  }

  public async resume(req: Request, res: Response) {
    const { callId } = req.query;

    Logger.info("Received /resume request", { callId });

    if (!callId) {
      Logger.warn("Missing required fields in /resume request", { callId });
      return res.status(400).json({ error: "Missing required fields: callId" });
    }

    try {
      const result = await this.signalWireService.resume(String(callId));
      Logger.info("Sending /resume response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error resuming call:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to resume call" });
    }
  }

  public async hangup(req: Request, res: Response) {
    const { conferenceSid } = req.query;

    Logger.info("Received /hangup request", { conferenceSid });

    if (!conferenceSid) {
      Logger.warn("Missing required fields in /hangup request", {
        conferenceSid,
      });
      return res
        .status(400)
        .json({ error: "Missing required fields: conferenceSid" });
    }

    try {
      const result = await this.signalWireService.hangup(String(conferenceSid));
      Logger.info("Sending /hangup response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error hanging up call:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to hang up call" });
    }
  }

  public async getOrCreateConferenceRoom(req: Request, res: Response) {
    const { conferenceName } = req.body;

    Logger.info("Received /conference/connect request", { conferenceName });

    if (!conferenceName) {
      return res.status(400).json({ error: "Conference name is required" });
    }

    try {
      const result = await this.signalWireService.createOrFetchConferenceRoom(
        conferenceName
      );
      Logger.info("Sending /conference/connect response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error connecting to conference:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to connect to conference" });
    }
  }

  public async disconnectConference(req: Request, res: Response) {
    const { conferenceName } = req.body;

    Logger.info("Received /conference/disconnect request", { conferenceName });

    if (!conferenceName) {
      return res.status(400).json({ error: "Conference name is required" });
    }

    try {
      const result = await this.signalWireService.disconnectConference(
        conferenceName
      );
      Logger.info("Sending /conference/disconnect response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error disconnecting conference:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to disconnect conference" });
    }
  }

  public async muteParticipant(req: Request, res: Response) {
    const { conferenceName, callSid } = req.body;

    Logger.info("Received /conference/participant/mute request", {
      conferenceName,
      callSid,
    });

    if (!conferenceName || !callSid) {
      return res
        .status(400)
        .json({ error: "Conference name and Participant SID are required" });
    }

    try {
      const result = await this.signalWireService.muteParticipant(
        conferenceName,
        callSid
      );
      Logger.info("Sending /conference/participant/mute response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error muting participant:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to mute participant" });
    }
  }

  public async unmuteParticipant(req: Request, res: Response) {
    const { conferenceSid, callSid } = req.body;

    Logger.info("Received /conference/participant/unmute request", {
      conferenceSid,
      callSid,
    });

    if (!conferenceSid || !callSid) {
      return res
        .status(400)
        .json({ error: "Conference SID and Participant SID are required" });
    }

    try {
      const result = await this.signalWireService.unmuteParticipant(
        conferenceSid,
        callSid
      );
      Logger.info("Sending /conference/participant/unmute response", {
        result,
      });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error unmuting participant:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to unmute participant" });
    }
  }

  public async holdParticipant(req: Request, res: Response) {
    const { conferenceName, callSid } = req.body;

    Logger.info("Received /conference/participant/hold request", {
      conferenceName,
      callSid,
    });

    if (!conferenceName || !callSid) {
      return res
        .status(400)
        .json({ error: "Conference name and Participant SID are required" });
    }

    try {
      const result = await this.signalWireService.holdParticipant(
        conferenceName,
        callSid
      );
      Logger.info("Sending /conference/participant/hold response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error holding participant:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to hold participant" });
    }
  }

  public async resumeParticipant(req: Request, res: Response) {
    const { conferenceSid, callSid } = req.body;

    Logger.info("Received /conference/participant/resume request", {
      conferenceSid,
      callSid,
    });

    if (!conferenceSid || !callSid) {
      return res
        .status(400)
        .json({ error: "Conference SID and Participant SID are required" });
    }

    try {
      const result = await this.signalWireService.resumeParticipant(
        conferenceSid,
        callSid
      );
      Logger.info("Sending /conference/participant/resume response", {
        result,
      });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error resuming participant:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to resume participant" });
    }
  }

  public async listAllCalls(req: Request, res: Response) {
    Logger.info("Received /call/list request");

    try {
      const result = await this.signalWireService.listAllCalls();
      Logger.info("Sending /call/list response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error listing all calls:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to list all calls" });
    }
  }

  public async listAllConferences(req: Request, res: Response) {
    Logger.info("Received /conference/list request");

    try {
      const result = await this.signalWireService.listAllConferences();
      Logger.info("Sending /conference/list response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error listing all conferences:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to list all conferences" });
    }
  }

  public async retrieveConference(req: Request, res: Response) {
    const { conferenceSid } = req.query;

    Logger.info("Received /conference/retrieve request", { conferenceSid });

    if (!conferenceSid) {
      return res.status(400).json({ error: "Conference SID is required" });
    }

    try {
      const result = await this.signalWireService.retrieveConference(
        String(conferenceSid)
      );
      Logger.info("Sending /conference/retrieve response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error retrieving conference:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to retrieve conference" });
    }
  }

  public async deleteParticipant(req: Request, res: Response) {
    const { conferenceSid, callSid } = req.body;

    Logger.info("Received /conference/participant/delete request", {
      conferenceSid,
      callSid,
    });

    if (!conferenceSid || !callSid) {
      return res
        .status(400)
        .json({ error: "Conference SID and Participant SID are required" });
    }

    try {
      const result = await this.signalWireService.deleteParticipant(
        conferenceSid,
        callSid
      );
      Logger.info("Sending /conference/participant/delete response", {
        result,
      });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error deleting participant:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to delete participant" });
    }
  }

  public async updateCall(req: Request, res: Response) {
    const { callSid, status, url } = req.body;

    Logger.info("Received /call/update request", { callSid, status, url });

    if (!callSid || !status) {
      return res
        .status(400)
        .json({ error: "Call SID and status are required" });
    }

    try {
      const result = await this.signalWireService.updateCall(
        callSid,
        status,
        url
      );
      Logger.info("Sending /call/update response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error updating call:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to update call" });
    }
  }

  public async updateParticipant(req: Request, res: Response) {
    const { conferenceSid, callSid, data } = req.body;

    Logger.info("Received /conference/participant/update request", {
      conferenceSid,
      callSid,
      data,
    });

    if (!conferenceSid || !callSid || !data) {
      return res.status(400).json({
        error: "Conference SID, Participant SID, and data are required",
      });
    }

    try {
      const result = await this.signalWireService.updateParticipant(
        conferenceSid,
        callSid,
        data
      );
      Logger.info("Sending /conference/participant/update response", {
        result,
      });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error updating participant:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to update participant" });
    }
  }

  public async getAllParticipants(req: Request, res: Response) {
    const { conferenceName } = req.query;

    Logger.info("Received /conference/participant/getAll request", {
      conferenceName,
    });

    if (!conferenceName) {
      return res.status(400).json({ error: "Conference name is required" });
    }

    try {
      const result = await this.signalWireService.getAllParticipants(
        String(conferenceName)
      );
      Logger.info("Sending /conference/participant/getAll response", {
        result,
      });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error fetching participants:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to fetch participants" });
    }
  }

  public async getActiveConference(req: Request, res: Response) {
    const { conferenceName } = req.body;

    Logger.info("Received /conference/active request", { conferenceName });

    if (!conferenceName) {
      return res.status(400).json({ error: "conferenceName is required" });
    }

    try {
      const result = await this.signalWireService.getActiveConference(
        String(conferenceName)
      );
      Logger.info("Sending /conference/active response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error fetching active conference:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to fetch active conference" });
    }
  }

  public async incomingCallNotification(req: Request, res: Response) {
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
      // Call the service function and pass the entire body
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
        StatusCallbackEvent, // Pass event type to service
        ConferenceSid, // Pass conference ID
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
      res
        .status(500)
        .json({ error: "Failed to process incoming webhook from signalwire" });
    }
  }

  public async addParticipant(req: Request, res: Response) {
    try {
      const { callSid, lamlBinUrl } = req.body;

      if (!callSid || !lamlBinUrl) {
        return res
          .status(400)
          .json({ error: "from, to, lamlBinUrl are required" });
      }

      const result = await this.signalWireService.addParticipantToConference(
        callSid,
        lamlBinUrl
      );

      res.status(200).json(result);
      Logger.info("Sending /conference/participant/add response");
    } catch (error: any) {
      Logger.error("Error adding participant:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to add participant" });
    }
  }

  public async callStatusUpdate(req: Request, res: Response) {
    Logger.info("Received call status update", {
      requestBody: req.body,
    });

    try {
      const result = await this.signalWireService.callStatusUpdate(req.body);
      res
        .status(200)
        .json({ message: "Call status processed successfully", result });
    } catch (error: any) {
      Logger.error("Error processing call status update:", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({ error: "Failed to process call status update" });
    }
  }

  public async sendConferenceDtmf(req: Request, res: Response) {
    const { callSid, dtmfTones, lamlBinUrl } = req.body;
    try {
      const results = await this.signalWireService.sendConferenceDtmfTone(
        callSid,
        dtmfTones,
        lamlBinUrl
      );
      res.status(200).json({
        message: "DTMF tones sent successfully to conference participants",
        results,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "An unforeseen error occurred",
      });
    }
  }

  public async voiceStatusCallback(req: Request, res: Response): Promise<void> {
    const { CallSid, CallStatus, From, To, Direction, CallDuration, recordingUrl } = req.body;

    Logger.info("Received voice status callback", {
      CallSid,
      CallStatus,
      From,
      To,
      Direction,
      CallDuration,
      recordingUrl,
    });

    try {
      // Step 1: Log or update the DB record
      await this.signalWireService.logCallStatus(
        CallSid,
        CallStatus,
        Direction,
        From,
        To,
        CallDuration ? parseInt(CallDuration, 10) : undefined,
        recordingUrl
      );

      // Step 2: If CallStatus is an ended state, emit a Socket.IO event
      const endedStatuses = [
        "completed",
        "canceled",
        "busy",
        "failed",
        "no-answer",
      ];
      if (endedStatuses.includes(CallStatus.toLowerCase())) {
        Logger.info("Emitting call-ended event", { CallSid, CallStatus });
        // Assuming you have access to `this.ioServer` in your controller
        this.ioServer.emit("call-ended", {
          callSid: CallSid,
          status: CallStatus,
        });
      }

      // Finally respond to SignalWire
      res.status(200).send("Status callback processed successfully");
    } catch (error: any) {
      Logger.error("Error processing voice status callback", { error });
      res.status(500).send("Failed to process status callback");
    }
  }

  public async getDidNumbersByUser(req: Request, res: Response) {
    try {
      const { username } = req.query;
      if (typeof username !== "string") {
        return res.status(400).json({ error: "Invalid username" });
      }
      const result = await this.signalWireService.getDidNumbersByUser(username);
      res.status(200).json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch DID numbers" });
    }
  }
}
