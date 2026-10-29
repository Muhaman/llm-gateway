import { config } from "dotenv";
import { Redis } from "ioredis";
import { createKey } from "../src/auth/keys.js";

config({ quiet: true });

const [name, rpm = "60", dailyTokens = "1000000"] = process.argv.slice(2);
if (!name) {
  process.stderr.write("usage: npm run create-key -- <name> [rpm=60] [dailyTokens=1000000]\n");
  process.exit(1);
}
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  process.stderr.write("REDIS_URL is not set\n");
  process.exit(1);
}

const redis = new Redis(redisUrl);
try {
  const key = await createKey(redis, { name, rpm: Number(rpm), dailyTokens: Number(dailyTokens) });
  process.stdout.write(`${key}\n`);
} finally {
  await redis.quit();
}
