import { useEffect, useRef, useCallback, useState } from "react";import { useEffect, useRef, useCallback, useState } from "react";



























































}  return { connected, lastUpdate };  }, [connect]);    };      wsRef.current?.close();      clearTimeout(reconnectTimer.current);    return () => {    connect();  useEffect(() => {  }, [url, onMessage, reconnectInterval]);    wsRef.current = ws;    };      ws.close();      console.error("[WS] Error:", err);    ws.onerror = (err) => {    };      reconnectTimer.current = setTimeout(connect, reconnectInterval);      console.log("[WS] Disconnected. Reconnecting...");      setConnected(false);    ws.onclose = () => {    };      }        console.error("[WS] Parse error:", e);      } catch (e) {        onMessage(data);        setLastUpdate(new Date());        const data = JSON.parse(event.data);      try {    ws.onmessage = (event) => {    };      console.log("[WS] Connected to", url);      setConnected(true);    ws.onopen = () => {    const ws = new WebSocket(url);    if (wsRef.current?.readyState === WebSocket.OPEN) return;  const connect = useCallback(() => {  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);  const [connected, setConnected] = useState(false);  const wsRef = useRef<WebSocket | null>(null);export function useWebSocket({ url, onMessage, reconnectInterval = 3000 }: UseWebSocketOptions) {}  reconnectInterval?: number;  onMessage: (data: any) => void;  url: string;interface UseWebSocketOptions {
interface UseWebSocketOptions {
  url: string;
  onMessage: (data: any) => void;
  reconnectInterval?: number;
}

export default function useWebSocket({
  url,
  onMessage,
  reconnectInterval = 3000,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnected(true);
      console.log("[WS] Connected");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error("[WS] Failed to parse message:", e);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      console.log("[WS] Disconnected, reconnecting...");
      reconnectTimer.current = setTimeout(connect, reconnectInterval);
    };

    ws.onerror = (err) => {
      console.error("[WS] Error:", err);
      ws.close();
    };

    wsRef.current = ws;
  }, [url, onMessage, reconnectInterval]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected };
}
