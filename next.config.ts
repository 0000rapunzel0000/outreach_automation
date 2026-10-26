import type { NextConfig } from "next";

const config: NextConfig = {
  // Baileys and pg-boss are worker-only; keep them out of the web bundle.
  serverExternalPackages: ["baileys", "pg-boss", "@prisma/client"],
};

export default config;
