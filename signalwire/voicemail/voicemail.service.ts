import axios from "axios";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { query } from "../signalwire.database";
import { Logger } from "../../shared/logger";

export class VoicemailService {
  private s3Client: S3Client;
  private s3Bucket: string;

  constructor() {
    // Initialize the S3 client for DigitalOcean Spaces.
    this.s3Client = new S3Client({
      region: "us-east-1", // DigitalOcean Spaces region
      endpoint: process.env.DO_SPACES_ENDPOINT, // e.g., "https://sfo3.digitaloceanspaces.com"
      credentials: {
        accessKeyId: process.env.DO_SPACES_KEY || "",
        secretAccessKey: process.env.DO_SPACES_SECRET || "",
      },
      forcePathStyle: true,
    });

    // Set the bucket name (e.g., "elecrm")
    this.s3Bucket = process.env.DO_SPACES_BUCKET || "elecrm";
  }

  /**
   * Saves a voicemail by downloading the recording from the provided URL and uploading it to DO Spaces.
   * @param body - The request body containing RecordingUrl, CallSid, and username.
   * @returns The public URL of the uploaded voicemail.
   */
  public async saveVoicemail(body: any): Promise<string> {
    console.log("🔥 [DEBUG] Incoming request body:", body);
    const { RecordingUrl, CallSid, username } = body;
    if (!RecordingUrl || !CallSid || !username) {
      console.error("❌ [ERROR] Missing parameters", { RecordingUrl, CallSid, username });
      throw new Error("Missing required parameters: 'RecordingUrl', 'CallSid', or 'username'");
    }
    console.log("✅ [INFO] Processing voicemail for user:", username);

    // Generate a timestamp in a safe filename format.
    const nowUtc = new Date();
    const offsetMs = 7 * 60 * 60 * 1000; // e.g., for Phoenix (UTC-7)
    const phoenixTime = new Date(nowUtc.getTime() - offsetMs);
    const timestamp = phoenixTime.toISOString().replace(/:/g, "-").split(".")[0];

    // Construct the file path.
    const folderPath = `User_Assets/User_Voicemails/${username}`;
    const fileKey = `${folderPath}/${CallSid}_${timestamp}.mp3`;
    console.log("📂 [INFO] File will be stored at:", fileKey);

    console.log("⏳ [INFO] Downloading voicemail from:", RecordingUrl);
    let fileBuffer: Buffer;
    try {
      const response = await axios.get(RecordingUrl, { responseType: "arraybuffer" });
      fileBuffer = Buffer.from(response.data);
      console.log("✅ [INFO] Download complete. File size:", fileBuffer.length, "bytes");
    } catch (downloadErr) {
      console.error("❌ [ERROR] Failed to download RecordingUrl:", downloadErr);
      throw new Error("Could not download the voicemail from RecordingUrl");
    }

    console.log("🚀 [INFO] Uploading voicemail to DigitalOcean Spaces...");
    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: fileKey,
          Body: fileBuffer,
          ACL: "public-read",
          ContentType: "audio/mpeg",
        })
      );
      console.log("✅ [SUCCESS] Voicemail uploaded to Spaces:", fileKey);
    } catch (uploadError) {
      console.error("❌ [ERROR] Failed to upload voicemail to Spaces:", uploadError);
      throw new Error("Failed to upload voicemail to DigitalOcean Spaces");
    }

    const fileUrl = `https://${this.s3Bucket}.sfo3.cdn.digitaloceanspaces.com/${fileKey}`;
    console.log("🔗 [INFO] Voicemail CDN URL:", fileUrl);
    return fileUrl;
  }

  /**
   * Uploads a voicemail greeting file to DigitalOcean Spaces.
   * @param fileBuffer - The file data as a Buffer.
   * @param username - The username associated with the greeting.
   * @param voicemailType - The type/identifier of the greeting.
   * @param mimeType - The MIME type of the file (default "audio/mpeg").
   * @returns The public URL of the uploaded greeting.
   */
  public async uploadVoicemailGreeting(
    fileBuffer: Buffer,
    username: string,
    voicemailType: string,
    mimeType: string = "audio/mpeg"
  ): Promise<string> {
    try {
      // Construct the filename (e.g., "Imendoza_Standard_Voicemail.mp3")
      const fileName = `${username}_${voicemailType}.mp3`;

      // Define the path in the bucket.
      const Key = `User_Assets/User_Voice_Mail_Recordings/${fileName}`;

      // Upload the file.
      const command = new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key,
        Body: fileBuffer,
        ACL: "public-read",
        ContentType: mimeType,
      });
      await this.s3Client.send(command);

      // Return the public URL.
      return `https://${this.s3Bucket}.sfo3.cdn.digitaloceanspaces.com/${Key}`;
    } catch (error) {
      Logger.error("Error uploading voicemail greeting", { error });
      throw new Error("Failed to upload voicemail greeting");
    }
  }
}
