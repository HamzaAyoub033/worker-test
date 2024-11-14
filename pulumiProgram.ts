import * as aws from "@pulumi/aws";
import { JobData } from "./worker";
import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";
import * as fs from "fs";
import { saveLog } from "./utils/saveLog";
import * as dotenv from "dotenv";
dotenv.config();

interface EnvVar {
  key: string;
  value: string;
}

export const pulumiProgram = async (data: JobData) => {
  console.log("Pulumi program data:", data);

  const model_id = data.id;
  const envVars = data.environmentVariables;
  const cleanData = Object.fromEntries(
    Object.entries(data).filter(
      ([key]) => !["accessKey", "secretKey"].includes(key)
    )
  );

  saveLog(`Pulumi program data: ${JSON.stringify(cleanData)}`, data.id);
  if (data.environmentVariables) {
    console.log("Processing environment variables:", data.environmentVariables);
    // saveLog(
    //   `Processing environment variables: ${JSON.stringify(
    //     data.environmentVariables
    //   )}`,
    //   data.id
    // );
  }

  const instanceType = data.instance_name;
  if (!instanceType) {
    throw new Error("data.instance_name is not defined in jobData.");
  }

  const keyPairRegionProvider = new aws.Provider("keyPairRegionProvider", {
    region: data.region as aws.Region,
    accessKey: data.accessKey,
    secretKey: data.secretKey,
  });

  // Read the public key from the local file
  const publicKeyContent = fs.readFileSync("aws-faizank-kp.pub", "utf8").trim();

  const keyPairName = "aws-randomcreated-kp";

  // First, try to get the existing key pair
  // const existingKeyPair = pulumi.output(aws.ec2.getKeyPair({
  //   keyName: keyPairName,
  // }, { provider: keyPairRegionProvider }));

  const existingKeyPair = aws.ec2
    .getKeyPair(
      {
        keyName: keyPairName,
      },
      { provider: keyPairRegionProvider }
    )
    .then((result) => {
      if (result) {
        console.log("Existing key pair found:", result.keyName);
        saveLog(`Existing key pair found: ${result.keyName}`, data.id);
      } else {
        console.log("keypiar not found created a new one");
        // saveLog("keypiar not found created a new one", data.id);
        throw new Error("Key pair not found");
      }
    })
    .catch((e) => {
      console.error(e.message);
      console.log("keypiar not found created a new one");
      // saveLog("keypiar not found created a new one", data.id);

      const keyPair = new aws.ec2.KeyPair(
        "aws-faizank",
        {
          keyName: keyPairName,
          publicKey: publicKeyContent,
        },
        { provider: keyPairRegionProvider }
      );
    });

  const group = new aws.ec2.SecurityGroup(
    "webserver-secgrp",
    {
      tags: { Name: "slashml-stuff" },
      ingress: [
        {
          protocol: "tcp",
          fromPort: 22,
          toPort: 22,
          cidrBlocks: ["0.0.0.0/0"],
        },
        {
          protocol: "tcp",
          fromPort: 80,
          toPort: 80,
          cidrBlocks: ["0.0.0.0/0"],
        }, // Allow HTTP traffic
        {
          protocol: "tcp",
          fromPort: 8000,
          toPort: 8000,
          cidrBlocks: ["0.0.0.0/0"],
        }, // Allow HTTP traffic
        {
          protocol: "tcp",
          fromPort: 8501,
          toPort: 8501,
          cidrBlocks: ["0.0.0.0/0"],
        }, // Allow HTTP traffic
        {
          protocol: "tcp",
          fromPort: 8888,
          toPort: 8888,
          cidrBlocks: ["0.0.0.0/0"],
        }, // Allow HTTP traffic
      ],
      // allow all outbound traffic
      egress: [
        { fromPort: 0, toPort: 0, protocol: "-1", cidrBlocks: ["0.0.0.0/0"] },
      ],
    },
    { provider: keyPairRegionProvider }
  );

  // (optional) create a simple web server using the startup script for the instance
  //   const userData = `#!/bin/bash
  // exec > /var/log/user-data.log 2>&1
  // set -x
  // echo "HF_TOKEN='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'" >> /etc/environment`;

  const userData = `#!/bin/bash
  # Remove existing environment variables
  sudo sed -i '/^export/d' /etc/environment
  ${(envVars || [])
    .map(
      ({ key, value }) =>
        `echo "export ${key}='${value}'" | sudo tee -a /etc/environment`
    )
    .join("\n")}
  ${envVars?.length ? "source /etc/environment" : ""}
  `;

  // const keypairs = true;
  // saveLog(`Creating EC2 instance: web-server-www-1`, data.id);

  const keypairs = true;

  let AMI = "ami-09ee1a996ac214ce7";
  console.log("PRINGINT DATA", data?.model_repository_name);
  if (data?.model_repository_name === "slashml/app-deployment") {
    AMI = "ami-069c99ad769be2343";
  }

  const instanceTagName = process.env.INSTANCE_TAG_NAME || "slashml-stuff";
  const server = new aws.ec2.Instance(
    "web-server-www-1",
    {
      tags: { Name: instanceTagName },
      instanceType, // t2.micro is available in the AWS free tier
      vpcSecurityGroupIds: [group.id], // reference the group object above
      // ami: "ami-0862be96e41dcbf74",
      // launchTemplate: {
      //   id: "lt-02b0484b44f074b20", // Replace with your launch template ID
      //   version: "$Latest"  // You can specify a version number or "$Latest"
      //     },
      // if slashml/app-deployment then use ami-069c99ad769be2343
      ami: AMI,
      //ami: "ami-09ee1a996ac214ce7", //nvidia-base us-east-1
      // ami: "ami-02f7f38e06e586791", //nvidia-base us-east-1
      ...(keypairs ? { keyName: "aws-randomcreated-kp" } : {}),
      userData, // start a simple web server
      rootBlockDevice: {
        volumeSize: 128, // Increase root volume size to 20 GiB
      },
    },
    { provider: keyPairRegionProvider }
  );

  saveLog("Running Ansible playbook", data.id);
  // Use the command provider to run Ansible

  const formatEnvVarsForAnsible = (vars: EnvVar[] = []): string => {
    return vars.map(({ key, value }) => `${key}=${value}`).join(" ");
  };

  const envVarsString = formatEnvVarsForAnsible(envVars);
  const updateEnvVars = new command.local.Command(
    "update-env-vars",
    {
      create: pulumi.interpolate`ssh -o StrictHostKeyChecking=no -i aws-faizank-kp.pem ubuntu@${
        server.publicIp
      } "sudo bash -c '> /etc/environment && echo 'PATH=\"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin\"' | sudo tee -a /etc/environment && ${(
        envVars || []
      )
        .map(
          ({ key, value }) =>
            `echo '${key}=\"${value}\"' | sudo tee -a /etc/environment`
        )
        .join(" && ")}'"`,
    },
    { dependsOn: [server] }
  );

  const ansiblePlaybook = new command.local.Command(
    "ansible-playbook",
    {
      create: pulumi.interpolate`ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook -i '${server.publicIp},' -u ubuntu --private-key aws-faizank-kp.pem playbooks/${data.model_repository_name}.yml --extra-vars 'github_repo=${data.github_url} ${envVarsString}' -vv`,
      environment: {
        ANSIBLE_HOST_KEY_CHECKING: "False",
      },
    },
    { dependsOn: [updateEnvVars] }
  );

  updateEnvVars.stdout.apply((stdout) => {
    console.log("Environment variables update output:", stdout);
    // saveLog(`Environment variables update output: ${stdout}`, data.id);
  });

  updateEnvVars.stderr.apply((stderr) => {
    if (stderr) {
      console.error("Environment variables update error:", stderr);
      // saveLog(`Environment variables update error: ${stderr}`, data.id);
    }
  });

  ansiblePlaybook.stdout.apply((stdout) => {
    console.log("Ansible output:", stdout);
    // saveLog(`Ansible output: ${stdout}`, data.id);
  });

  ansiblePlaybook.stderr.apply((stderr) => {
    if (stderr) {
      console.error("Ansible error:", stderr);
      // saveLog(`Ansible error: ${stderr}`, data.id);
    }
  });

  return {
    publicIp: server.publicIp,
    publicHostName: server.publicDns,
    sessionToken: data.sessionToken?.value,
    ansibleOutput: pulumi
      .all([ansiblePlaybook.stdout, updateEnvVars.stdout])
      .apply(([ansible, env]) => `${env}\n${ansible}`),
    instanceId: server.id,
  };
};
