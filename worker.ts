import { Worker } from "bullmq";
import Redis from "ioredis";
import dotenv from "dotenv";
import { LocalWorkspace, InlineProgramArgs } from "@pulumi/pulumi/automation";
import { pulumiProgram } from "./pulumiProgram.ts";
import runStack from "./runStack.ts";
import fetch from "node-fetch";
import { saveLog } from "./utils/saveLog.ts";

dotenv.config();

export type JobData = {
  model_repository_name?: string;
  instance_provider: string;
  region: string;
  instance_name: string;
  accessKey: string;
  secretKey: string;
  id: string;
  sessionToken: {
    value: string;
  };
  action?: "start" | "stop" | "deploy" | "restart";
  instanceId?: string;
  instance_id?: string;
  publicIp?: string;
  output?: string;
  github_url?: string;
  environmentVariables?: { key: string; value: string }[];
  ansibleOutput?: string;
};

const COMPLETED_ENDPOINT = process.env.COMPLETED_ENDPOINT!;
const FAILED_ENDPOINT = process.env.FAILED_ENDPOINT!;
const COMPLETED_ENDPOINT_APP = process.env.COMPLETED_ENDPOINT_APP!;
const FAILED_ENDPOINT_APP = process.env.FAILED_ENDPOINT_APP!;

console.log("Starting worker...");

const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  tls: {},
});

const worker = new Worker(
  "importQueue",
  async (job) => {
    const jobData = job.data as JobData;
    console.log("Received job data:", jobData);

    try {
      const result = await runStack(jobData);
      console.log("Job result:", result);
      // await saveLog(`Job result: ${JSON.stringify(result)}`, result.model_id);

      jobData.sessionToken = result.sessionToken;
      jobData.instanceId = result.instanceId;
      jobData.publicIp = result.publicIp;
      jobData.output = result.ansibleOutput;

      return result;
    } catch (error) {
      console.error("Error in job processing:", error);
      // await saveLog(`Error in job processing: ${error.message}`, jobData.id);
      throw error;
    }
  },
  { connection }
);

worker.on("completed", async (job) => {
  const jobData = job.data as JobData;
  const sessionToken = jobData.sessionToken?.value || jobData.sessionToken;
  let instanceStatus;

  if (jobData.action === "start" || jobData.action === "deploy") {
    instanceStatus = "running";
  } else if (jobData.action === "stop") {
    instanceStatus = "stopped";
  }

  const requestBody = {
    ...jobData,
    failed: false,
    status: instanceStatus,
    instanceId: jobData.instanceId,
    publicIp: jobData.publicIp,
    environmentVariables: jobData.environmentVariables,
  };

  const completedEndpoint =
    jobData.model_repository_name === "slashml/app-deployment"
      ? COMPLETED_ENDPOINT_APP
      : COMPLETED_ENDPOINT;

  try {
    await fetch(completedEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(requestBody),
    });
    console.log(`Job ${job.id} completed and sent to endpoint.`);
  } catch (err) {
    console.error(`Error sending completion data for job ${job.id}:`, err);
  }
});

worker.on("failed", async (job, err) => {
  const jobData = job?.data as JobData;
  const sessionToken = jobData.sessionToken?.value || jobData.sessionToken;
  const failedEndpoint =
    jobData.model_repository_name === "slashml/app-deployment"
      ? FAILED_ENDPOINT_APP
      : FAILED_ENDPOINT;

  // await saveLog(`Job ${job?.id} failed with error: ${err.message}`, jobData.id);

  try {
    await fetch(failedEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        ...jobData,
        failed: true,
      }),
    });
    console.log(`Job ${job?.id} failure logged and sent to endpoint.`);
  } catch (fetchError) {
    console.error(`Error sending failure data for job ${job?.id}:`, fetchError);
  }
});

console.log("Worker is running...");
