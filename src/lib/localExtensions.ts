/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): a slot for one person's own extension, kept out of git.
 * `ovis-local/client` is client/index.tsx in OVIS_LOCAL_DIR when the build is given that variable and
 * the file exists (vite.config.ts), else localExtensionsStub.ts, which extends nothing: a build without
 * it runs as before. The extension imports Ovis's own modules as `ovis-src/…`.
 */
import type { ComponentType } from "react";
import type { Terminal } from "@xterm/xterm";
import extensions from "ovis-local/client";
import type { PhoneKeysProps } from "../components/PhoneKeys.tsx";

export interface LocalPhoneKeysProps extends PhoneKeysProps {
  /** the pane's terminal: what is typed or pasted through it goes the way the keyboard's does (gated, drafted) */
  terminal: Terminal | null;
  paneId: string;
  machineId: string;
}

export interface LocalExtensions {
  /** in place of PhoneKeys on a touch screen */
  PhoneKeys?: ComponentType<LocalPhoneKeysProps>;
  /** once a pane's terminal is open: options and handlers of its own; what it returns undoes them */
  terminal?: (term: Terminal) => (() => void) | void;
  /** the double tap that raises or puts away the soft keyboard (useDoubleTapKeyboard.ts) */
  doubleTapMs?: number;
}

export const local: LocalExtensions = extensions;
