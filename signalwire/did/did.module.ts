import { Router } from "express";
import { DidController } from "./did.controller";

export class DidModule {
  public router: Router;
  private didController: DidController;

  constructor() {
    this.router = Router();
    this.didController = new DidController();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // When mounted at "/dids", becomes:
    //  GET  /api/signalwire/dids
    //  POST /api/signalwire/dids/buy
    //  POST /api/signalwire/dids/assign
    this.router.get("/", this.didController.getDidNumbersByUser.bind(this.didController));
    this.router.post("/buy", this.didController.buyNumbers.bind(this.didController));
    this.router.post("/assign", this.didController.assignNumber.bind(this.didController));
  }
}
