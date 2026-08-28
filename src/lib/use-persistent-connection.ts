import { useCallback, useEffect, useRef, useState } from "react";
import { AppleTVConnection, disconnect, onConnectionLost } from "@bharper/atv-js";
import { openConnection } from "./connection";
import { NotPairedError, showErrorToast } from "./errors";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "not-paired";

/**
 * One live Companion connection for the lifetime of a view, so every press
 * is instant. Opens on mount, tears down on unmount, tracks drops, and
 * coalesces concurrent open attempts: `openConnection` can take up to the
 * connect timeout (~8s), and without coalescing every key pressed in that
 * window would launch another attempt and abandon the loser's socket.
 */
export function usePersistentConnection() {
  const connRef = useRef<AppleTVConnection | null>(null);
  // The connection attempt currently in flight, shared by every caller.
  const establishingRef = useRef<Promise<AppleTVConnection | null> | null>(null);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [deviceName, setDeviceName] = useState<string>("Apple TV");

  const establish = useCallback(async (): Promise<AppleTVConnection | null> => {
    if (establishingRef.current) return establishingRef.current;

    const attempt = (async (): Promise<AppleTVConnection | null> => {
      // Retire any existing connection up front (the ref is only non-null here
      // on a manual reconnect over a live connection). Tearing it down *before*
      // opening the replacement means no in-flight action keeps using a socket
      // we're about to drop, and a failed reconnect can't leak the old one.
      const previous = connRef.current;
      connRef.current = null;
      if (previous) disconnect(previous);

      setStatus((s) => (s === "connected" ? "reconnecting" : "connecting"));
      try {
        const conn = await openConnection();
        if (!mountedRef.current) {
          // Unmounted mid-handshake: dispose the socket instead of leaking it.
          disconnect(conn);
          return null;
        }
        connRef.current = conn;
        setDeviceName(conn.device.name);
        setStatus("connected");
        onConnectionLost(conn, () => {
          // Only react to drops of the connection that's still active; a stale
          // connection's callback (incl. the one our own disconnect triggers)
          // must not clobber a newer live connection.
          if (connRef.current === conn) {
            connRef.current = null;
            setStatus("disconnected");
          }
        });
        return conn;
      } catch (error) {
        if (mountedRef.current) {
          setStatus(error instanceof NotPairedError ? "not-paired" : "disconnected");
          await showErrorToast(error);
        }
        return null;
      } finally {
        establishingRef.current = null;
      }
    })();

    establishingRef.current = attempt;
    return attempt;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void establish();
    return () => {
      mountedRef.current = false;
      // Null the ref before disconnecting so the lost-callback's identity check
      // fails and we don't setState on the unmounted component.
      const conn = connRef.current;
      connRef.current = null;
      if (conn) disconnect(conn);
    };
  }, [establish]);

  /** The live connection, opening one if needed. Null when it couldn't be opened (already toasted). */
  const getConnection = useCallback(
    async (): Promise<AppleTVConnection | null> => connRef.current ?? (await establish()),
    [establish],
  );

  /** Run an action against the live connection; failures surface as toasts. */
  const run = useCallback(
    async (action: (conn: AppleTVConnection) => Promise<void>): Promise<void> => {
      const conn = await getConnection();
      if (!conn) return;
      try {
        await action(conn);
      } catch (error) {
        await showErrorToast(error);
      }
    },
    [getConnection],
  );

  const reconnect = useCallback(async () => {
    await establish();
  }, [establish]);

  return { status, deviceName, getConnection, run, reconnect };
}
