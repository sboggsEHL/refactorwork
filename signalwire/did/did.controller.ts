import { Request, Response } from "express";
import { DidService } from "./did.service";
import { Logger } from "../../shared/logger";

export class DidController {
  private didService: DidService;

  constructor() {
    // Instantiate the DID service (no ioServer required for DID endpoints)
    this.didService = new DidService();
  }

  /**
   * GET /dids
   * Retrieves the DID numbers assigned to a given user.
   */
  public async getDidNumbersByUser(req: Request, res: Response): Promise<void> {
    try {
      const { username } = req.query;
      if (typeof username !== "string") {
        res.status(400).json({ error: "Invalid username" });
        return;
      }
      
      const result = await this.didService.getDidNumbersByUser(username);
      res.status(200).json(result);
    } catch (error: any) {
      Logger.error("Error in getDidNumbersByUser", { error: error.message });
      res.status(500).json({ error: "Failed to fetch DID numbers" });
    }
  }

  /**
   * POST /dids/buy
   * Purchases new DID numbers given an area code and quantity.
   */
  public async buyNumbers(req: Request, res: Response): Promise<void> {
    try {
      const { areaCode, quantity } = req.body;
      Logger.info("DidController: buyNumbers called", { areaCode, quantity });
      await this.didService.buyNumbers(areaCode, Number(quantity) || 1);
      res.status(200).json({
        message: "Numbers purchased successfully",
        areaCode,
        quantity,
      });
    } catch (error: any) {
      Logger.error("Error in buyNumbers", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /dids/assign
   * Assigns a free DID to a user.
   */
  public async assignNumber(req: Request, res: Response): Promise<void> {
    try {
      const { username } = req.body;
      Logger.info("DidController: assignNumber called", { username });
      const assignedDid = await this.didService.assignDidToUser(username);
      res.status(200).json({
        message: `Assigned DID ${assignedDid} to user ${username}`,
        phoneNumber: assignedDid,
      });
    } catch (error: any) {
      Logger.error("Error in assignNumber", { error: error.message });
      res.status(500).json({ error: error.message });
    }
  }
}
