"use client";

import { useState } from "react";
import {
  useExportWallet,
  useLogin,
  useModalStatus,
  usePrivy,
  useWallets,
  type ConnectedWallet,
  type User,
} from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount, useBalance } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { HoldButton } from "@/components/ui/HoldButton";
import { Sheet } from "@/components/ui/Sheet";
import { WalletAvatar } from "@/components/ui/WalletAvatar";
import { useToast } from "@/components/ui/Toast";
import { CHAIN_ID, chainMeta, explorerAddress } from "@/lib/chains";
import { formatAmount, truncateAddress } from "@/lib/format";
import { PRIVY_CONFIGURED } from "@/lib/privy";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";

export function ConnectControl() {
  const mounted = useMounted();

  if (!mounted) return <div className="skel h-[30px] w-[116px] rounded-full" />;
  if (!PRIVY_CONFIGURED) return <Unconfigured />;
  return <PrivyControl />;
}

/** Nothing to connect to: the build carries no Privy app id. */
function Unconfigured() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-sm btn-short" onClick={() => setOpen(true)}>
        {t("wallet.connect")}
      </button>
      <Sheet open={open} title={t("wallet.connectTitle")} onClose={() => setOpen(false)}>
        <div className="p-3">
          <div className="panel flex items-start gap-3 p-3">
            <Icon name="alert" size={16} className="mt-0.5 warn" />
            <p className="wrap-any text-[11px] leading-relaxed text-dim">
              {t("wallet.privyDisabled", { env: "NEXT_PUBLIC_PRIVY_APP_ID" })}
            </p>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/** The wallet a given address belongs to, out of everything Privy has linked. */
function walletFor(wallets: ConnectedWallet[], address?: string) {
  if (!address) return undefined;
  return wallets.find((wallet) => wallet.address.toLowerCase() === address.toLowerCase());
}

/** What to call a wallet in a row: its own name, or what it is to Privy. */
function walletName(wallet: ConnectedWallet | undefined, embeddedLabel: string, fallback: string) {
  if (!wallet) return fallback;
  if (wallet.walletClientType === "privy") return embeddedLabel;
  return wallet.meta.name ?? wallet.walletClientType ?? fallback;
}

function PrivyControl() {
  const { t } = useI18n();
  const toast = useToast();
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { address } = useAccount();
  const [accountOpen, setAccountOpen] = useState(false);

  /*
   * Privy's modal is a surface of this app, not a departure from it, so the
   * control that opened it stays lit for as long as it is up — the same way a
   * menu button stays pressed while its menu is open. Without that the header
   * looks idle while the reader is mid-connect.
   */
  const { isOpen } = useModalStatus();

  const { login } = useLogin({
    onComplete: ({ wasAlreadyAuthenticated }) => {
      if (wasAlreadyAuthenticated) return;
      toast.push({ tone: "ok", message: t("wallet.connected") });
    },
    onError: (error) => {
      // A reader closing the modal is reported here too; it is not a failure.
      if (error === "exited_auth_flow") return;
      toast.push({ tone: "error", message: t("wallet.connectFailed"), detail: String(error) });
    },
  });

  if (!ready) return <div className="skel h-[30px] w-[116px] rounded-full" />;

  if (!authenticated) {
    return (
      <button
        type="button"
        className="btn btn-accent btn-sm"
        data-open={isOpen ? "true" : undefined}
        onClick={() => login()}
      >
        <Icon name="wallet" size={13} />
        {t("wallet.connect")}
      </button>
    );
  }

  /*
   * Authenticated, but wagmi has no account yet: Privy is still creating or
   * attaching the embedded wallet. The pill holds its place at its final size
   * so the header does not jump when the address lands.
   */
  if (!address) {
    return (
      <span className="pill cursor-default" aria-live="polite">
        <span className="avatar avatar-empty" style={{ width: 22, height: 22 }} />
        <span className="text-[11px] text-dim">{t("wallet.connecting")}</span>
      </span>
    );
  }

  const active = walletFor(wallets, address);

  return (
    <>
      <button
        type="button"
        className="pill"
        data-open={isOpen || accountOpen ? "true" : undefined}
        onClick={() => setAccountOpen(true)}
        aria-label={t("wallet.account")}
      >
        <WalletAvatar
          address={address}
          size={22}
          embedded={active?.walletClientType === "privy"}
        />
        <span className="num tracking-normal">{truncateAddress(address, 4, 4)}</span>
      </button>
      <AccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        address={address}
        user={user}
      />
    </>
  );
}

/** How the reader signed in, shown so the account sheet is not just an address. */
function identityLabel(user: User | null): string | undefined {
  if (!user) return undefined;
  return (
    user.email?.address ??
    user.google?.email ??
    user.phone?.number ??
    user.twitter?.username ??
    user.github?.username ??
    undefined
  );
}

/**
 * The account surface, built to the same plan as the screen Privy shows once a
 * wallet is linked: the avatar and the address at the top, what the account
 * holds under them, and everything you can do about it as filled rows below. A
 * reader who connects through Privy's modal and then opens this should not feel
 * they have crossed a border — the modal and this sheet run on the same tokens,
 * the same corners and the same avatar.
 */
function AccountSheet({
  open,
  onClose,
  address,
  user,
}: {
  open: boolean;
  onClose: () => void;
  address: `0x${string}`;
  user: User | null;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { logout, connectWallet } = usePrivy();
  const { exportWallet } = useExportWallet();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { chainId } = useAccount();
  const [copied, setCopied] = useState(false);
  const meta = chainMeta(CHAIN_ID);
  /*
   * Read on the chain this app trades, not on whatever network the wallet is
   * pointing at. Balances come off the app's own RPC rather than the wallet's
   * session, so a wallet still sitting on another network sees what it holds
   * here — and never another chain's balance under Robinhood Chain's name.
   */
  const { data: balance } = useBalance({
    address,
    chainId: CHAIN_ID,
    query: { enabled: open },
  });
  const wrongNetwork = chainId !== undefined && chainId !== CHAIN_ID;

  const active = walletFor(wallets, address);
  const embedded = active?.walletClientType === "privy";
  const others = wallets.filter(
    (wallet) => wallet.address.toLowerCase() !== address.toLowerCase(),
  );
  const identity = identityLabel(user);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Sheet open={open} title={t("wallet.account")} onClose={onClose}>
      <div className="identity">
        <WalletAvatar address={address} size={52} embedded={embedded} />

        <div>
          <p className="num text-[15px] leading-tight">{truncateAddress(address, 10, 6)}</p>
          <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-faint">
            <Icon name="wallet" size={12} />
            {walletName(active, t("wallet.embedded"), t("wallet.wallet"))}
          </p>
          {identity && <p className="mt-1 wrap-any text-[11px] text-faint">{identity}</p>}
        </div>

        <div className="mt-1">
          <p className="num text-[26px] leading-none">
            {balance ? formatAmount(Number(balance.formatted), 5) : "—"}
            {balance && <span className="ml-1.5 text-[13px] text-dim">{balance.symbol}</span>}
          </p>
          <p className="lbl mt-2">{meta?.label ?? t("common.network")}</p>
          {wrongNetwork && (
            <p className="mt-2 max-w-[34ch] text-[10px] leading-relaxed text-faint">
              {t("wallet.otherNetwork", { chain: meta?.label ?? t("common.network") })}
            </p>
          )}
        </div>
      </div>

      <div className="px-3 pb-4">
        <div className="grid grid-cols-2 gap-2">
          {/*
           * The tile keeps the confirmation rather than handing it to a toast:
           * the tick lands on the spot the clipboard glyph left, the row lights
           * its edge, and both drop away on their own. Keying the icon on the
           * state is what replays the landing on a second copy.
           */}
          <button
            type="button"
            className="tile justify-center"
            data-done={copied ? "true" : undefined}
            onClick={copy}
          >
            <Icon
              key={copied ? "check" : "copy"}
              name={copied ? "check" : "copy"}
              size={14}
              className={`pop ${copied ? "text-accent-text" : "text-dim"}`}
            />
            {copied ? t("common.copied") : t("common.copy")}
          </button>
          <a
            href={explorerAddress(CHAIN_ID, address)}
            target="_blank"
            rel="noreferrer"
            className="tile justify-center"
          >
            <Icon name="external" size={14} className="text-dim" />
            {t("common.explorer")}
          </a>
        </div>

        <p className="lbl mt-5 mb-2">{t("wallet.wallets")}</p>
        <div className="flex flex-col gap-1.5">
          <span className="tile cursor-default" data-active="true">
            <WalletAvatar address={address} size={26} embedded={embedded} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {walletName(active, t("wallet.embedded"), t("wallet.wallet"))}
              </span>
              <span className="num block truncate text-[11px] font-normal text-faint">
                {truncateAddress(address, 6, 4)}
              </span>
            </span>
            <span className="lbl text-accent-text">{t("wallet.active")}</span>
          </span>

          {others.map((wallet) => (
            <button
              key={wallet.address}
              type="button"
              className="tile"
              onClick={() => void setActiveWallet(wallet)}
            >
              <WalletAvatar
                address={wallet.address}
                size={26}
                embedded={wallet.walletClientType === "privy"}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {walletName(wallet, t("wallet.embedded"), t("wallet.wallet"))}
                </span>
                <span className="num block truncate text-[11px] font-normal text-faint">
                  {truncateAddress(wallet.address, 6, 4)}
                </span>
              </span>
              <span className="lbl">{t("wallet.use")}</span>
            </button>
          ))}

          {/*
           * Straight back into Privy's own connect screen. Adding a wallet is
           * its job, and handing it over is cheaper for the reader than a
           * second picker of ours that would do the same thing worse.
           */}
          <button type="button" className="tile" onClick={() => connectWallet()}>
            <span
              className="avatar avatar-empty flex items-center justify-center"
              style={{ width: 26, height: 26 }}
            >
              <Icon name="plus" size={13} className="text-dim" />
            </span>
            <span className="flex-1">{t("wallet.addWallet")}</span>
            <Icon name="chevron" size={13} className="-rotate-90 text-faint" />
          </button>
        </div>

        {embedded && (
          <button
            type="button"
            className="tile mt-4"
            onClick={() => void exportWallet({ address })}
          >
            <Icon name="download" size={14} className="text-dim" />
            <span className="flex-1">{t("wallet.exportKey")}</span>
            <Icon name="chevron" size={13} className="-rotate-90 text-faint" />
          </button>
        )}

        {/*
         * Dropping the wallet is held rather than tapped. It is one press away
         * from an empty app, it sits directly under a list of wallets a reader
         * is tapping through to switch between them, and it is the one control
         * in this sheet where the wrong press costs them the session.
         */}
        <HoldButton
          className="btn-short mt-2 w-full"
          icon="power"
          label={t("wallet.disconnect")}
          holdLabel={t("common.holdToConfirm")}
          onConfirm={() => {
            void logout();
            onClose();
            toast.push({ tone: "info", message: t("wallet.disconnected") });
          }}
        />


        {/* The same line Privy prints under its own modal, in the same words. */}
        <a
          href="https://privy.io"
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-center gap-1.5 text-[10px] tracking-[0.1em] text-faint uppercase transition-colors hover:text-dim"
        >
          {t("wallet.securedBy")}
          <Icon name="external" size={11} />
        </a>
      </div>
    </Sheet>
  );
}
