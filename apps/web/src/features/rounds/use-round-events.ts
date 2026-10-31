import { useEffect, useState } from "react";

export interface EventStream {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventStream;
export type StreamState = "idle" | "connecting" | "connected" | "reconnecting";

export function useRoundEvents(roundId: string | undefined, factory: EventSourceFactory): StreamState {
  const [state, setState] = useState<StreamState>(roundId === undefined ? "idle" : "connecting");

  useEffect(() => {
    if (roundId === undefined) {
      setState("idle");
      return undefined;
    }

    let stream: EventStream | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      reconnectTimer = undefined;
      stream = factory(`/api/v1/rounds/${encodeURIComponent(roundId)}/events`);
      stream.onopen = () => setState("connected");
      stream.onerror = () => {
        if (reconnectTimer !== undefined) return;
        stream?.close();
        setState("reconnecting");
        reconnectTimer = setTimeout(connect, 1_000);
      };
    };

    setState("connecting");
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      stream?.close();
    };
  }, [factory, roundId]);

  return state;
}