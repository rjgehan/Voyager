// Fills the scratch vault that `npm run reset` started with a lived-in vault (lib/seed.ts).
// Run it on a fresh reset: it refuses a vault that is already seeded.
import { API_URL, WEB_URL } from '../lib/api.ts';
import { SECOND_VAULT, isSeeded, seedVault } from '../lib/seed.ts';

const health = await fetch(`${API_URL}/actuator/health`).catch(() => null);
if (!health?.ok) {
  console.error(`The backend is not answering at ${API_URL}. Start it with: npm run reset`);
  process.exit(1);
}
if (await isSeeded()) {
  console.error('This vault is already seeded. Start from an empty one with: npm run reset');
  process.exit(1);
}
await seedVault((s) => console.log(`Seeding: ${s}...`));
console.log(`Seeded. Open ${WEB_URL} (and ${WEB_URL}/v/${SECOND_VAULT}/ for the second vault).`);
