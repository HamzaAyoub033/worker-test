import { LocalWorkspace, InlineProgramArgs } from "@pulumi/pulumi/automation";
import { JobData } from "./worker.ts";
import { pulumiProgram } from "./pulumiProgram.ts";
import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

import {
  EC2Client,
  StartInstancesCommand,
  StopInstancesCommand,
  DescribeInstancesCommand,
  InstanceStateName,
} from "@aws-sdk/client-ec2";
import { saveLog } from "./utils/saveLog.ts";

const createEC2Client = (
  region: string,
  accessKey: string,
  secretKey: string
) => {
  return new EC2Client({
    region: region,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  });
};

const startInstance = async (data: JobData) => {
  if (!data.instance_id) {
    throw new Error("Instance ID is required");
  }
  const client = createEC2Client(data.region, data.accessKey, data.secretKey);
  const sessionToken = data.sessionToken;
  const newInstanceId = data.instance_id;
  const model_id = data.id;

  console.log("Starting instance with data:", data);

  const instanceId = newInstanceId;

  const startCommand = new StartInstancesCommand({ InstanceIds: [instanceId] });

  let publicIp: string | undefined;
  let state: string | undefined;

  try {
    await client.send(startCommand);
    console.log(`Start command sent for instance ${instanceId}`);
    // saveLog(`Start command sent for instance ${instanceId}`, data.id);

    // Wait for the instance to start and get the public IP
    while (true) {
      const describeCommand = new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      });
      const response = await client.send(describeCommand);

      state = response.Reservations?.[0]?.Instances?.[0]?.State?.Name;
      publicIp = response.Reservations?.[0]?.Instances?.[0]?.PublicIpAddress;

      if (state === InstanceStateName.running && publicIp) {
        console.log(`Instance ${instanceId} is running with IP ${publicIp}`);
        // saveLog(
        //   `Instance ${instanceId} is running with IP ${publicIp}`,
        //   data.id
        // );
        break;
      } else if (state === InstanceStateName.pending) {
        console.log(`Instance ${instanceId} is still starting...`);
        // saveLog(`Instance ${instanceId} is still starting...`, data.id);
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before checking again
      } else if (state === InstanceStateName.stopped) {
        console.log(`Instance ${instanceId} is paused`);
        // saveLog(`Instance ${instanceId} is paused`, data.id);
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 5 seconds before checking again
      } else {
        // saveLog(`Can't start an instance from ${state} state`, data.id);
        throw new Error(`Can't start an instance from ${state} state`);
      }
    }
  } catch (error) {
    console.error(`Error starting instance ${instanceId}:`, error);
    // saveLog(`Error starting instance ${instanceId}: ${error}`, data.id);
    throw error;
  }

  const args: InlineProgramArgs = {
    stackName: `${process.env.STACK_ENV}-5-${data.id}`,
    projectName: "inlineNode",
    program: async () => await pulumiProgram(data),
  };

  // await saveLog(`Creating or selecting stack: ${args.stackName}`, data.id);
  const stack = await LocalWorkspace.selectStack(args);

  console.info("refreshing stack...");
  await stack.refresh({ onOutput: console.info });
  console.info("refresh complete");

  console.info("updating stack...");
  const upRes = await stack.up({ onOutput: console.info });
  console.log(
    `update summary: \n${JSON.stringify(
      upRes.summary.resourceChanges,
      null,
      4
    )}`
  );
  console.log("Waiting for ansible...");
  const ansibleOutput = upRes.outputs?.ansibleOutput?.value;

  console.log("Returning...");
  return {
    instanceId: instanceId,
    sessionToken: sessionToken,
    publicIp: publicIp,
    state: state,
    model_id: model_id,
    logs: [
      `Instance ${instanceId} started successfully. Public IP: ${publicIp}`,
    ],
    ansibleOutput: ansibleOutput,
  };
};

const stopInstance = async (data: JobData) => {
  if (!data.instance_id) {
    throw new Error("Instance ID is required");
  }
  const client = createEC2Client(data.region, data.accessKey, data.secretKey);
  const newInstanceId = data.instance_id;

  console.log("Stopping instance with data:", data);
  const sessionToken = data.sessionToken;

  const instanceId = newInstanceId;
  const model_id = data.id;

  const stopCommand = new StopInstancesCommand({ InstanceIds: [instanceId] });

  try {
    await client.send(stopCommand);
    console.log(`Stop command sent for instance ${instanceId}`);
    // saveLog(`Stop command sent for instance ${instanceId}`, data.id);

    // Wait for the instance to stop
    while (true) {
      const describeCommand = new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      });

      const response = await client.send(describeCommand);

      const state = response.Reservations?.[0]?.Instances?.[0]?.State?.Name;

      if (state === InstanceStateName.stopped) {
        console.log(`Instance ${instanceId} has stopped`);
        // saveLog(`Instance ${instanceId} has stopped`, data.id);
        break;
      } else if (state === InstanceStateName.stopping) {
        console.log(`Instance ${instanceId} is still stopping...`);
        // saveLog(`Instance ${instanceId} is still stopping...`, data.id);
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before checking again
      } else if (state === InstanceStateName.running) {
        console.log(`Instance ${instanceId} is running`);
        // saveLog(`Instance ${instanceId} is running`, data.id);
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 5 seconds before checking again
      } else {
        // saveLog(`Can't stop an instance form ${state} state`, data.id);
        throw new Error(`Can't stop an instance form ${state} state`);
      }
    }
  } catch (error) {
    console.error(`Error stopping instance ${instanceId}:`, error);
    throw error;
  }

  return {
    instanceId: instanceId,
    sessionToken: sessionToken,
    logs: [`Instance ${instanceId} stopped successfully.`],
    model_id: model_id,
  };
};
const restartInstance = async (data: JobData) => {
  if (!data.instance_id) {
    throw new Error("Instance ID is required");
  }

  // Log environment variables at the start
  console.log("Environment variables for restart:", data.environmentVariables);
  // saveLog(
  //   `Restarting with env vars: ${JSON.stringify(data.environmentVariables)}`,
  //   data.id
  // );

  const client = createEC2Client(data.region, data.accessKey, data.secretKey);
  const sessionToken = data.sessionToken;
  const instanceId = data.instance_id;
  const model_id = data.id;

  // Add SSH check function
  const waitForSSH = async (ip: string): Promise<void> => {
    const maxAttempts = 20;
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        await new Promise((resolve, reject) => {
          const { exec } = require("child_process");
          // Add -o ConnectionAttempts=1
          exec(
            `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o ConnectionAttempts=1 -o UserKnownHostsFile=/dev/null -i aws-faizank-kp.pem ubuntu@${ip} "echo 'SSH Ready'"`,
            (error: any, stdout: string, stderr: string) => {
              if (error) {
                reject(error);
              } else {
                resolve(stdout);
              }
            }
          );
        });
        console.log("SSH is available");
        return;
      } catch (error) {
        attempts++;
        console.log(
          `Waiting for SSH to become available... Attempt ${attempts}/${maxAttempts}`
        );
        await new Promise((resolve) => setTimeout(resolve, 15000)); // Increase wait time
      }
    }
    throw new Error("SSH never became available");
  };

  try {
    // Stop the instance
    const stopCommand = new StopInstancesCommand({ InstanceIds: [instanceId] });
    await client.send(stopCommand);
    // saveLog(`Stop command sent for instance restart ${instanceId}`, data.id);

    // Wait for instance to stop
    while (true) {
      const describeCommand = new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      });
      const response = await client.send(describeCommand);
      const state = response.Reservations?.[0]?.Instances?.[0]?.State?.Name;

      if (state === InstanceStateName.stopped) {
        console.log(`Instance ${instanceId} has stopped for restart`);
        // saveLog(`Instance ${instanceId} has stopped for restart`, data.id);
        break;
      } else if (state === InstanceStateName.stopping) {
        console.log(`Instance ${instanceId} is still stopping for restart...`);
        // saveLog(
        //   `Instance ${instanceId} is still stopping for restart...`,
        //   data.id
        // );
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        console.log(`Waiting for instance to stop... Current state: ${state}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    // Wait before starting
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Start the instance
    const startCommand = new StartInstancesCommand({
      InstanceIds: [instanceId],
    });
    await client.send(startCommand);
    // saveLog(`Start command sent for instance restart ${instanceId}`, data.id);

    let publicIp: string | undefined;
    let state: string | undefined;

    // Wait for instance to start
    while (true) {
      const describeCommand = new DescribeInstancesCommand({
        InstanceIds: [instanceId],
      });
      const response = await client.send(describeCommand);

      state = response.Reservations?.[0]?.Instances?.[0]?.State?.Name;
      publicIp = response.Reservations?.[0]?.Instances?.[0]?.PublicIpAddress;

      if (state === InstanceStateName.running && publicIp) {
        console.log(`Instance ${instanceId} is running with IP ${publicIp}`);
        // saveLog(
        //   `Instance ${instanceId} is running with IP ${publicIp}`,
        //   data.id
        // );
        break;
      } else if (state === InstanceStateName.pending) {
        console.log(
          `Instance ${instanceId} is still starting after restart...`
        );
        // saveLog(
        //   `Instance ${instanceId} is still starting after restart...`,
        //   data.id
        // );
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        console.log(`Waiting for instance to start... Current state: ${state}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    // Wait for SSH to become available
    if (publicIp) {
      console.log("Waiting for SSH to become available...");
      // saveLog("Waiting for SSH to become available...", data.id);
      await waitForSSH(publicIp);
    }

    // Additional wait to ensure instance is fully ready
    await new Promise((resolve) => setTimeout(resolve, 30000));

    // Update stack with new environment variables
    const args: InlineProgramArgs = {
      stackName: `${process.env.STACK_ENV}-5-${data.id}`,
      projectName: "inlineNode",
      program: async () =>
        await pulumiProgram({
          ...data,
          environmentVariables: data.environmentVariables,
        }),
    };

    await saveLog(
      `Updating stack with new environment variables: ${args.stackName}`,
      data.id
    );

    const stack = await LocalWorkspace.selectStack(args);

    console.info("refreshing stack...");
    await stack.refresh({ onOutput: console.info });
    console.info("refresh complete");

    console.info("updating stack with new environment variables...");
    const upRes = await stack.up({ onOutput: console.info });
    console.log(
      `update summary: \n${JSON.stringify(
        upRes.summary.resourceChanges,
        null,
        4
      )}`
    );

    // Verify environment variables were updated
    if (publicIp) {
      try {
        const { exec } = require("child_process");
        await new Promise((resolve, reject) => {
          exec(
            `ssh -o StrictHostKeyChecking=no -i aws-faizank-kp.pem ubuntu@${publicIp} "cat /etc/environment"`,
            (error: any, stdout: string, stderr: string) => {
              if (error) {
                console.error("Error verifying environment variables:", error);
                // saveLog(
                //   `Error verifying environment variables: ${error}`,
                //   data.id
                // );
              } else {
                console.log("Current environment variables:", stdout);
                // saveLog(`Current environment variables: ${stdout}`, data.id);
              }
              resolve(stdout);
            }
          );
        });
      } catch (error) {
        console.error("Failed to verify environment variables:", error);
        // saveLog(`Failed to verify environment variables: ${error}`, data.id);
      }
    }

    const ansibleOutput = upRes.outputs?.ansibleOutput?.value;

    return {
      instanceId,
      sessionToken,
      publicIp,
      state,
      model_id,
      environmentVariables: data.environmentVariables,
      logs: [
        `Instance ${instanceId} restarted successfully with updated environment variables. Public IP: ${publicIp}`,
      ],
      ansibleOutput,
    };
  } catch (error) {
    console.error(`Error restarting instance ${instanceId}:`, error);
    // saveLog(`Error restarting instance ${instanceId}: ${error}`, data.id);
    throw error;
  }
};

const runStack = async (data: JobData) => {
  if (data.action === "start") {
    // await saveLog(`Starting instance: ${data.instance_id}`, data.id);
    return await startInstance(data);
  } else if (data.action === "stop") {
    // await saveLog(`Stopping instance: ${data.instance_id}`, data.id);
    return await stopInstance(data);
  } else if (data.action === "restart") {
    // await saveLog(
    //   `Restarting instance with new environment variables: ${data.instance_id}`,
    //   data.id
    // );
    return await restartInstance(data);
  } else {
    const logs = [];
    const args: InlineProgramArgs = {
      stackName: `${process.env.STACK_ENV}-5-${data.id}`,
      projectName: "inlineNode",
      program: async () => await pulumiProgram(data),
    };
    // await saveLog(`Creating or selecting stack: ${args.stackName}`, data.id);
    const stack = await LocalWorkspace.createOrSelectStack(args);
    // const logs = await pulumiProgram(data);
    // for (const log of logs) {
    //   await saveLog(log, data.instance_id);
    // }

    console.info("successfully initialized stack");
    console.info("installing plugins...");
    await stack.workspace.installPlugin("aws", "v4.0.0");
    console.info("plugins installed");
    console.info("setting up config");
    await stack.setConfig("aws:region", { value: data.region });
    console.info("config set", data.region);
    // console.info('refreshing stack...');
    await stack.refresh({ onOutput: console.info });
    console.info("refresh complete");

    console.info("updating stack...");
    const upRes = await stack.up({ onOutput: console.info });
    console.log(
      `update summary: \n${JSON.stringify(
        upRes.summary.resourceChanges,
        null,
        4
      )}`
    );

    const instanceId = upRes.outputs?.instanceId?.value;
    const publicIp = upRes.outputs?.publicIp?.value;
    const publicHostName = upRes.outputs?.publicHostName?.value;
    const model_id = data.id;

    console.log(`public IP: ${publicIp}`);
    console.log(`public DNS: ${publicHostName}`);
    console.log(`instance ID: ${instanceId}`);

    return {
      // outputs: upRes.outputs,
      ansibleOutput: upRes.outputs?.ansibleOutput?.value,
      sessionToken: data.sessionToken,
      instanceId,
      publicIp,
      logs: logs,
      model_id: model_id,
    };
  }
};

export default runStack;
