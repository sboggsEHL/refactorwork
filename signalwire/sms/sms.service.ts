import axios from 'axios';


export class SMSService {
  private projectId = process.env.SIGNALWIRE_PROJECT_ID || '';
  private authToken = process.env.SIGNALWIRE_AUTH_TOKEN || '';
  private apiUrl = process.env.SIGNALWIRE_API_URL || '';

  constructor() {
    if (!this.apiUrl.startsWith('http://') && !this.apiUrl.startsWith('https://')) {
      this.apiUrl = `https://${this.apiUrl}`;
    }
  }

  private get messagesUrl() {
    return `${this.apiUrl}/api/laml/2010-04-01/Accounts/${this.projectId}/Messages`;
  }

  public async sendSMS(from: string, to: string, body: string) {
    const payload = new URLSearchParams({ From: from, To: to, Body: body });
    try {
      const response = await axios.post(this.messagesUrl, payload, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: this.projectId, password: this.authToken },
      });
      return response.data;
    } catch (error: any) {
      console.error('[SMSService] Error sending SMS:', {
        message: error.message,
        stack: error.stack,
        responseData: error.response ? error.response.data : null,
        config: error.config,
      });
      throw error;
    }
  }

  public async getSMSLogs() {
    try {
      const response = await axios.get(this.messagesUrl, {
        auth: { username: this.projectId, password: this.authToken },
      });
      return response.data;
    } catch (error: any) {
      console.error('[SMSService] Error fetching SMS logs:', {
        message: error.message,
        stack: error.stack,
        responseData: error.response ? error.response.data : null,
        config: error.config,
      });
      throw error;
    }
  }

  public async logSMS(data: {
    messageSid: string;
    messageStatus?: string;
    errorCode?: number | null;
    accountSid?: string | null;
    from: string;
    to: string;
    body: string;
    numMedia?: string | null;
    numSegments?: string | null;
  }) {
    const queryText = `
      INSERT INTO public.sms_logs (
        message_sid, message_status, error_code, account_sid, from_number,
        to_number, body, num_media, num_segments, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *;
    `;

    const values = [
      data.messageSid,
      data.messageStatus || 'sent',
      data.errorCode || null,
      data.accountSid || null,
      data.from,
      data.to,
      data.body,
      data.numMedia || null,
      data.numSegments || null,
    ];
   
    const result = await global?.signalWirePool?.query(queryText, values);
    return result?.rows[0] || [];
  }

  public async findAssignedUserByPhoneNumber(phoneNumber: string): Promise<string | null> {
    const didQuery = `
      SELECT assigned_user
      FROM public.did_numbers
      WHERE phone_number = $1 AND status = 'Assigned';
    `;

    const res = await global?.signalWirePool?.query(didQuery, [phoneNumber]);
    if ((res?.rowCount ?? 0) > 0) {
        return res?.rows[0].assigned_user;
      }
      return null;
  }
}
