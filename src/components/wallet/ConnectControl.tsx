"use client";

import { useState } from "react";
import { usePrivy, useExportWallet, useWallets, type User } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount, useBalance } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { chainMeta, explorerAddress } from "@/lib/chains";
import { formatAmount, truncateAddress } from "@/lib/format";
import { PRIVY_CONFIGURED } from "@/lib/privy";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";

export function ConnectControl() {
  const mounted = useMounted();

  if (!mounted) return <div className="skel h-[34px] w-[116px]" />;
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
        <Icon name="alert" size={14} />
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

function PrivyControl() {
  const { t } = useI18n();
  const { ready, authenticated, user, login } = usePrivy();
  const { address } = useAccount();
  const [accountOpen, setAccountOpen] = useState(false);

  if (!ready) return <div className="skel h-[34px] w-[116px]" />;

  if (!authenticated || !address) {
    return (
      <button type="button" className="btn btn-accent btn-sm" onClick={() => login()}>
        <Icon name="wallet" size={14} />
        {t("wallet.connect")}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => setAccountOpen(true)}
        aria-label={t("wallet.account")}
      >
        <span className="dot dot-live" />
        <span className="num normal-case tracking-normal">{truncateAddress(address, 4, 4)}</span>
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
  const { logout } = usePrivy();
  const { exportWallet } = useExportWallet();
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { chainId } = useAccount();
  const [copied, setCopied] = useState(false);
  const meta = chainMeta(chainId);
  const { data: balance } = useBalance({ address, query: { enabled: open } });

  const active = wallets.find(
    (wallet) => wallet.address.toLowerCase() === address.toLowerCase(),
  );
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
      <div className="p-3">
        <div className="panel ticked p-4">
          <p className="lbl mb-2">
            {embedded
              ? t("wallet.embedded")
              : (active?.meta.name ?? active?.walletClientType ?? t("wallet.wallet"))}
          </p>
          <p className="num text-[15px] break-all">{address}</p>
          {identity && <p className="mt-1 text-[11px] text-faint break-all">{identity}</p>}
          <div className="mt-4 flex items-baseline justify-between">
            <span className="lbl">{meta ? meta.label : t("wallet.unsupportedNetwork")}</span>
            <span className="num text-[15px]">
              {balance
                ? `${formatAmount(Number(balance.formatted), 5)} ${balance.symbol}`
                : "—"}
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-sm" onClick={copy}>
            <Icon name={copied ? "check" : "copy"} size={13} />
            {copied ? t("common.copied") : t("common.copy")}
          </button>
          <a
            href={chainId ? explorerAddress(chainId, address) : undefined}
            target="_blank"
            rel="noreferrer"
            className="btn btn-sm"
          >
            <Icon name="external" size={13} />
            {t("common.explorer")}
          </a>
        </div>

        {others.length > 0 && (
          <div className="mt-3">
            <p className="lbl mb-2">{t("wallet.otherWallets")}</p>
            <div className="flex flex-col gap-1.5">
              {others.map((wallet) => (
                <button
                  key={wallet.address}
                  type="button"
                  className="row-link panel flex items-center gap-3 p-2.5"
                  onClick={() => void setActiveWallet(wallet)}
                >
                  <Icon name="wallet" size={15} className="text-dim" />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-[12px] font-semibold">
                      {wallet.walletClientType === "privy"
                        ? t("wallet.embedded")
                        : (wallet.meta.name ?? wallet.walletClientType)}
                    </span>
                    <span className="num block truncate text-[11px] text-faint">
                      {truncateAddress(wallet.address, 6, 4)}
                    </span>
                  </span>
                  <span className="lbl">{t("wallet.use")}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {embedded && (
          <button
            type="button"
            className="btn btn-sm mt-2 w-full"
            onClick={() => void exportWallet({ address })}
          >
            <Icon name="download" size={13} />
            {t("wallet.exportKey")}
          </button>
        )}

        <button
          type="button"
          className="btn btn-sm btn-short mt-2 w-full"
          onClick={() => {
            void logout();
            onClose();
          }}
        >
          <Icon name="power" size={13} />
          {t("wallet.disconnect")}
        </button>

        <p className="mt-3 text-[10px] leading-relaxed text-faint">{t("wallet.privyNote")}</p>
      </div>
    </Sheet>
  );
}
