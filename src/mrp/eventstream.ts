import { BunTCPTransport } from "./transport";
import { ChaCha20EncryptionLayer } from "./encryption";
import { HttpFramedChannel } from "./HttpFramedChannel";
import { createLogger } from "./logging";

const logger = createLogger("bunatv:airplay:event-stream-channel");

export class EventStreamChannel {
  private transport: BunTCPTransport = new BunTCPTransport();
  private eventChannel: HttpFramedChannel;
  constructor(
    private connectionInfo: { address: string; port: number },
    private encryptionLayer: ChaCha20EncryptionLayer,
  ) {
    // Connect event channel
    this.eventChannel = new HttpFramedChannel(this.transport, this.encryptionLayer);
  }

  async start() {
    await this.transport.connect(this.connectionInfo.address, this.connectionInfo.port);
    this.eventChannel.on("request", (r) => {
      logger.debug(r, "Event channel response received:");

      const headers = new Map<string, string>();
      if (r.headers.has("server")) {
        headers.set("Server", r.headers.get("server")!);
      }
      if (r.headers.has("cseq")) {
        headers.set("CSeq", r.headers.get("cseq")!);
      }
      headers.set("Content-Length", "0");
      headers.set("Audio-Latency", "0");
      logger.debug(
        {
          statusCode: 200,
          statusText: "OK",
          headers: headers,
          body: Buffer.from(""),
        },
        "Sending event channel response",
      );
      this.eventChannel?.sendResponse({
        statusCode: 200,
        statusText: "OK",
        headers: headers,
        body: Buffer.from(""),
      });
    });
  }

  disconnect() {
    return this.transport.disconnect();
  }
}
