import { Router } from "express";
import { StatusController } from "./status.controller";

export class StatusModule {
  public router: Router;
  private statusController: StatusController;

  constructor(ioServer: any) {
    this.router = Router();
    this.statusController = new StatusController(ioServer);
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // When mounted at "/", these become:
    //   POST /api/signalwire/webhook/recording-status-callback
    //   POST /api/signalwire/webhook/voice-status-callback
    //   POST /api/signalwire/call-logs/call-status
    this.router.post(
      "/webhook/recording-status-callback",
      this.statusController.recordingStatusCallback.bind(this.statusController)
    );
    this.router.post(
      "/webhook/voice-status-callback",
      this.statusController.voiceStatusCallback.bind(this.statusController)
    );
    this.router.post(
      "/call-logs/call-status",
      this.statusController.callStatusUpdate.bind(this.statusController)
    );
  }
}
