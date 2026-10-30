# TrueNAS Scale API Client Action

A Github action to interact with truenas through its JSON-RPC 2.0 websocket api

## Description

`TrueNAS Scale API Client` connects to the TrueNAS WebSocket endpoint, authenticates with the supplied API key, and calls the specified API method. The result of the call is emitted as a JSON string in the `result` output.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `host` | WebSocket URL for TrueNAS Scale (e.g., `wss://192.168.1.100/api/current`) | ✅ | — |
| `api-key` | API key for authentication | ✅ | — |
| `api-method` | TrueNAS API method name (e.g., `pool.query`, `alert.list`, `system.info`) | ✅ | — |
| `parameters` | JSON array of method arguments. Example: `[]`, `[{"limit":2}]`, `[[["name","~",".*media.*"]],{"limit":3,"select":["name","pool"]}]` | ❌ | — |
| `job-timeout` | Seconds to wait for the job when `api-method` is `core.job_wait`. The step fails if the job is still running after this; the job itself keeps running | ❌ | `600` |

## Outputs

| Output | Description |
|--------|-------------|
| `result` | JSON string returned by the TrueNAS API call |

## Usage

```yaml
- name: Query TrueNAS pools
  uses: dauryg/truenas-action@v1
  with:
    host: wss://192.168.1.100/api/current
    api-key: ${{ secrets.TRUENAS_API_KEY }}
    api-method: pool.query
    parameters: '[]'
```

> **Tip**: Wrap complex JSON data in single quotes to avoid YAML parsing issues.

## Waiting for jobs

Long-running methods (`app.create`, `app.update`, `filesystem.chown`, uploads and so on) are TrueNAS jobs: the call returns a job id straight away and the work carries on in the background. To wait for one, call `core.job_wait` with the job id:

```yaml
- name: Update app
  id: update_app
  uses: dauryg/truenas-action@v1
  with:
    host: wss://192.168.1.100/api/current
    api-key: ${{ secrets.TRUENAS_API_KEY }}
    api-method: app.update
    parameters: '["my-app", {"values": {}}]'

- name: Wait for app update to complete
  uses: dauryg/truenas-action@v1
  with:
    host: wss://192.168.1.100/api/current
    api-key: ${{ secrets.TRUENAS_API_KEY }}
    api-method: core.job_wait
    parameters: '[${{ steps.update_app.outputs.result }}]'
```

The parameter is the job id, or the reply of TrueNAS's HTTP `/_upload` endpoint (`{"job_id": 123}`) passed through unchanged, so a `curl` upload's output can go straight into `parameters: '[${{ steps.upload.outputs.job_id }}]'`.

The action handles `core.job_wait` itself and doesn't send it to TrueNAS: `core.job_wait` is a job too, so over the API it would only return another job id. Instead the action logs in once and polls `core.get_jobs` every 2 seconds until the job finishes:

- `SUCCESS`: the step passes, and `result` is the job's result.
- `FAILED` or `ABORTED`: the step fails with the job's error, and the job's log excerpt is printed.
- Still running after `job-timeout` seconds: the step fails. The job keeps running on TrueNAS.

The API key must be able to see the job. A key without the `FULL_ADMIN` role only sees jobs started in its own session, and every step logs in separately, so waiting on a job from an earlier step fails with `MatchNotFound`.

## Notes

- Store your `api-key` in GitHub Secrets.
- The action runs on Node.js 24.
