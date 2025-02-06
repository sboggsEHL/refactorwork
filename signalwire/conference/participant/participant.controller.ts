import { Request, Response } from "express";
import { Logger } from "../../../shared/logger";
import participantService from "./participant.service";
import { addParticipantRequest } from "../../signalwire.model";

class ParticipantController {
  private readonly logger = Logger;

  async addParticipant(req: Request, res: Response): Promise<void> {
    const { callSid, lamlBinUrl } = req.body;
  
    if (!callSid || !lamlBinUrl) {
      res.status(400).json({ error: "callSid and lamlBinUrl are required" });
      return;
    }
  
    try {
      const result = await participantService.addParticipantToConference(callSid, lamlBinUrl);
      this.logger.info("Sending /conference/participant/add response", { result });
  
      res.status(200).json(result);
    } catch (error: any) {
      this.logger.error("Error adding participant:", { error: error.message, stack: error.stack });
      res.status(500).json({ error: "Failed to add participant" });
    }
  }
  

  async muteParticipant(req: Request, res: Response): Promise<void> {
    try {
      const { conferenceSid, callSid } = req.body;
      if (!conferenceSid || !callSid) {
        res.status(400).json({ error: "Conference SID and Participant SID are required" });
        return;
      }
      const result = await participantService.muteParticipant(conferenceSid, callSid);
      res.status(200).json(result);
      return;
    } catch (error: any) {
      this.logger.error("Error muting participant:", { error: error.message, stack: error.stack });
      res.status(500).json({ error: "Failed to mute participant" });
      return;
    }
  }

  async unmuteParticipant(req: Request, res: Response): Promise<void> {
    try {
      const { conferenceSid, callSid } = req.body;
      if (!conferenceSid || !callSid) {
        res.status(400).json({ error: "Conference SID and Participant SID are required" });
        return;
      }
      const result = await participantService.unmuteParticipant(conferenceSid, callSid);
      res.status(200).json(result);
      return;
    } catch (error: any) {
      this.logger.error("Error unmuting participant:", { error: error.message, stack: error.stack });
      res.status(500).json({ error: "Failed to unmute participant" });
      return;
    }
  }

  async holdParticipant(req: Request, res: Response): Promise<void> {
    try {
      const { conferenceSid, callSid } = req.body;
      if (!conferenceSid || !callSid) {
        res.status(400).json({ error: "Conference SID and Participant SID are required" });
        return;
      }
      const result = await participantService.holdParticipant(conferenceSid, callSid);
      res.status(200).json(result);
      return;
    } catch (error: any) {
      this.logger.error("Error holding participant:", { error: error.message, stack: error.stack });
      res.status(500).json({ error: "Failed to hold participant" });
      return;
    }
  }

  async resumeParticipant(req: Request, res: Response): Promise<void> {
    try {
      const { conferenceSid, callSid } = req.body;
      if (!conferenceSid || !callSid) {
        res.status(400).json({ error: "Conference SID and Participant SID are required" });
        return;
      }
      const result = await participantService.resumeParticipant(conferenceSid, callSid);
      res.status(200).json(result);
      return;
    } catch (error: any) {
      this.logger.error("Error resuming participant:", { error: error.message, stack: error.stack });
      res.status(500).json({ error: "Failed to resume participant" });
      return;
    }
  }

  async getAllParticipants(req: Request, res: Response): Promise<void> {
    try {
      const { conferenceName } = req.query;
      if (!conferenceName || typeof conferenceName !== "string") {
        res.status(400).json({ error: "Conference name is required" });
        return;  // <-- Explicit return statement to match void
      }
  
      const result = await participantService.getAllParticipants(conferenceName);
      res.status(200).json(result);
      return;  // <-- Explicit return statement to match void
    } catch (error: any) {
      Logger.error("Error fetching participants:", { error: error.message, stack: error.stack });
      res.status(500).json({ error: "Failed to fetch participants" });
      return;  // <-- Explicit return statement to match void
    }
  }
  
  

  async deleteParticipant(req: Request, res: Response): Promise<void> {
    try {
      const { conferenceSid, callSid } = req.body;
      if (!conferenceSid || !callSid) {
        res.status(400).json({ error: "Conference SID and Participant SID are required" });
        return;
      }
      const result = await participantService.deleteParticipant(conferenceSid, callSid);
      res.status(200).json(result);
      return;
    } catch (error: any) {
      this.logger.error("Error deleting participant:", { error: error.message, stack: error.stack });
      res.status(500).json({ error: "Failed to delete participant" });
      return;
    }
  }

  async updateParticipant(req: Request, res: Response): Promise<void> {
    try {
      const { conferenceSid, callSid, data } = req.body;
      if (!conferenceSid || !callSid || !data) {
        res.status(400).json({ error: "Conference SID, Participant SID, and data are required" });
        return;
      }
      const result = await participantService.updateParticipant(conferenceSid, callSid, data);
      res.status(200).json(result);
      return;
    } catch (error: any) {
      this.logger.error("Error updating participant:", { error: error.message, stack: error.stack });
      res.status(500).json({ error: "Failed to update participant" });
      return;
    }
  }
}

export default new ParticipantController();
