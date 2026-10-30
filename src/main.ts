import * as core from '@actions/core';
import { TrueNASClient, type JSONRPCResponse } from 'truenas-client';

const JOB_POLL_MS = 2000;

export async function run(): Promise<void> {
  try {
    // Get inputs from GitHub Actions
    const host: string = core.getInput('host', { required: true });
    const apiKey: string = core.getInput('api-key', { required: true });
    const apiMethod: string = core.getInput('api-method', { required: true });
    const parametersInput: string = core.getInput('parameters');
    const jobTimeoutInput: string = core.getInput('job-timeout') || '600';

    // Log inputs for debugging (mask API key)
    core.info(`Connecting to TrueNAS at: ${host}`);
    core.info(`Executing method: ${apiMethod}`);

    // Parse parameters if provided, default to empty array
    let params: any = [];
    if (parametersInput && parametersInput.trim() !== '') {
      try {
        params = JSON.parse(parametersInput);
        core.info(`Parameters parsed successfully: ${JSON.stringify(params)}`);
      } catch (parseError: unknown) {
        const message = parseError instanceof Error ? parseError.message : 'Unknown parsing error';
        core.error(`Failed to parse parameters as JSON: ${message}`);
        throw parseError;
      }
    } else {
      core.info('No parameters provided, using empty array');
    }

    // Create TrueNAS client instance
    const client = new TrueNASClient(host, apiKey);

    let result: unknown;
    if (apiMethod === 'core.job_wait') {
      // core.job_wait is itself a job: sent over JSON-RPC it returns a new job id and
      // waits for nothing. So the action waits here instead, polling the job.
      const jobId = Array.isArray(params) ? params[0] : undefined;
      if (!Number.isInteger(jobId)) {
        throw new Error(`core.job_wait needs a job id as its only parameter, got ${JSON.stringify(params)}`);
      }
      const jobTimeoutSeconds = Number(jobTimeoutInput);
      if (!Number.isFinite(jobTimeoutSeconds) || jobTimeoutSeconds <= 0) {
        throw new Error(`job-timeout must be a positive number of seconds, got "${jobTimeoutInput}"`);
      }
      result = await waitForJob(client, jobId, jobTimeoutSeconds * 1000);
    } else {
      // Send the API request
      core.info(`Sending API request...`);
      const response: JSONRPCResponse = await client.sendRequest(apiMethod, params, );

      // Check for errors in the response
      if (response.error) {
        core.error(`TrueNAS API Error ${response.error.code}: ${response.error.message}`);
        if (response.error.data) {
          core.error(`Error data: ${JSON.stringify(response.error.data)}`);
        }
        throw new Error(`TrueNAS API returned error: ${response.error.message}`);
      }
      result = response.result;
    }

    // Success - set output and log result
    const resultJson: string = JSON.stringify(result);

    const preview = resultJson.length > 200
      ? `${resultJson.substring(0, 200)}...`
      : resultJson;
    core.info(`API call successful. Result: ${preview}`);
    core.setOutput('result', resultJson);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
}

// Polls the job over one login (TrueNAS rate-limits logins) until it finishes,
// and returns its result. Throws if the job fails, is aborted or outlives timeoutMs.
async function waitForJob(client: TrueNASClient, jobId: number, timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';
  core.info(`Waiting up to ${timeoutMs / 1000}s for job ${jobId}...`);

  await client.connect();
  try {
    while (true) {
      // get: true fails with MatchNotFound when no such job is visible to this key
      const response: JSONRPCResponse = await client.call('core.get_jobs', [[['id', '=', jobId]], { get: true }]);
      if (response.error) {
        throw new Error(`core.get_jobs failed for job ${jobId}: ${response.error.message}`);
      }
      const job = response.result;

      const status = `${job.state}${job.progress?.description ? `: ${job.progress.description}` : ''}`;
      if (status !== lastStatus) {
        core.info(`Job ${jobId} (${job.method}) ${status}`);
        lastStatus = status;
      }

      if (job.state === 'SUCCESS') {
        return job.result;
      }
      if (job.state === 'FAILED' || job.state === 'ABORTED') {
        if (job.logs_excerpt) {
          core.error(`Job ${jobId} logs:\n${job.logs_excerpt}`);
        }
        throw new Error(`Job ${jobId} (${job.method}) ${job.state}: ${job.error ?? 'no error message'}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`Job ${jobId} (${job.method}) still ${job.state} after ${timeoutMs / 1000}s; it keeps running on TrueNAS`);
      }
      await new Promise(resolve => setTimeout(resolve, JOB_POLL_MS));
    }
  } finally {
    client.close();
  }
}
