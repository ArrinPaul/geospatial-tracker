import { useEffect, useRef, useCallback, useState } from "react";

interface UseWebSocketOptions {
  url: string;
  onMessage: (data: any) => void;
  reconnectInterval?: number;
  city?: string;
  lat?: number;
  lon?: number;
}

export function useWebSocket({
  url,
  onMessage,
  reconnectInterval = 3000,
  city = "los_angeles",
  lat,
  lon,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const onMessageRef = useRef(onMessage);

  // Keep callback ref fresh without re-triggering connect
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const connect = useCallback(() => {
    // Don't reconnect if already open or connecting
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    try {
      // Append city and optional coordinates as query params
      const params = new URLSearchParams({ city });
      if (lat !== undefined && lon !== undefined) {
        params.set("lat", String(lat));
        params.set("lon", String(lon));
      }
      const wsUrl = `${url}?${params}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setConnected(true);
        console.log("[WS] Connected to", wsUrl);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastUpdate(new Date());
          onMessageRef.current(data);
        } catch (e) {
          console.error("[WS] Parse error:", e);
        }
      };

      ws.onclose = (event) => {
        setConnected(false);
        if (!event.wasClean) {
          console.log("[WS] Disconnected unexpectedly. Reconnecting...");
        }
        reconnectTimer.current = setTimeout(connect, reconnectInterval);
      };

      ws.onerror = (err) => {
        console.error("[WS] Error:", err);
        ws.close();
      };

      wsRef.current = ws;
    } catch (e) {
      console.error("[WS] Failed to create WebSocket:", e);
      reconnectTimer.current = setTimeout(connect, reconnectInterval);
    }
  }, [url, reconnectInterval, city, lat, lon]);

  // Send a message to the server (e.g. city/coordinate switch)
  const sendMessage = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  // When city or coordinates change, send switch message to server
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const msg: Record<string, unknown> = { city };
      if (lat !== undefined && lon !== undefined) {
        msg.lat = lat;
        msg.lon = lon;
      }
      wsRef.current.send(JSON.stringify(msg));
    }
  }, [city, lat, lon]);

  return { connected, lastUpdate, sendMessage };
}
