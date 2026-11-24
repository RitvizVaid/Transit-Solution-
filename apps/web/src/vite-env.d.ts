/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_GEOCODER_URL?: string;
  readonly VITE_MAP_STYLE?: string;
  /** City id from src/city.ts (default: delhi). */
  readonly VITE_CITY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
