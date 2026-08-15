/// <reference types="vite/client" />

import type { Ns3hApi } from '@shared/api.js';

declare global {
  interface Window {
    ns3h: Ns3hApi;
  }
}

export {};
