import { headers } from "next/headers";

// The team. Everyone can see their own pipeline and toggle to "All team".
export const TEAM = ["lucas", "laia", "alba", "naveed", "pari", "nynke"];

// Resolve the current user from the header the middleware sets after
// validating Basic auth. Defaults to "lucas" (open local dev / legacy).
export async function currentUser() {
  try {
    const h = await headers();
    const u = (h.get("x-cd-user") || "").toLowerCase().trim();
    return TEAM.includes(u) ? u : "lucas";
  } catch {
    return "lucas";
  }
}
