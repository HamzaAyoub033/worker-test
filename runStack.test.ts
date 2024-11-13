// write a test for the runStack function
import runStack from "./runStack";
// import describe, it and expect
import { describe, it, expect } from "@jest/globals";

describe("runStackTest", () => {
  it("run Stack execution should return without error", async function () {
    const data = {
      //   region: "us-east-2",
      //   instance_name: "t2.micro",
      //   instance_provider: "aws",
    };

    return runStack(data).then((obj) => {
      expect(obj).not.toBeNull();
      expect(obj).toHaveProperty("publicIp");
      expect(obj).toHaveProperty("publicHostName");
    });
  }, 1000000);
});
