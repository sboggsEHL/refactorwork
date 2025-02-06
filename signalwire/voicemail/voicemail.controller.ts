import { Request, Response } from "express";
import { VoicemailService } from "./voicemail.service";
import { Logger } from "../../shared/logger";

export class VoicemailController {
  private voicemailService: VoicemailService;

  constructor() {
    this.voicemailService = new VoicemailService();
  }

  /**
   * POST /voicemail/save
   * Saves a voicemail by downloading the recording from the provided URL and uploading it to DO Spaces.
   */
  public async saveVoicemail(req: Request, res: Response): Promise<void> {
    try {
      const fileUrl = await this.voicemailService.saveVoicemail(req.body);
      res.status(200).json({
        message: "Voicemail saved",
        fileUrl,
      });
    } catch (error: any) {
      Logger.error("Error saving voicemail", { error: error.message });
      res.status(500).json({ error: "Failed to save voicemail" });
    }
  }

  /**
   * POST /voicemail/upload
   * Uploads a voicemail greeting file to DO Spaces.
   */
  public async uploadVoicemailGreeting(req: Request, res: Response): Promise<void> {
    try {
      const file = req.file as Express.Multer.File | undefined;
      if (!file) {
        res.status(400).json({ success: false, message: "No file provided." });
        return;
      }
      const voicemailType = req.body.voicemailType;
      if (!voicemailType) {
        res.status(400).json({ success: false, message: "voicemailType is required." });
        return;
      }
      // For now, we use a hardcoded username; adjust as needed.
      const username = req.body.username || "DefaultUser";
      const fileUrl = await this.voicemailService.uploadVoicemailGreeting(
        file.buffer,
        username,
        voicemailType,
        file.mimetype || "audio/mpeg"
      );
      res.status(200).json({
        success: true,
        message: "Voicemail uploaded successfully",
        fileUrl,
      });
    } catch (error: any) {
      Logger.error("Error uploading voicemail greeting", { error: error.message });
      res.status(500).json({
        success: false,
        message: error.message || "Failed to upload voicemail",
      });
    }
  }
}
