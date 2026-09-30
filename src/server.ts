import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const envConfig = loadConfig();
const app = buildApp(envConfig);

const start = async () => {
  try {
    await app.listen({ port: envConfig.PORT, host: envConfig.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

void start();
