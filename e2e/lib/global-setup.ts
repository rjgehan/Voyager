import { API_URL, MODE, WEB_URL } from './api';

/** Fails fast, with what to do, when the scratch stack is not running. */
export default async function globalSetup() {
  const health = await fetch(`${API_URL}/actuator/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`The backend is not answering at ${API_URL}. Start the scratch stack with: npm run reset`);
  }
  const web = await fetch(WEB_URL).catch(() => null);
  if (!web?.ok) {
    throw new Error(`The app is not answering at ${WEB_URL} (mode: ${MODE}). Start it with: npm run reset`);
  }
}
