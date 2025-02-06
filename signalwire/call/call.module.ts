import { Router } from "express";
import { CallController } from "./call.controller";

export class CallModule {
  public router: Router;
  private callController: CallController;

  constructor(ioServer: any) {
    this.router = Router();
    this.callController = new CallController(ioServer);
    this.setupRoutes();
  }

  /**
   * Define each route with the *exact same path* you used to have
   * in your old SignalWireController. That way, the final route
   * remains /api/signalwire/call/dial, /api/signalwire/call/hold, etc.
   */
  private setupRoutes(): void {
    // -------------------------------------------------------------------------
    // 1) CALL LOGS (if your front-end expects /api/signalwire/call-logs/...)
    // -------------------------------------------------------------------------
    // => GET /call-logs
    this.router.get(
      "/call-logs",
      this.callController.getCallLogsList.bind(this.callController)
    );

    // => GET /call-logs/:id
    this.router.get(
      "/call-logs/:id",
      this.callController.getCallLogDetails.bind(this.callController)
    );

    // -------------------------------------------------------------------------
    // 2) CALL ROUTES (front-end calls /api/signalwire/call/dial, etc.)
    // -------------------------------------------------------------------------
    // => POST /call/dial
    this.router.post(
      "/dial",
      this.callController.dial.bind(this.callController)
    );

    // => POST /call/hold
    this.router.post(
      "/hold",
      this.callController.hold.bind(this.callController)
    );

    // => POST /call/resume
    this.router.post(
      "/resume",
      this.callController.resume.bind(this.callController)
    );

    // => DELETE /call/hangup
    this.router.delete(
      "/hangup",
      this.callController.hangup.bind(this.callController)
    );

    // => GET /call/list
    this.router.get(
      "/list",
      this.callController.listAllCalls.bind(this.callController)
    );

    // => PUT /call/update
    this.router.put(
      "/update",
      this.callController.updateCall.bind(this.callController)
    );

    // -------------------------------------------------------------------------
    // 3) CALL TRANSFER ROUTES
    // -------------------------------------------------------------------------
    // => POST /call/transfer/blind
    this.router.post(
      "/transfer/blind",
      this.callController.blindTransfer.bind(this.callController)
    );

    // => POST /call/transfer/hangupcall
    this.router.post(
      "/transfer/hangupcall",
      this.callController.hangupCall.bind(this.callController)
    );
  }
}
