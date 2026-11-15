export interface IpcSenderEvent {
  sender: {
    id: number;
    mainFrame: unknown;
  };
  senderFrame: unknown;
}

/**
 * Privileged IPC is only accepted from a known top-level window or toolbar
 * webContents. Dashboard pages, link windows and subframes are not trusted.
 */
export function isTrustedIpcSender(
  event: IpcSenderEvent,
  trustedSenders: ReadonlySet<number>,
): boolean {
  return (
    trustedSenders.has(event.sender.id) &&
    event.senderFrame !== null &&
    event.senderFrame === event.sender.mainFrame
  );
}
