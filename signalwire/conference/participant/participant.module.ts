// src/signalwire/conference/participant/participants.module.ts
import { Router } from "express";
import participantController from "./participant.controller";

const router = Router();

router.post("/add", participantController.addParticipant.bind(participantController));
router.post("/mute", participantController.muteParticipant.bind(participantController));
router.post("/unmute", participantController.unmuteParticipant.bind(participantController));
router.post("/hold", participantController.holdParticipant.bind(participantController));
router.post("/resume", participantController.resumeParticipant.bind(participantController));
router.get("/getAll", participantController.getAllParticipants.bind(participantController));
router.delete("/delete", participantController.deleteParticipant.bind(participantController));
router.put("/update", participantController.updateParticipant.bind(participantController));

export default router;
