// Server Side/src/signalwire/conference/conference.controller.ts
import { Request, Response, NextFunction } from "express";
import { Logger } from "../../shared/logger";
import conferenceService from "./conference.service";

export class ConferenceController {
  private conferenceService = conferenceService;
  private ioServer: any;

  constructor(ioServer: any) {
    this.ioServer = ioServer;
    // You can pass ioServer to the service as needed.
  }

  public async getOrCreateConferenceRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { conferenceName } = req.body;
    Logger.info("Received /conference/connect request", { conferenceName });
    if (!conferenceName) {
      res.status(400).json({ error: "Conference name is required" });
      return;
    }
    try {
      const result = await this.conferenceService.createOrFetchConferenceRoom(conferenceName);
      Logger.info("Sending /conference/connect response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error connecting to conference:", { error: error.message, stack: error.stack });
      next(error);
    }
  }

  // (Other controller methods similarly include the third parameter: next)
  public async disconnectConference(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { conferenceName } = req.body;
    Logger.info("Received /conference/disconnect request", { conferenceName });
    if (!conferenceName) {
      res.status(400).json({ error: "Conference name is required" });
      return;
    }
    try {
      const result = await this.conferenceService.disconnectConference(conferenceName);
      Logger.info("Sending /conference/disconnect response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error disconnecting conference:", { error: error.message, stack: error.stack });
      next(error);
    }
  }
  /**
   * GET /conference/list
   * Lists all conferences.
   */
  public async listAllConferences(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    Logger.info("Received /conference/list request");
    try {
      const result = await this.conferenceService.listAllConferences();
      Logger.info("Sending /conference/list response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error listing all conferences:", {
        error: error.message,
        stack: error.stack,
      });
      next(error);
    }
  }

  /**
   * GET /conference/retrieve
   * Retrieves a specific conference by its SID.
   */
  public async retrieveConference(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const { conferenceSid } = req.query;
    Logger.info("Received /conference/retrieve request", { conferenceSid });
    if (!conferenceSid) {
      res.status(400).json({ error: "Conference SID is required" });
      return;
    }
    try {
      const result = await this.conferenceService.retrieveConference(
        String(conferenceSid)
      );
      Logger.info("Sending /conference/retrieve response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error retrieving conference:", {
        error: error.message,
        stack: error.stack,
      });
      next(error);
    }
  }

  /**
   * POST /conference/active
   * Gets the active conference by name.
   */
  public async getActiveConference(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const { conferenceName } = req.body;
    Logger.info("Received /conference/active request", { conferenceName });
    if (!conferenceName) {
      res.status(400).json({ error: "conferenceName is required" });
      return;
    }
    try {
      const result = await this.conferenceService.getActiveConference(
        String(conferenceName)
      );
      Logger.info("Sending /conference/active response", { result });
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error fetching active conference:", {
        error: error.message,
        stack: error.stack,
      });
      next(error);
    }
  }

  /**
   * POST /conference/dtmf
   * Sends DTMF tones to a conference.
   */
  public async sendConferenceDtmf(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const { callSid, dtmfTones, lamlBinUrl } = req.body;
    try {
      const results = await this.conferenceService.sendConferenceDtmfTone(
        callSid,
        dtmfTones,
        lamlBinUrl
      );
      res.status(200).json({
        message:
          "DTMF tones sent successfully to conference participants",
        results,
      });
    } catch (error: any) {
      Logger.error("Error sending DTMF tones", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(error);
    }
  }
}

export default new ConferenceController((global as any).ioServer);
