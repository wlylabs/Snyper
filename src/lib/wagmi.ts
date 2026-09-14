import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { arbitrum, base, mainnet, optimism, polygon, robinhood } from "viem/chains";
import { SUPPORTED_CHAINS } from "./chains";

export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

const APP_NAME = "Snyper";
const APP_DESCRIPTION = "Non-custodial execution terminal for on-chain strategies.";

function appUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://localhost:3000";
}

/** Env overrides let an operator point a chain at a private endpoint. */
const rpcOverrides: Record<number, string | undefined> = {
  1: process.env.NEXT_PUBLIC_RPC_1,
  10: process.env.NEXT_PUBLIC_RPC_10,
  137: process.env.NEXT_PUBLIC_RPC_137,
  8453: process.env.NEXT_PUBLIC_RPC_8453,
  42161: process.env.NEXT_PUBLIC_RPC_42161,
  4663: process.env.NEXT_PUBLIC_RPC_4663,
};

function endpoint(chainId: number) {
  const override = rpcOverrides[chainId]?.trim();
  return override ? http(override, { batch: true }) : http(undefined, { batch: true });
}

function buildConnectors() {
  return [
    injected({ shimDisconnect: true }),
    coinbaseWallet({
      appName: APP_NAME,
      preference: "all",
    }),
    ...(WALLETCONNECT_PROJECT_ID
      ? [
          walletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
            // The app renders its own pairing surface, so the bundled modal stays off.
            showQrModal: false,
            metadata: {
              name: APP_NAME,
              description: APP_DESCRIPTION,
              url: appUrl(),
              icons: [`${appUrl()}/icons/icon-192.png`],
            },
          }),
        ]
      : []),
  ];
}

/**
 * The wagmi `Register` augmentation is intentionally omitted: hooks then accept a
 * plain `number` chain id, which keeps every chain id flowing from stored bots and
 * signals assignable without casting. Chain support is validated at runtime in
 * `CHAIN_META`.
 */
export const config = createConfig({
  chains: SUPPORTED_CHAINS,
  connectors: buildConnectors(),
  transports: {
    [mainnet.id]: endpoint(mainnet.id),
    [base.id]: endpoint(base.id),
    [arbitrum.id]: endpoint(arbitrum.id),
    [optimism.id]: endpoint(optimism.id),
    [polygon.id]: endpoint(polygon.id),
    [robinhood.id]: endpoint(robinhood.id),
  },
  ssr: true,
});
