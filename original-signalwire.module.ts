// Server Side\src\signalwire\signalwire.module.ts

import { Router } from "express";
import multer from "multer"; 
import { SignalWireController } from "./signalwire.controller";


export class SignalWireModule {
  public router: Router;
  private signalWireController: SignalWireController;
  private ioServer: any;

  constructor(ioServer: any) {
    this.router = Router();
    this.ioServer = ioServer;
    this.signalWireController = new SignalWireController(ioServer);
    this.setupRoutes();
  }



  private setupRoutes() {
    const upload = multer();
    // Call routes
    this.router.post("/call/dial", this.signalWireController.dial.bind(this.signalWireController));
    this.router.post("/call/hold", this.signalWireController.hold.bind(this.signalWireController));
    this.router.post("/call/resume", this.signalWireController.resume.bind(this.signalWireController));
    this.router.delete("/call/hangup", this.signalWireController.hangup.bind(this.signalWireController));
    this.router.get("/call/list", this.signalWireController.listAllCalls.bind(this.signalWireController));
    this.router.put("/call/update", this.signalWireController.updateCall.bind(this.signalWireController));

    // Conference routes
    this.router.post("/conference/active", this.signalWireController.getActiveConference.bind(this.signalWireController));
    this.router.post("/conference/connect", this.signalWireController.getOrCreateConferenceRoom.bind(this.signalWireController));
    this.router.post("/conference/disconnect", this.signalWireController.disconnectConference.bind(this.signalWireController));
    this.router.get("/conference/list", this.signalWireController.listAllConferences.bind(this.signalWireController));
    this.router.get("/conference/retrieve", this.signalWireController.retrieveConference.bind(this.signalWireController));
    this.router.post("/conference/dtmf", this.signalWireController.sendConferenceDtmf.bind(this.signalWireController));

    // Participant routes within conferences
    this.router.post("/conference/participant/add", this.signalWireController.addParticipant.bind(this.signalWireController));
    this.router.post("/conference/participant/mute", this.signalWireController.muteParticipant.bind(this.signalWireController));
    this.router.post("/conference/participant/unmute", this.signalWireController.unmuteParticipant.bind(this.signalWireController));
    this.router.post("/conference/participant/hold", this.signalWireController.holdParticipant.bind(this.signalWireController));
    this.router.post("/conference/participant/resume", this.signalWireController.resumeParticipant.bind(this.signalWireController));
    this.router.get("/conference/participant/list", this.signalWireController.getAllParticipants.bind(this.signalWireController));
    this.router.delete("/conference/participant/delete", this.signalWireController.deleteParticipant.bind(this.signalWireController));
    this.router.put("/conference/participant/update", this.signalWireController.updateParticipant.bind(this.signalWireController));

    // Transfer Participants Route
    this.router.post("/call/transfer/blind", this.signalWireController.blindTransfer.bind(this.signalWireController));
    this.router.post("/call/transfer/hangupcall", this.signalWireController.hangupCall.bind(this.signalWireController));
    this.router.post("/call/transfer/attended", this.signalWireController.attendedTransfer.bind(this.signalWireController));

    // Incoming Call Controls
    this.router.post("/webhook/incoming-call", this.signalWireController.incomingCallNotification.bind(this.signalWireController));
    this.router.post("/webhook/incoming-call/:id", this.signalWireController.incomingCallNotification.bind(this.signalWireController));

    // Incoming SignalWire status post
    this.router.post("/call-logs/call-status", this.signalWireController.callStatusUpdate.bind(this.signalWireController));

    // Voice Status Callback
    this.router.post("/webhook/voice-status-callback", this.signalWireController.voiceStatusCallback.bind(this.signalWireController));

    // Recording Status Callback
    this.router.post("/webhook/recording-status-callback", this.signalWireController.recordingStatusCallback.bind(this.signalWireController));

    // DIDs
    this.router.get("/dids", this.signalWireController.getDidNumbersByUser.bind(this.signalWireController));
    this.router.post("/dids/buy", this.signalWireController.buyNumbers.bind(this.signalWireController));
    this.router.post("/dids/assign", this.signalWireController.assignNumber.bind(this.signalWireController));

    // NEW: Voicemail Upload Route
    this.router.post("/voicemail/upload", upload.single("file"), this.signalWireController.uploadVoicemailGreeting.bind(this.signalWireController));
    this.router.post("/voicemail/save", upload.none(), this.signalWireController.saveVoicemail.bind(this.signalWireController)
      // If you need a Multer middleware for "none" file fields, you can do:
      // upload.none(), 
    );

    // Team Status and Status Update
    this.router.get("/team-status", this.signalWireController.getTeamStatus.bind(this.signalWireController));
    
  }
}
