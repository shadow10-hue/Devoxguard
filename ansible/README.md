# Ansible — provision & deploy

Infrastructure-as-code for the single-VM DevoxGuard deployment
(`docs/deployment.md`). Two playbooks:

- **`provision.yml`** — one-time host setup: Docker Engine + Compose plugin, a
  hardened Docker daemon (log rotation, `no-new-privileges`, `live-restore`), a
  UFW firewall (only 22/80/443), `fail2ban`, unattended security upgrades, a
  non-root `deploy` user, and the `/opt/devoxguard` deploy directory.
- **`deploy.yml`** — deploy/update the stack from the **signed** GHCR images:
  syncs the compose files + Caddy config, renders `.env` from vaulted variables,
  **`cosign verify`s each image** against the release pipeline's identity, then
  pulls and starts the stack (via `docker-compose.deploy.yml`) and waits for
  `/devoxguard/health`.

## Prerequisites

```bash
pip install ansible ansible-lint
ansible-galaxy collection install -r requirements.yml
cp inventory.example.ini inventory.ini            # set ansible_host / ansible_user
cp group_vars/all.example.yml group_vars/all.yml  # set domain, email, API key
ansible-vault encrypt group_vars/all.yml          # keep secrets encrypted
```

## Usage

```bash
# 1. Provision (needs a bootstrap sudo user; use --ask-become-pass if needed)
ansible-playbook provision.yml -u <bootstrap_user> --ask-become-pass

# 2. Deploy — pin the digests you verified (CD does this automatically)
ansible-playbook deploy.yml --ask-vault-pass \
  -e api_image=ghcr.io/<owner>/devoxguard-api-demo@sha256:<digest> \
  -e dash_image=ghcr.io/<owner>/devoxguard-dashboard@sha256:<digest>
```

## Secrets

`.env` is rendered from `group_vars/all.yml` via `templates/env.j2` with
`no_log: true`, so secrets never print in play output. Keep `group_vars/all.yml`
encrypted with Ansible Vault (or inline-`!vault` just the `devoxguard_api_key`).
Never commit a plaintext key or a populated `inventory.ini`.

## CI

`ansible-lint` runs the `iac` job in `.github/workflows/ci.yml` against this
directory; the compose files and workflows are additionally scanned by that
pipeline's Trivy config (misconfiguration) step.
