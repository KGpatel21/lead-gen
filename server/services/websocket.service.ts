/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  /**
   * Initializes WebSocket Server on top of the primary Express HTTP Server.
   */
  public initialize(server: HttpServer) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      // Direct WebSocket upgrade handler
      if (request.url === "/ws" || request.url?.startsWith("/ws")) {
        this.wss?.handleUpgrade(request, socket, head, (ws) => {
          this.wss?.emit("connection", ws, request);
        });
      }
    });

    this.wss.on("connection", (ws: WebSocket) => {
      console.log("[WebSocket Server] Client connection established.");
      this.clients.add(ws);

      // Send initial welcome state
      ws.send(JSON.stringify({
        type: "SYSTEM_READY",
        payload: {
          connected: true,
          timestamp: new Date().toISOString()
        }
      }));

      ws.on("message", (message) => {
        try {
          const parsed = JSON.parse(message.toString());
          console.log("[WebSocket Server] Received client message:", parsed);
          // Heartbeat ping-pong
          if (parsed.type === "PING") {
            ws.send(JSON.stringify({ type: "PONG" }));
          }
        } catch (e) {
          // Ignore invalid frames
        }
      });

      ws.on("close", () => {
        console.log("[WebSocket Server] Client disconnected.");
        this.clients.delete(ws);
      });

      ws.on("error", (err) => {
        console.error("[WebSocket Server] Connection error:", err);
        this.clients.delete(ws);
      });
    });

    console.log("[WebSocket Server] Real-time communication system mounted.");
  }

  /**
   * Broadcasts real-time events to all active subscriber sessions.
   */
  public broadcast(type: string, payload: any) {
    if (!this.wss) return;
    
    const message = JSON.stringify({ type, payload });
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (err) {
          console.error("[WebSocket Server] Broadcast fail:", err);
        }
      }
    });
  }
}

export const webSocketService = new WebSocketService();
