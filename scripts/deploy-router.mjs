/**
 * Deploys SnyperRouter to chain 4663.
 *
 * This spends real money from a real key, so it does nothing without both
 * DEPLOYER_PRIVATE_KEY and CONFIRM=yes in the environment. The key is read,
 * used, and never printed or written anywhere.
 *
 *   npm run contracts:build
 *   DEPLOYER_PRIVATE_KEY=0x… TREASURY=0x… CONFIRM=yes node scripts/deploy-router.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, createPublicClient, http, isAddress, getAddress, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood } from "viem/chains";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = JSON.parse(readFileSync(join(root, "contracts/out/SnyperRouter.json"), "utf8"));

const key = process.env.DEPLOYER_PRIVATE_KEY;
const treasury = process.env.TREASURY;

if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
if (!treasury || !isAddress(treasury)) throw new Error("TREASURY must be an address");

const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const publicClient = createPublicClient({ chain: robinhood, transport: http() });
const balance = await publicClient.getBalance({ address: account.address });

console.log("chain    :", robinhood.id, robinhood.name);
console.log("deployer :", account.address, `(${formatEther(balance)} ETH)`);
console.log("treasury :", getAddress(treasury), "— immutable once deployed");

if (process.env.CONFIRM !== "yes") {
  console.log("\nNothing sent. Re-run with CONFIRM=yes to deploy.");
  process.exit(0);
}

const wallet = createWalletClient({ account, chain: robinhood, transport: http() });
const hash = await wallet.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [getAddress(treasury)],
});
console.log("\nsent:", hash);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error("deployment reverted");

console.log("deployed :", receipt.contractAddress);
console.log(`\nSet this in the app's environment:\n  NEXT_PUBLIC_SNYPER_ROUTER=${receipt.contractAddress}`);
