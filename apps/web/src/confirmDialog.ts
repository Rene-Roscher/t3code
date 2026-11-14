import type { ConfirmDialogOptions, ConfirmDialogVariant } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";

export type ConfirmDialogState =
  | { readonly status: "idle" }
  | {
      readonly status: "confirming";
      readonly message: string;
      readonly variant: ConfirmDialogVariant;
      readonly initialFocus: ConfirmDialogOptions["initialFocus"];
    }
  | {
      readonly status: "closing";
      readonly message: string;
      readonly variant: ConfirmDialogVariant;
      readonly initialFocus: ConfirmDialogOptions["initialFocus"];
    };

type PendingConfirmation = {
  readonly message: string;
  readonly variant: ConfirmDialogVariant;
  readonly initialFocus: ConfirmDialogOptions["initialFocus"];
  readonly resolve: (confirmed: boolean) => void;
};

const idleState: ConfirmDialogState = { status: "idle" };
let state: ConfirmDialogState = idleState;
let activeConfirmation: PendingConfirmation | null = null;
let queuedConfirmations: PendingConfirmation[] = [];
const listeners = new Set<() => void>();

// A confirmation requested in the same task as a Ctrl-click (Cmd on macOS) resolves
// without a dialog. Anything that reaches the confirmation later shows the dialog.
let bypassGestureActive = false;

export function noteConfirmBypassGesture(modifierHeld: boolean): void {
  if (!modifierHeld || bypassGestureActive) return;
  bypassGestureActive = true;
  setTimeout(() => {
    bypassGestureActive = false;
  }, 0);
}

const noteClickGesture = (event: MouseEvent) =>
  noteConfirmBypassGesture(isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey);

// Menus can act on pointerup, buttons on click; both run in the gesture's own task.
const GESTURE_EVENTS = ["pointerup", "click"] as const;

function setGestureListeners(listening: boolean): void {
  if (typeof window === "undefined") return;
  for (const type of GESTURE_EVENTS) {
    if (listening) window.addEventListener(type, noteClickGesture, true);
    else window.removeEventListener(type, noteClickGesture, true);
  }
}

function publish(next: ConfirmDialogState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function resolvePendingConfirmations(confirmed: boolean): void {
  activeConfirmation?.resolve(confirmed);
  for (const confirmation of queuedConfirmations) {
    confirmation.resolve(confirmed);
  }
  activeConfirmation = null;
  queuedConfirmations = [];
}

export function readConfirmDialogState(): ConfirmDialogState {
  return state;
}

/**
 * Only themed hosts subscribe, so a subscriber is a mounted host. When the last
 * one leaves, pending confirmations resolve as cancelled.
 */
export function subscribeConfirmDialogHost(listener: () => void): () => void {
  if (listeners.size === 0) setGestureListeners(true);
  listeners.add(listener);
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    setGestureListeners(false);
    resolvePendingConfirmations(false);
    publish(idleState);
  };
}

/** Undefined means no themed host is available. */
export function requestConfirmDialog(
  message: string,
  options?: ConfirmDialogOptions,
): Promise<boolean> | undefined {
  if (bypassGestureActive) return Promise.resolve(true);
  if (listeners.size === 0) return undefined;

  const confirmation = new Promise<boolean>((resolve) => {
    const pending = {
      message,
      variant: options?.variant ?? "default",
      initialFocus: options?.initialFocus,
      resolve,
    } satisfies PendingConfirmation;
    if (activeConfirmation || state.status === "closing") {
      queuedConfirmations.push(pending);
      return;
    }

    activeConfirmation = pending;
    publish({
      status: "confirming",
      message,
      variant: pending.variant,
      initialFocus: pending.initialFocus,
    });
  });

  return confirmation;
}

export function isConfirmDialogActive(): boolean {
  return state.status !== "idle" || activeConfirmation !== null || queuedConfirmations.length > 0;
}

export function respondToConfirmDialog(confirmed: boolean): void {
  if (state.status !== "confirming" || !activeConfirmation) return;

  const confirmation = activeConfirmation;
  activeConfirmation = null;
  confirmation.resolve(confirmed);
  publish({
    status: "closing",
    message: state.message,
    variant: state.variant,
    initialFocus: state.initialFocus,
  });
}

export function completeConfirmDialogClose(): void {
  if (state.status !== "closing") return;

  const next = queuedConfirmations.shift();
  if (!next) {
    publish(idleState);
    return;
  }

  activeConfirmation = next;
  publish({
    status: "confirming",
    message: next.message,
    variant: next.variant,
    initialFocus: next.initialFocus,
  });
}

export function resetConfirmDialogForTests(): void {
  setGestureListeners(false);
  bypassGestureActive = false;
  listeners.clear();
  resolvePendingConfirmations(false);
  publish(idleState);
}
