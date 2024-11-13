import Redis from "ioredis";
import { Queue } from "bullmq";
import dotenv from "dotenv";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL!;
console.log("Redis URL:", REDIS_URL);

const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const pulumiQueue = new Queue("importQueue", {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
  },
});

const jobData = {
  instance_provider: process.env.INSTANCE_PROVIDER,
  region: process.env.REGION,
  instance_name: process.env.INSTANCE_NAME,
  accessKey: process.env.ACCESS_KEY,
  secretKey: process.env.SECRET_KEY,
  model_repository_name: process.env.MODEL_REPOSITORY,
  github_url: process.env.GITHUB,
  sessionToken: {
    value: process.env.SESSION_TOKEN!,
  },
  environmentVariables: [
    { key: "DB_HOST", value: "localhost" },
    { key: "DB_PORT", value: "5432" },
    { key: "API_KEY", value: "thisissecretkey" },
  ],
  id: process.env.DEPLOYMENT_ID,
  action: "deploy",
};

pulumiQueue
  .add("deploy", jobData)
  .then((job) => {
    console.log("Job added successfully:", job.id);
  })
  .catch((err) => {
    console.error("Error adding job:", err);
  });

console.log("Job data sent to queue with ID:", process.env.DEPLOYMENT_ID);
