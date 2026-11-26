/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKER_URL?: string;
  readonly VITE_DEV_WORKER_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
