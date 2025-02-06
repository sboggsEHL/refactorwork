//Server Side\src\signalwire\call\call.controller.ts
import { Request, Response } from "express";
import { CallService } from "./call.service";
import { Logger } from "../../shared/logger";

export class CallController {
  private callService: CallService;
  private ioServer: any;

  constructor(ioServer: any) {
    this.ioServer = ioServer;
    this.callService = new CallService(ioServer);
  }

  // ---------- Call Logs Routes ----------

  /**
   * GET /call-logs
   * Retrieves a paginated list of call logs.
   */
  public async getCallLogsList(req: Request, res: Response) {
    try {
      const result = await this.callService.getCallLogsList();
      return res.status(200).json(result);
    } catch (error: any) {
      Logger.error("CallController error in getCallLogsList", { error: error.message });
      return res.status(500).json({ error: "Failed to fetch call logs list" });
    }
  }

  /**
   * GET /call-logs/:id
   * Retrieves detailed information about a specific call log.
   */
  public async getCallLogDetails(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid call log ID" });
      }
      const result = await this.callService.getCallLogDetails(id);
      return res.status(200).json(result);
    } catch (error: any) {
      Logger.error("CallController error in getCallLogDetails", { error: error.message });
      if (error.message === "Call log not found") {
        return res.status(404).json({ error: "Call log not found" });
      } else {
        return res.status(500).json({ error: "Failed to fetch call log details" });
      }
    }
  }

  // ---------- Call Routes ----------

  /**
   * POST /call/dial
   * Initiates a call.
   */
  public async dial(req: Request, res: Response) {
    const { from, to, url } = req.body;
    Logger.info("CallController: Received /call/dial request", { from, to, url });
    if (!from || !to || !url) {
      return res.status(400).json({ error: "Missing required fields: from, to, url" });
    }
    try {
      const result = await this.callService.dial(from, to, url);
      Logger.info("CallController: /call/dial response", { result });
      return res.status(200).json(result);
    } catch (error: any) {
      Logger.error("CallController error in dial", { error: error.message, stack: error.stack });
      return res.status(500).json({ error: "Failed to initiate call" });
    }
  }

  /**
   * POST /call/hold
   * Places an active call on hold.
   */
  public async hold(req: Request, res: Response) {
    const { callId } = req.query;
    Logger.info("CallController: Received /call/hold request", { callId });
    if (!callId) {
      return res.status(400).json({ error: "Missing required field: callId" });
    }
    try {
      const result = await this.callService.hold(String(callId));
      Logger.info("CallController: /call/hold response", { result });
      return res.status(200).json(result);
    } catch (error: any) {
      Logger.error("CallController error in hold", { error: error.message, stack: error.stack });
      return res.status(500).json({ error: "Failed to hold call" });
    }
  }

  /**
   * POST /call/resume
   * Resumes a call that was on hold.
   */
  public async resume(req: Request, res: Response) {
    const { callId } = req.query;
    Logger.info("CallController: Received /call/resume request", { callId });
    if (!callId) {
      return res.status(400).json({ error: "Missing required field: callId" });
    }
    try {
      const result = await this.callService.resume(String(callId));
      Logger.info("CallController: /call/resume response", { result });
      return res.status(200).json(result);
    } catch (error: any) {
      Logger.error("CallController error in resume", { error: error.message, stack: error.stack });
      return res.status(500).json({ error: "Failed to resume call" });
    }
  }

  /**
   * DELETE /call/hangup
   * Ends a call.
   */
  public async hangup(req: Request, res: Response) {
    const { conferenceSid } = req.query;
    Logger.info("CallController: Received /call/hangup request", { conferenceSid });
    if (!conferenceSid) {
      return res.status(400).json({ error: "Missing required field: conferenceSid" });
    }
    try {
      const result = await this.callService.hangup(String(conferenceSid));
      Logger.info("CallController: /call/hangup response", { result });
      return res.status(200).json(result);
    } catch (error: any) {
      Logger.error("CallController error in hangup", { error: error.message, stack: error.stack });
      return res.status(500).json({ error: "Failed to hang up call" });
    }
  }

  /**
   * GET /call/list
   * Lists all calls.
   */
  public async listAllCalls(req: Request, res: Response) {
    Logger.info("CallController: Received /call/list request");
    try {
      const result = await this.callService.listAllCalls();
      Logger.info("CallController: /call/list response", { result });
      return res.status(200).json(result);
    } catch (error: any) {
      Logger.error("CallController error in listAllCalls", { error: error.message, stack: error.stack });
      return res.status(500).json({ error: "Failed to list all calls" });
    }
  }

  /**
   * PUT /call/update
   * Updates call parameters (e.g., status, URL).
   */
  public async updateCall(req: Request, res: Response) {
    const { callSid, status, url } = req.body;
    Logger.info("CallController: Received /call/update request", { callSid, status, url });
    if (!callSid || !status) {
      return res.status(400).json({ error: "Call SID and status are required" });
    }
    try {
      const result = await this.callService.updateCall(callSid, status, url);
      Logger.info("CallController: /call/update response", { result });
      return res.status(200).json(result);
    } catch (error: any) {
      Logger.error("CallController error in updateCall", { error: error.message, stack: error.stack });
      return res.status(500).json({ error: "Failed to update call" });
    }
  }

  // ---------- Call Transfer Routes ----------

  /**
   * POST /call/transfer/blind
   * Initiates an unattended (blind) transfer.
   */
  public async blindTransfer(req: Request, res: Response) {
    try {
      const { callSid, redirectUrl } = req.body;
      if (!callSid || !redirectUrl) {
        return res.status(400).json({ error: "callSid and redirectUrl are required" });
      }
      const result = await this.callService.blindTransfer(callSid, redirectUrl);
      Logger.info("CallController: /call/transfer/blind response", { result });
      return res.status(200).json(result);
    } catch (error: any) {
      Logger.error("CallController error in blindTransfer", { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /call/transfer/hangupcall
   * Hangs up a call as part of a transfer.
   */
  public async hangupCall(req: Request, res: Response) {
    try {
      const { callSid } = req.body;
      if (!callSid) {
        return res.status(400).json({ error: "callSid is required" });
      }
      const result = await this.callService.hangupCall(callSid);
      Logger.info("CallController: /call/transfer/hangupcall response", { result });
      return res.status(200).json(result);
    } catch (error: any) {
      Logger.error("CallController error in hangupCall", { error: error.message });
      return res.status(500).json({ error: error.message });
    }
  }
}
