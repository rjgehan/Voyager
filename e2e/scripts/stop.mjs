// Stops the backend (and Vite) that `npm run reset` started, by the PIDs it recorded.
import { stopRecorded } from './stack.mjs';

await stopRecorded();
console.log('Stopped.');
