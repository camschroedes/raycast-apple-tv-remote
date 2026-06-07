import { useEffect, useRef, useState } from "react";
import { Action, ActionPanel, Form, Toast, showToast, useNavigation, Icon, Detail } from "@raycast/api";
import { getSelectedDeviceOrNull } from "./lib/devices";
import { pairNowPlaying } from "./lib/nowplaying";
import { AppleTVDevice } from "@bharper/atv-js";

/**
 * AirPlay pairing for now-playing. This is a SECOND PIN, separate from the
 * remote-control pairing — Apple gates playback state behind AirPlay's HAP
 * pairing. We start pair-setup on mount (the TV shows a PIN), then collect it.
 */
export default function NowPlayingSetup() {
  const { pop } = useNavigation();
  const [device, setDevice] = useState<AppleTVDevice | null | undefined>(undefined);
  const [pinReady, setPinReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pinResolver = useRef<((pin: string) => void) | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const dev = await getSelectedDeviceOrNull();
      setDevice(dev);
      if (!dev || startedRef.current) return;
      startedRef.current = true;

      pairNowPlaying(dev, () => {
        // The TV is now showing its PIN — let the user type it.
        setPinReady(true);
        return new Promise<string>((resolve) => (pinResolver.current = resolve));
      })
        .then(async () => {
          await showToast({ style: Toast.Style.Success, title: "Now Playing is set up" });
          pop();
        })
        .catch(async (err) => {
          await showToast({
            style: Toast.Style.Failure,
            title: "AirPlay pairing failed",
            message: err instanceof Error ? err.message : String(err),
          });
          setSubmitting(false);
          setPinReady(false);
          startedRef.current = false;
        });
    })();
  }, []);

  if (device === undefined) {
    return <Detail isLoading markdown="Connecting to your Apple TV…" />;
  }
  if (device === null) {
    return (
      <Detail
        markdown={
          "## No Apple TV set up\n\nRun **Set up Apple TV** first to pair the remote, then come back to enable Now Playing."
        }
      />
    );
  }

  return (
    <Form
      isLoading={!pinReady || submitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Enable Now Playing"
            icon={Icon.Play}
            onSubmit={(values: { pin: string }) => {
              const pin = (values.pin || "").trim();
              if (!/^\d{4}$/.test(pin)) {
                showToast({ style: Toast.Style.Failure, title: "Enter the 4-digit PIN from your TV" });
                return;
              }
              setSubmitting(true);
              pinResolver.current?.(pin);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title={device.name}
        text={
          pinReady
            ? "A 4-digit AirPlay PIN should now be on your TV (this is separate from the remote PIN). Enter it below to enable Now Playing."
            : "Starting AirPlay pairing… a PIN will appear on your TV shortly."
        }
      />
      <Form.TextField id="pin" title="AirPlay PIN" placeholder="1234" autoFocus />
    </Form>
  );
}
