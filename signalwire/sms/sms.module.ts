// signalwire/sms/sms.module.ts
import { Router } from 'express';
import { SMSController } from './sms.controller';

export class SMSModule {
  public router: Router;

  constructor() {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes() {
    this.router.post('/send', SMSController.sendSMS);
    this.router.get('/history', SMSController.getSMSHistory);

    // Uncomment this line to enable inbound SMS route
    this.router.post('/inbound', SMSController.inboundSMS);
  }
}
