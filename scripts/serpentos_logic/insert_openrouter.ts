import { createProviderConnection } from "../../src/lib/db/providers.ts";

async function run() {
  const token = process.env.OPENROUTER_API_KEY;
  if (!token) {
    console.log("No token.");
    process.exit(1);
  }
  await createProviderConnection({
    provider: "openrouter",
    authType: "apikey",
    apiKey: token,
    name: "doppler_openrouter",
  });
  console.log("Added provider.");
}

run().catch(console.error);
