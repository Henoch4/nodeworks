# NodeWorks — DePIN compute bounties on BOT Chain

A bounty board for DePIN compute on **BOT Chain mainnet (chain 677)**. Posters lock a WBOT
reward against a job spec; nodes claim and deliver; payouts settle automatically — on
approval, arbiter ruling, or a **3-day timeout** when the poster goes silent.

## Pages

| Page | What it does |
|---|---|
| `index.html` | Landing — live jobs and rewarded volume |
| `app.html` | Post jobs, claim, submit, approve/dispute, worker records |
| `docs.html` | Settlement model, contract API, demo activity, build & verify |

## On-chain (mainnet)

- **NodeWorks:** [`0x8Df96d6721196161a953b45da114a7BA8193E5B2`](https://scan.botchain.ai/address/0x8Df96d6721196161a953b45da114a7BA8193E5B2) — verified ✓
- **WBOT (reward token):** [`0xD5452816194a3784dBa983426cCe7c122F4abd30`](https://scan.botchain.ai/address/0xD5452816194a3784dBa983426cCe7c122F4abd30)
- Chain: `677` · RPC `https://rpc.botchain.ai` · explorer `https://scan.botchain.ai`
- Testnet twin (chain 968): `0x13C675A6400CB17C7a3cEED03B7985adb2a4984B`

## Core API

```
postJob(specURI, reward, deadlineHours)   — lock a bounty
claimJob(jobId) / submitJob(jobId, resultURI)
approveJob(jobId) / disputeJob(jobId) / resolveDispute(jobId, workerWins)
timeoutSettle(jobId)                      — worker self-settles after 3 days
cancelJob(jobId) / getJob(jobId) / completedJobs(worker)
```

Events: `JobPosted`, `JobClaimed`, `JobSubmitted`, `JobApproved`, `JobResolved`, `JobTimedOut` (full set in docs).

## Run locally

Static site — any file server works:

```bash
npx serve .
```

## Stack

- Vanilla HTML/CSS/JS (no build step)
- [ethers.js 6](https://docs.ethers.org/) via esm.sh
- [Reown AppKit](https://reown.com/appkit) for wallet connect
