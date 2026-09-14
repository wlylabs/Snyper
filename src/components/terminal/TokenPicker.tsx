"use client";

import { useMemo, useState } from "react";
import { isAddress } from "viem";
import { usePublicClient } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { truncateAddress } from "@/lib/format";
import { readToken, searchTokens, type Token } from "@/lib/tokens";
import { useAppStore } from "@/store/useAppStore";

export function TokenPicker({
  open,
  onClose,
  tokens,
  chainId,
  onSelect,
  excludeAddress,
  title = "Select asset",
}: {
  open: boolean;
  onClose: () => void;
  tokens: Token[];
  chainId?: number;
  onSelect: (token: Token) => void;
  excludeAddress?: string;
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string>();
  const client = usePublicClient({ chainId });
  const addCustomToken = useAppStore((state) => state.addCustomToken);

  const results = useMemo(() => {
    const filtered = tokens.filter(
      (token) => token.address.toLowerCase() !== excludeAddress?.toLowerCase(),
    );
    return searchTokens(filtered, query).slice(0, 120);
  }, [tokens, query, excludeAddress]);

  const canImport =
    isAddress(query.trim()) &&
    results.length === 0 &&
    Boolean(client) &&
    Boolean(chainId);

  const importToken = async () => {
    if (!client || !chainId) return;
    setImporting(true);
    setImportError(undefined);
    try {
      const token = await readToken(client, chainId, query.trim() as `0x${string}`);
      addCustomToken(token);
      onSelect(token);
      setQuery("");
      onClose();
    } catch {
      setImportError("Could not read this contract as an ERC-20 token.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="border-b border-line p-3">
        <label className="relative block">
          <span className="sr-only">Search assets</span>
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          />
          <input
            className="field pl-9"
            placeholder="Symbol, name or address"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="max-h-[52vh] overflow-y-auto scroll-thin md:max-h-none">
        {results.map((token) => (
          <button
            key={token.address}
            type="button"
            className="row-link flex w-full items-center gap-3 border-b border-line px-3 py-2.5"
            onClick={() => {
              onSelect(token);
              onClose();
              setQuery("");
            }}
          >
            <TokenBadge token={token} />
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-[13px] font-semibold">{token.symbol}</span>
              <span className="block truncate text-[11px] text-faint">{token.name}</span>
            </span>
            <span className="num text-[10px] text-faint">
              {token.native ? "NATIVE" : truncateAddress(token.address, 6, 4)}
            </span>
          </button>
        ))}

        {results.length === 0 && (
          <div className="p-4">
            {canImport ? (
              <div className="panel p-3">
                <p className="text-xs text-dim">
                  Unlisted contract. Details are read directly from the chain.
                </p>
                <button
                  type="button"
                  className="btn btn-sm mt-3 w-full"
                  onClick={importToken}
                  disabled={importing}
                >
                  {importing ? "Reading contract…" : "Import token"}
                </button>
                {importError && <p className="mt-2 text-[11px] short">{importError}</p>}
              </div>
            ) : (
              <p className="text-center text-xs text-faint">
                {query ? "Nothing matched that search." : "No assets available."}
              </p>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function TokenBadge({ token, size = 28 }: { token: Token; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden border border-line bg-base text-[10px] font-bold"
      style={{ width: size, height: size }}
    >
      {token.logoURI ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={token.logoURI} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        token.symbol.slice(0, 3).toUpperCase()
      )}
    </span>
  );
}
