import { create } from 'zustand';

interface PendingPaste {
  text: string;
  resolve: (paste: boolean) => void;
}

interface PasteState {
  pending: PendingPaste | null;
  /** Resolves once the user answers; the terminal awaits this before writing. */
  request: (text: string) => Promise<boolean>;
  respond: (paste: boolean) => void;
}

export const usePaste = create<PasteState>((set, get) => ({
  pending: null,

  request: (text) =>
    new Promise<boolean>((resolve) => {
      set({ pending: { text, resolve } });
    }),

  respond: (paste) => {
    const pending = get().pending;
    set({ pending: null });
    pending?.resolve(paste);
  },
}));
