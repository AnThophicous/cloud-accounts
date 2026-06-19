import cheerfulUrl from "@lobehub/fluent-emoji-flat/assets/1f60a.svg?url";
import cryingUrl from "@lobehub/fluent-emoji-flat/assets/1f62d.svg?url";
import skullUrl from "@lobehub/fluent-emoji-flat/assets/1f480.svg?url";
import neutralUrl from "@lobehub/fluent-emoji-flat/assets/1f610.svg?url";
import type { PublicAccount } from "../../shared/types";

function remainingFromAccount(account: PublicAccount): number | null {
  if (account.usageSnapshot?.credits?.unlimited) return 100;
  if (typeof account.usageSnapshot?.primary?.usedPercent === "number") {
    return Math.max(0, 100 - Math.round(account.usageSnapshot.primary.usedPercent));
  }
  if (account.quotaLimit > 0) {
    return Math.max(0, Math.round((account.quotaRemaining / Math.max(1, account.quotaLimit)) * 100));
  }
  return null;
}

function emojiForAccount(account: PublicAccount): string {
  const remaining = remainingFromAccount(account);
  if (remaining === 0) return skullUrl;
  if (remaining != null && remaining <= 20) return cryingUrl;
  if (remaining != null && remaining >= 60) return cheerfulUrl;
  return neutralUrl;
}

export function AccountStatusEmoji({ account, className = "" }: { account: PublicAccount; className?: string }) {
  return <img src={emojiForAccount(account)} alt="" aria-hidden="true" className={className} />;
}
