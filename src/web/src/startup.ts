import { preloadAuthStatus } from "./services/authStatus";

// Start the cookie-backed session check while the application scripts and styles download.
void preloadAuthStatus().then(status => {
  if (status !== "unavailable" && status.phase === "ready") void import("./app/Workspace").catch(() => {});
});
void import("./main");
