# SnyperRouter

Snyper's own fee router. Everything about what it charges and why lives in the
contract's own header; this is how to build, check and deploy it.

## Why it exists

SwapRouter02 will split a fee off a trade by itself, and the app uses that when
nothing else is deployed — no contract of ours in the path, nothing new to
trust. It has two limits the app cannot work around:

- the split is capped at **1% of a trade**, so a snype that doubled pays 1%
  rather than the tenth of its profit it owes;
- it knows nothing about a **Pons bonding curve**, so a launchpad trade cannot
  be charged at all.

This contract lifts both. It is not required: with `NEXT_PUBLIC_SNYPER_ROUTER`
unset the app behaves exactly as it did before this contract existed.

## Build

```
npm run contracts:build
```

Writes `contracts/out/SnyperRouter.json`. That directory is generated and is not
committed.

## Check

```
npm run contracts:test
```

Deploys the contract inside an `eth_simulateV1` batch on top of chain 4663 as it
currently stands, then trades through it against the real Uniswap pool and a
real launchpad curve found at run time. It asserts that the fee lands in the
funding asset, that the caller's minimum is enforced *after* the fee, that the
contract keeps nothing, and that the ABI the app encodes against matches the
compiled contract.

Because it runs against live state it can fail for reasons that have nothing to
do with the contract — a pool that moved, an endpoint rate-limiting a burst.
Read the failure before believing it.

## Deploy

```
npm run contracts:build
DEPLOYER_PRIVATE_KEY=0x… TREASURY=0x… CONFIRM=yes node scripts/deploy-router.mjs
```

Then set `NEXT_PUBLIC_SNYPER_ROUTER` to the address it prints and rebuild the
app.

The treasury is fixed at construction and there is no function to change it,
no owner and no upgrade path — rotating the treasury means deploying again and
pointing the app at the new address. That is deliberate: a router people grant
ERC-20 allowances to is worth what its privileged functions can be made to do,
so it has none.

## Before mainnet money goes through it

The checks above are the app's own, not an audit. This contract holds user
funds within a transaction and takes ERC-20 allowances; it should be read by
someone other than its author and audited before it carries size.
