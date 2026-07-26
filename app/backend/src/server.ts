import { app } from './app.js';
import { env } from './config/env.js';

app.listen(env.port, () => {
  console.log(`Program automation backend listening on http://localhost:${env.port}`);
});
