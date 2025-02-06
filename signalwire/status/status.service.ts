import { query } from "../signalwire.database";
import { Logger } from "../../shared/logger";

export class StatusService {
  private ioServer: any;

  constructor(ioServer: any) {
    this.ioServer = ioServer;
  }

  /**
   * Processes the recording status callback data by updating the call_logs record.
   */
  public async recordingStatusCallback(data: any): Promise<void> {
    const { CallSid, ConferenceSid, RecordingSid, RecordingUrl, RecordingDuration } = data;
    Logger.info("Received Recording Status Callback", { CallSid, ConferenceSid, RecordingSid, RecordingUrl, RecordingDuration });

    if (!CallSid && !ConferenceSid) {
      Logger.warn("Missing required fields - no CallSid or ConferenceSid", { CallSid, ConferenceSid });
      throw new Error("Missing callSid or conferenceSid");
    }

    if (!RecordingUrl) {
      Logger.warn("Missing RecordingUrl in recording callback", { CallSid, ConferenceSid });
      throw new Error("Missing RecordingUrl");
    }

    const sidUsedForLookup = CallSid || ConferenceSid;
    const parsedDuration = RecordingDuration ? parseInt(RecordingDuration, 10) : null;
    const sql = `
      UPDATE public.call_logs
      SET recording_url = $1,
          call_duration = $2
      WHERE call_sid = $3 OR conference_sid = $3
    `;
    const values = [RecordingUrl, parsedDuration, sidUsedForLookup];
    Logger.info("About to run SQL on call_logs", { query: sql, values });

    const result = await query(sql, values);
    Logger.info("SQL execution result for updating call_logs", { rowCount: result.rowCount, rows: result.rows });

    if (result.rowCount === 0) {
      Logger.warn("No matching row found to update (call_sid or conference_sid)", { sidUsedForLookup });
      throw new Error("No matching record found");
    }

    Logger.info("Recording URL updated", { sidUsedForLookup, RecordingUrl, updatedDuration: parsedDuration });
  }

  /**
   * Processes call status update data by inserting/updating the call_logs record.
   */
  public async callStatusUpdate(data: any): Promise<any> {
    try {
      const { CallSid, CallStatus, Timestamp, Direction, From, To, CallDuration, RecordingUrl } = data;
      Logger.info("Logging the call status update", { From, To, CallSid });
      const sqlQuery = `
        INSERT INTO public.call_logs (
          call_sid,
          call_status,
          timestamp,
          direction,
          from_number,
          to_number,
          call_duration,
          recording_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (call_sid) DO UPDATE SET
          call_status = EXCLUDED.call_status,
          timestamp = EXCLUDED.timestamp,
          call_duration = EXCLUDED.call_duration,
          recording_url = EXCLUDED.recording_url
        RETURNING *;
      `;
      const values = [
        CallSid,
        CallStatus,
        Timestamp || new Date().toISOString(),
        Direction,
        From,
        To,
        CallDuration ? parseInt(CallDuration, 10) : null,
        RecordingUrl,
      ];

      const result = await query(sqlQuery, values);
      Logger.info("Inserted/Updated call log in database", { result: result.rows[0] });
      return result.rows[0];
    } catch (error: any) {
      Logger.error("Error updating call status", { error: error.message });
      throw new Error("Failed to update call status");
    }
  }

  /**
   * Processes the voice status callback by updating call logs and emitting a call-ended event if needed.
   */
  public async voiceStatusCallback(data: any): Promise<void> {
    const { CallSid, CallStatus, From, To, Direction, CallDuration, recordingUrl } = data;
    Logger.info("Received voice status callback", { CallSid, CallStatus, From, To, Direction, CallDuration, recordingUrl });

    try {
      const callDurationParsed = CallDuration ? parseInt(CallDuration, 10) : undefined;
      // Update the call log record using callStatusUpdate
      await this.callStatusUpdate({
        CallSid,
        CallStatus,
        Timestamp: new Date().toISOString(),
        Direction,
        From,
        To,
        CallDuration: callDurationParsed,
        RecordingUrl: recordingUrl,
      });

      // Emit the call-ended event if the call has ended
      const endedStatuses = ["completed", "canceled", "busy", "failed", "no-answer"];
      if (endedStatuses.includes(CallStatus.toLowerCase())) {
        Logger.info("Emitting call-ended event", { CallSid, CallStatus });
        this.ioServer.emit("call-ended", { callSid: CallSid, status: CallStatus });
      }
    } catch (error: any) {
      Logger.error("Error processing voice status callback", { error: error.message });
      throw new Error("Failed to process voice status callback");
    }
  }
}
