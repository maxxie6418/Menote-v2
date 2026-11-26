import type { AuthUser } from "@menote/shared";
import { MemoCaptureProvider } from "../features/memo";
import { AppShell } from "./AppShell";

export default function Workspace({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  return <MemoCaptureProvider userId={user.id}><AppShell user={user} onLogout={onLogout} /></MemoCaptureProvider>;
}
