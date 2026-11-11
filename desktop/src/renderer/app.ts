interface TtmdBridge {
  version: string;
}

declare global {
  interface Window {
    ttmd?: TtmdBridge;
  }
}

const version = document.querySelector<HTMLElement>("[data-version]");
if (version) {
  version.textContent = window.ttmd?.version ?? "dev";
}

export {};
