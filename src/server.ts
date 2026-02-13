import { getEnv } from "./config/env.js";
import app from "./app.js";

const env = getEnv();

app.listen(env.PORT, () => {
  console.log(`voice-agent server listening at ${env.PUBLIC_BASE_URL}`);
});
