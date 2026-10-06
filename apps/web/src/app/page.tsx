import { DoodleRushClient } from "@/components/DoodleRushClient";
import { connection } from "next/server";

export default async function HomePage() {
  // Per-request CSP nonces require dynamic rendering; this page has no static user-specific data.
  await connection();
  return <DoodleRushClient />;
}
