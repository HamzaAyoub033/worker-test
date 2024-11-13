This project spins up an instance in the cloud with the required credentials

### SETUP

- make sure you install terraform
- make sure you install ansible
- git clone the repo
- do npm install
- make sure .env file has COMPLETED_ENDPOINT url
- make sure .env file has FAILED_ENDPOINT url
- make sure .env file has LOG_API_ENDPOINT

### Testing

The main code is inside the runStack.ts file, which uses the pulumiProgram file. Test this file by running the folloeing command:

```bash
npx run worker:deploy
```
