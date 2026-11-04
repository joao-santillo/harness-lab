import { useEffect, useState } from "react";

export interface EventStream {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener?(type: string, listener: EventListener): void;
  close(): void;
}

export interface RoundProgressEvent {
  readonly id: string;
  readonly roundId: string;
  readonly sequence: number;
  readonly event: string;
  readonly state: string;
  readonly occurredAt: string;
  readonly messageCode: string;
}

export type EventSourceFactory = (url: string) => EventStream;
export type StreamState = "idle" | "connecting" | "connected" | "reconnecting";

function parseRoundProgressEvent(value: unknown): RoundProgressEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const event = value as Record<string, unknown>;
  return typeof event.id === "string" && typeof event.roundId === "string" &&
    typeof event.sequence === "number" && typeof event.event === "string" &&
    typeof event.state === "string" && typeof event.occurredAt === "string" &&
    typeof event.messageCode === "string"
    ? event as unknown as RoundProgressEvent
    : null;
}

export function useRoundEvents(roundId: string | undefined, factory: EventSourceFactory, onProgress?: (event: RoundProgressEvent) => void): StreamState {
  const [state, setState] = useState<StreamState>(roundId === undefined ? "idle" : "connecting");

  useEffect(() => {
    if (roundId === undefined) {
      setState("idle");
      return undefined;
    }

    let active = true;
    const stream = factory(`/api/v1/rounds/${encodeURIComponent(roundId)}/events`);
    stream.onopen = () => {
      if (active) setState("connected");
    };
    stream.addEventListener?.("round-progress", (event) => {
      try {
        const progress = parseRoundProgressEvent(JSON.parse((event as MessageEvent<string>).data) as unknown);
        if (active && progress !== null && progress.roundId === roundId) onProgress?.(progress);
      } catch {
        // Ignore malformed event frames; the stream can still recover on a later checkpoint.
      }
    });
    stream.onerror = () => {
      if (active) setState("reconnecting");
    };

    setState("connecting");
    return () => {
      active = false;
      stream.close();
    };
  }, [factory, onProgress, roundId]);

  return state;
}