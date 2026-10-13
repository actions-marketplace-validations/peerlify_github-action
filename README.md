<img src="images/peerlify.png" alt="Peerlify" width="64" height="64">

# Peerlify GitHub Action

Join a GitHub Actions runner to your [Peerlify](https://peerlify.com) network for the length of a job. Steps after it reach your devices by their overlay IP, the same as any other member: deploy to a private server, test against an internal database, pull from a cache with no public address. When the job ends, the runner is removed from the network again.

```yaml
- name: Connect to Peerlify
  uses: peerlify/github-action@v1
  with:
    authkey: ${{ secrets.PEERLIFY_AUTHKEY }}
```

## Quick start

1. In the Peerlify console, open **Settings → Keys → Auth keys** and create a key with **Ephemeral** and **Reusable** on, and a tag for CI (for example `ci`) under **Auto-assign tags**.
2. Write ACL rules for what that tag may reach. A device enrolled with a tagged key is owned by the tag, so the rules decide everything the runner can do.
3. Save the key as a repository or organization secret named `PEERLIFY_AUTHKEY`.
4. Add the action before the steps that need the network:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Connect to Peerlify
        id: peerlify
        uses: peerlify/github-action@v1
        with:
          authkey: ${{ secrets.PEERLIFY_AUTHKEY }}
          ping: 100.64.0.17          # optional: wait until this peer answers

      - name: Deploy
        run: ssh deploy@100.64.0.17 ./release.sh
```

## Minting a key per run with an API token

Instead of one long-lived auth key, give the action an API token and it mints a fresh **single-use, ephemeral** key for each run, valid for one day, and revokes it when the job ends.

Create the token under **Settings → Keys → API access tokens** with the `keys:write` scope. Also grant `devices:write` so the action can approve the runner on networks that require device approval, and remove it from the network if the job ends without a clean logout.

```yaml
- name: Connect to Peerlify
  uses: peerlify/github-action@v1
  with:
    api-token: ${{ secrets.PEERLIFY_API_TOKEN }}
    tags: ci
    hostname: ci-${{ github.run_id }}
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `authkey` | | An auth key (`pk_…`). Use an ephemeral key. One of `authkey` or `api-token` is required. |
| `api-token` | | An API token (`papi_…`) with `keys:write`, and preferably `devices:write`. The action mints a single-use ephemeral key for the run. |
| `tags` | | Comma-separated tags for the minted key, with or without the `tag:` prefix. The tags must already exist in the network. Only used with `api-token`; an auth key carries the tags it was created with. |
| `hostname` | machine name | The name the runner joins under. Must be a DNS label: 1-63 letters, digits and hyphens. Needs a client with `peerlify login --hostname`. |
| `version` | `stable` | Client version to install: `stable` or an exact version such as `2.6.0`. |
| `ping` | | Comma-separated peers (mesh names or overlay IPs) that must answer before the step succeeds. |
| `timeout` | `3m` | How long to wait for an address, and for each `ping` target. |
| `api-url` | `https://web.peerlify.com/api/v1` | Base URL of the Peerlify public API. |
| `pkgs-url` | `https://pkgs.peerlify.net` | Base URL client packages are downloaded from. |

## Outputs

| Output | Description |
|---|---|
| `ip` | The runner's overlay IP address. |
| `fqdn` | The runner's mesh DNS name. |
| `client-id` | The runner's device ID, as the public API takes it. |
| `network-id` | The ID of the network the runner joined. |

`fqdn` and `client-id` are empty with clients that predate `peerlify status --json`.

## What it does

1. **Installs the client.** On Linux it runs the official installer from `pkgs.peerlify.net`, which installs the signed package for the distribution. On Windows it downloads the signed MSI, checks it against its published SHA-256, and installs it silently. Automatic client updates are turned off for the job, so the version you asked for is the version that runs.
2. **Logs in** with `peerlify login --auth-key`, retrying while the freshly started daemon registers. With `api-token`, it first mints a key for the run.
3. **Waits for an address.** With `api-token`, if the runner has no address after 15 seconds, the action approves it, in case the network requires device approval.
4. **Pings** each `ping` target until it answers.

When the job finishes, including when it fails or is cancelled, a cleanup step runs `peerlify logout`, and a device enrolled with an ephemeral key is removed from the network when it logs out. With `api-token` it also deletes the device through the API and revokes the minted key.

If the runner is lost before cleanup can run, the control plane removes the ephemeral device once it stops checking in, usually within about half a minute. A runner whose Peerlify service is stopped cleanly without logging out, or that is lost within seconds of logging in, stays listed until you remove it in the console.

## Requirements

- **Runners:** `ubuntu-*` and `windows-*`, GitHub-hosted or self-hosted. Linux runners need systemd and passwordless `sudo`, which GitHub-hosted runners have, so jobs running in a `container:` are not supported. macOS runners are not supported: the macOS client's background service has to be approved by an administrator in System Settings (or by an MDM profile).
- **Name resolution:** on Linux runners, reach peers by overlay IP. Peerlify does not write mesh names into `/etc/hosts` on Linux. `ping` accepts names on every platform.

## Security

- Use **ephemeral** keys so finished runs don't accumulate in your network, and give them a tag whose ACL rules allow only what CI needs.
- Prefer `api-token` over a long-lived `authkey`: each run gets a key that works once and expires within a day.
- Secrets are not passed to workflows triggered from forks, so a pull request from a fork can't connect.
- Pin the action to a full commit SHA if your policy requires it, for example `peerlify/github-action@<sha> # v1`.

## Troubleshooting

- **`Set either authkey or api-token`:** the secret is empty or not available to this workflow.
- **`peerlify login failed: Auth key …`:** the key is unknown, revoked, expired, or used up. Single-use keys work once, so use a reusable key with `authkey`.
- **`did not get a Peerlify address`:** the network probably requires device approval. Approve the runner in the console, or use an `api-token` with `devices:write`.
- **`does not support --hostname`:** remove `hostname`, or set `version` to a client release that has `peerlify login --hostname`.

More in the [Peerlify docs](https://peerlify.com/docs/github-actions).

## License

BSD 3-Clause, with an added condition: the action may not be used in the Russian Federation, in territories it occupies or controls, or by or for parties located there or acting on behalf of its government. See [LICENSE](LICENSE) for the full terms.
