import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { robinhood } from "viem/chains";
import { SUPPORTED_CHAINS } from "./chains";

export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

const APP_NAME = "Snyper";
const APP_DESCRIPTION = "Non-custodial Robinhood Chain execution terminal.";

function appUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "https://localhost:3000";
}

/** An env override points the chain at a private endpoint. */
export const RPC_OVERRIDE = process.env.NEXT_PUBLIC_RPC_4663?.trim() ?? "";

function endpoint() {
  return RPC_OVERRIDE
    ? http(RPC_OVERRIDE, { batch: true })
    : http(undefined, { batch: true });
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
    [robinhood.id]: endpoint(),
  },
  ssr: true,
});
