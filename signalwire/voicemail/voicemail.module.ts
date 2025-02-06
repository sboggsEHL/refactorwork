import { Router } from "express";
import multer from "multer";
import { VoicemailController } from "./voicemail.controller";

export class VoicemailModule {
  public router: Router;
  private voicemailController: VoicemailController;

  constructor() {
    this.router = Router();
    this.voicemailController = new VoicemailController();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // When mounted at "/voicemail", these become:
    //   POST /api/signalwire/voicemail/upload
    //   POST /api/signalwire/voicemail/save
    const upload = multer();
    this.router.post(
      "/upload",
      upload.single("file"),
      this.voicemailController.uploadVoicemailGreeting.bind(this.voicemailController)
    );
    this.router.post("/save", this.voicemailController.saveVoicemail.bind(this.voicemailController));
  }
}
