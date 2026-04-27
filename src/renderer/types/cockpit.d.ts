export {};

declare global {
  interface Window {
    cockpit?: {
      pickFolder: () => Promise<string | null>;
    };
  }
}
