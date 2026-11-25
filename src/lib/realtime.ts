import { useEffect, useRef } from 'react';
import type { RealtimeEvent } from '../shared/types';

export function useCourtRealtime(params: {
  onEvent: (event: RealtimeEvent) => void;
  onReconnectSync: () => void;
}) {
  const onEventRef = useRef(params.onEvent);
  const onReconnectSyncRef = useRef(params.onReconnectSync);

  onEventRef.current = params.onEvent;
  onReconnectSyncRef.current = params.onReconnectSync;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let attempt = 0;
    let hasConnectedOnce = false;

    const connect = () => {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;

      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        attempt = 0;
        if (hasConnectedOnce) {
          onReconnectSyncRef.current();
        }
        hasConnectedOnce = true;
      };

      ws.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(String(msg.data)) as RealtimeEvent;
          if (parsed && typeof parsed.type === 'string') {
            onEventRef.current(parsed);
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        // Close will trigger reconnect
        ws?.close();
      };
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      const delayMs = Math.min(1000 * Math.pow(2, attempt), 8000);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.close();
      }
    };
  }, []);
}
