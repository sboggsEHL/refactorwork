// signalwire/sms/sms.controller.ts
import { Request, Response } from "express";
import { SMSService } from "./sms.service";
import { Logger } from "../../shared/logger";

const smsService = new SMSService();

export class SMSController {
  public static async sendSMS(req: Request, res: Response) {
    const { to, message } = req.body;
    const from = "+15207723712";

    if (!to || !message) {
      return res.status(400).json({ error: "Missing 'to' or 'message' field" });
    }

    try {
      const result = await smsService.sendSMS(from, to, message);
      return res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      Logger.error("Error sending SMS:", { error });
      return res.status(500).json({ error: "Failed to send SMS" });
    }
  }

  public static async getSMSHistory(req: Request, res: Response) {
    try {
      const logs = await smsService.getSMSLogs();
      return res.status(200).json({ data: logs });
    } catch (error: any) {
      Logger.error("Error fetching SMS logs:", { error });
      return res.status(500).json({ error: "Failed to fetch SMS logs" });
    }
  }

  public static async inboundSMS(req: Request, res: Response) {
    // Log the incoming request body
    Logger.info("Inbound SMS received", { body: req.body });

    const {
      MessageSid,
      From,
      To,
      Body,
      MessageStatus,
      AccountSid,
      NumMedia,
      NumSegments,
      ErrorCode,
    } = req.body;

    try {
      await smsService.logSMS({
        messageSid: MessageSid,
        messageStatus: MessageStatus || "received",
        errorCode: ErrorCode || null,
        accountSid: AccountSid || null,
        from: From,
        to: To,
        body: Body,
        numMedia: NumMedia,
        numSegments: NumSegments,
      });

      const responseXml = "<Response></Response>";
      return res.type("text/xml").status(200).send(responseXml);
    } catch (error: any) {
      Logger.error("Error processing inbound SMS:", { error });
      return res.status(500).send();
    }
  }
}
