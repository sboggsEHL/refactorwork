// Server Side/src/signalwire/conference/conference.module.ts
import { Router } from "express";
import { ConferenceController } from "./conference.controller";
import  participantRouter  from "./participant/participant.module"; 

export default class ConferenceModule {
  public router: Router;
  private conferenceController: ConferenceController;
  private ioServer: any;

  constructor(ioServer: any) {
    this.router = Router();
    this.ioServer = ioServer;
    this.conferenceController = new ConferenceController(ioServer);
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // For each route, wrap the controller method in an arrow function that passes (req, res, next)
    this.router.post(
      "/connect",
      (req, res, next) => this.conferenceController.getOrCreateConferenceRoom(req, res, next)
    );
    this.router.post(
      "/disconnect",
      (req, res, next) => this.conferenceController.disconnectConference(req, res, next)
    );
    this.router.get(
      "/list",
      (req, res, next) => this.conferenceController.listAllConferences(req, res, next)
    );
    this.router.get(
      "/retrieve",
      (req, res, next) => this.conferenceController.retrieveConference(req, res, next)
    );
    this.router.post(
      "/active",
      (req, res, next) => this.conferenceController.getActiveConference(req, res, next)
    );
    this.router.post(
      "/dtmf",
      (req, res, next) => this.conferenceController.sendConferenceDtmf(req, res, next)
    );

    // MOUNT the participant router at /participant
    // => /api/signalwire/conference/participant/*
    this.router.use("/participant", participantRouter);
  }
}
