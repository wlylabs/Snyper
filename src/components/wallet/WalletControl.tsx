"use client";

import { useEffect, useState } from "react";
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
import { useI18n } from "@/hooks/useI18n";
import { ControlSkeleton } from "./ConnectControl";
import { ACTIVATION_BUDGET } from "./ActiveWalletSync";

/**
 * The connected half of the header control — the part that reads the session.
 *
 * It is split from `ConnectControl` because every import above the fold here is
 * the Privy SDK, and `ConnectControl` is rendered by the shell on every page.
 * Left in one file, the shell would pull the SDK into the first bundle and the
 * lazy provider in `WalletSession` would have saved nothing. This file is only
 * ever reached through a dynamic import, and only once that provider is up.
 */

/**
 * The margin between the sync giving up and the header saying so, so the last
 * attempt has time to land rather than being called a failure a frame early.
 */
const RETRY_GRACE = 500;

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

export function WalletControl() {
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

  if (!ready) return <ControlSkeleton />;

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

  // Authenticated, with no account under it yet — see `WaitingControl`. The
  // pill it renders is the size of this one, so the header is laid out once.
  if (!address) return <WaitingControl />;

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

/**
 * Ending the session, and saying what happened only once Privy has.
 *
 * This used to fire the toast beside the logout call rather than after it, so a
 * reader whose session Privy could not reach was told their wallet was
 * disconnected while the address sat in the header behind the message. The one
 * thing this exists to report is the one thing it got wrong.
 *
 * Dropping wagmi's own connection is not done here: `ActiveWalletSync` does it
 * off the session itself, so a session that ends any other way — expired, or
 * logged out from another tab — clears the app the same way this does.
 *
 * @param close Run first, because the surface that asked is the answer.
 */
function useEndSession(close: () => void) {
  const { t } = useI18n();
  const toast = useToast();
  const { logout } = usePrivy();

  return async () => {
    close();
    try {
      await logout();
      toast.push({ tone: "info", message: t("wallet.disconnected") });
    } catch (error) {
      toast.push({
        tone: "error",
        message: t("wallet.disconnectFailed"),
        detail: String(error),
      });
    }
  };
}

/**
 * Signed in, with nothing to show for it.
 *
 * Normally this is a second: Privy has authenticated and the bridge is a beat
 * behind with the wallet. But it is also where a session lands when that never
 * finishes — a wallet Privy holds a record of and no provider for, an extension
 * closed since the last visit, an embedded wallet that could not be reached.
 * `ActiveWalletSync` spends a couple of seconds trying to end it, and when it
 * cannot, this is the whole of what the reader has: a header that says
 * Connecting and means forever.
 *
 * So it is a button, not a label. What is behind it is the two ways out that a
 * reader stuck here has no other route to — attach a wallet, or drop the
 * session and start it again — and pressing it during the ordinary second it is
 * usually up costs them a sheet they can close.
 */
function WaitingControl() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [stalled, setStalled] = useState(false);

  /*
   * "Connecting…" is a promise about the near future, and it was being made to
   * readers nobody was doing anything for.
   *
   * Privy keeps a signed-in session in the browser, so most arrivals here are
   * not a connect at all: the reader opens the app, the session comes back
   * without them touching anything, and the header goes straight past Connect
   * to this. When the wallet behind that session reattaches — an embedded one
   * always does — the wait is the half second it says it is. When it does not,
   * because the extension is locked or the pairing the session was built on is
   * long gone, the word stopped being true the moment `ActiveWalletSync` ran
   * out of tries, and a reader who had clicked nothing was left watching the
   * app claim to be connecting to something, forever.
   *
   * So the label only outlives the trying by the moment it takes the last
   * attempt to land. After that this says what is actually the case — there is
   * a session and no wallet under it — and the sheet behind it is where that
   * gets fixed or ended.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => setStalled(true), ACTIVATION_BUDGET + RETRY_GRACE);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <button
        type="button"
        className="pill"
        data-open={open ? "true" : undefined}
        onClick={() => setOpen(true)}
      >
        <span
          className="avatar avatar-empty flex items-center justify-center"
          style={{ width: 22, height: 22 }}
        >
          {stalled && <Icon name="alert" size={12} className="warn" />}
        </span>
        <span className="text-[11px] text-dim" aria-live="polite">
          {stalled ? t("wallet.noWallet") : t("wallet.connecting")}
        </span>
      </button>
      <WaitingSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function WaitingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { connectWallet } = usePrivy();
  const endSession = useEndSession(onClose);

  return (
    <Sheet open={open} title={t("wallet.waiting")} onClose={onClose}>
      <div className="p-3">
        <p className="wrap-any text-[11px] leading-relaxed text-dim">{t("wallet.waitingHint")}</p>

        <button type="button" className="tile mt-3" onClick={() => connectWallet()}>
          <span
            className="avatar avatar-empty flex items-center justify-center"
            style={{ width: 26, height: 26 }}
          >
            <Icon name="plus" size={13} className="text-dim" />
          </span>
          <span className="flex-1">{t("wallet.attach")}</span>
          <Icon name="chevron" size={13} className="-rotate-90 text-faint" />
        </button>

        <HoldButton
          className="btn-short mt-2 w-full"
          icon="power"
          label={t("wallet.disconnect")}
          holdLabel={t("common.holdToConfirm")}
          onConfirm={() => void endSession()}
        />
      </div>
    </Sheet>
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
  const { connectWallet } = usePrivy();
  const endSession = useEndSession(onClose);
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
          onConfirm={() => void endSession()}
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
