import {
  APIKEY_PROVIDERS,
  FREE_APIKEY_PROVIDER_IDS,
  LOCAL_PROVIDERS,
  NOAUTH_PROVIDERS,
} from "../../src/shared/constants/providers.js";
import { createProviderConnection } from "../../src/models/index.js";
import { randomUUID } from "crypto";

async function run() {
  const allProviders = [
    ...Object.keys(APIKEY_PROVIDERS),
    ...Object.keys(LOCAL_PROVIDERS),
    ...Object.keys(NOAUTH_PROVIDERS),
    ...Array.from(FREE_APIKEY_PROVIDER_IDS),
  ];

  // Deduplicate
  const uniqueProviders = [...new Set(allProviders)];

  console.log(`Found ${uniqueProviders.length} unique providers. Adding...`);

  for (const provider of uniqueProviders) {
    try {
      await createProviderConnection({
        id: randomUUID(),
        provider: provider,
        authType: "apikey",
        name: `${provider} test connection`,
        apiKey: `test-key-${provider}-${Date.now()}`,
      });
      console.log(`✅ Added ${provider}`);
    } catch (e) {
      console.log(`❌ Failed to add ${provider}: ${e.message}`);
    }
  }

  console.log("Done adding providers.");
}

run().catch(console.error);
