import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const provider = new aws.Provider("aws-provider", {
  region: "eu-west-3", // Specify the desired region here
});

const size = "t2.micro"; // t2.micro is available in the AWS free tier

const group = new aws.ec2.SecurityGroup("webserver-secgrp", {
  ingress: [
    { protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"] },
  ],
});

const server = new aws.ec2.Instance("webserver-www", {
  instanceType: size,
  vpcSecurityGroupIds: [group.id], // reference the security group resource above
  ami: "ami-0fda19674ff597992",
});

export const publicIp = server.publicIp;
export const publicHostName = server.publicDns;
