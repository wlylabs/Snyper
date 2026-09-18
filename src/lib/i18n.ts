export type Locale = "en" | "id";

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "id", label: "Indonesia" },
];

/** BCP 47 tag used for number and date formatting. */
export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-US",
  id: "id-ID",
};

/*
 * The dictionary holds what the app can currently say, and nothing else. It was
 * four times this size when the app traded: every one of those keys went with
 * the screen that read it, rather than being left here against the chance that
 * whatever replaces that screen phrases things the same way.
 */
const en = {
  "nav.home": "Snyper",
  "nav.balance": "Balance",
  "nav.discover": "Discover",
  "nav.settings": "Settings",

  "a11y.home": "Snyper home",
  "a11y.primaryNav": "Primary",
  "a11y.language": "Switch language",

  "theme.toDark": "Switch to dark",
  "theme.toLight": "Switch to light",

  "common.close": "Close",
  "common.copied": "Copied",
  "common.copy": "Copy",
  "common.explorer": "Explorer",
  /* Shown in place of a destructive button's label while it is being held. */
  "common.holdToConfirm": "Keep holding…",
  "common.idle": "Idle",
  "common.connected": "Connected",
  "common.network": "Network",
  "common.nonCustodial": "Non-custodial",

  "page.home.title": "Snyper",
  "page.home.subtitle": "Robinhood Chain, non-custodial",
  "page.home.empty": "Nothing here yet.",
  "page.home.hint":
    "The app has been stripped back to its wallet session. Connect a wallet from the header; what this screen does is written next.",

  "page.balance.title": "Balance",
  "page.balance.subtitle": "What this wallet holds on Robinhood Chain",
  "page.balance.empty": "This screen is not built yet.",
  "page.balance.hint":
    "Holdings will be read from the chain once this screen exists. The wallet session it needs is already running.",

  "page.discover.title": "Discover",
  "page.discover.subtitle": "New memecoins on Robinhood Chain",
  "page.discover.empty": "This screen is not built yet.",
  "page.discover.hint":
    "Where new contracts get found and read. Nothing is scanned until it is written.",

  "settings.title": "Settings",
  "settings.subtitle": "How the app reads on this device",
  "settings.appearance": "Appearance",
  "settings.theme": "Theme",
  "settings.themeHint": "Applied instantly and remembered on this device.",
  "settings.dark": "Dark",
  "settings.light": "Light",
  "settings.language": "Language",
  "settings.languageHint": "Interface text, number and date formatting.",
  "settings.localData": "Local data",
  "settings.localDataNote":
    "All this app stores in your browser is a language and a theme. No keys, no addresses, nothing read off the chain — connecting a wallet is a session Privy holds, and it is dropped from the account sheet, not from here.",
  "settings.reset": "Reset preferences",
  "settings.resetDone": "Preferences reset",

  "install.action": "Install app",
  "install.androidHint":
    "Open your browser menu and choose Install app or Add to Home screen.",
  "install.bannerHint": "Run it fullscreen from your home screen.",
  "install.bannerTitle": "Install Snyper",
  "install.benefitFullscreen": "Fullscreen layout with the tab bar where your thumb is.",
  "install.benefitKeys": "Nothing changes about custody — keys stay in your wallet.",
  "install.benefitLauncher": "Its own launcher entry and window, no browser chrome.",
  "install.benefitOffline": "The shell keeps loading offline; live data still needs a connection.",
  "install.desktopHint":
    "Your browser has not offered an install prompt yet. Chromium browsers surface an install icon in the address bar after a short visit.",
  "install.installed": "Already running as an installed app.",
  "install.iosStep1": "Tap the Share button in Safari's toolbar.",
  "install.iosStep2": "Scroll down and choose Add to Home Screen.",
  "install.iosStep3": "Confirm the name, then tap Add.",
  "install.iosTitle": "Add to Home Screen",
  "install.note": "Installing changes nothing on-chain and stores no keys.",
  "install.short": "Install",
  "install.tagline": "Non-custodial, on your home screen.",
  "install.title": "Install Snyper",
  "install.working": "Opening installer…",

  "privy.landingHeader": "Connect to Snyper",
  "privy.loginMessage": "Non-custodial. Your keys never leave your wallet.",

  "toast.dismiss": "Dismiss",

  "wallet.account": "Account",
  "wallet.active": "Active",
  "wallet.addWallet": "Connect another wallet",
  "wallet.connect": "Connect",
  "wallet.connectFailed": "That wallet could not be connected.",
  "wallet.connectTitle": "Connect wallet",
  "wallet.connected": "Wallet connected",
  "wallet.connecting": "Connecting…",
  "wallet.disconnect": "Disconnect",
  "wallet.disconnected": "Wallet disconnected",
  "wallet.embedded": "Embedded wallet",
  "wallet.exportKey": "Export private key",
  "wallet.otherNetwork":
    "Your wallet is pointing at another network. What it holds on {chain} is read over this app's own endpoint either way — switching networks only matters for signing.",
  "wallet.privyDisabled":
    "Wallet connection is switched off in this build. Set {env} to a Privy app id to turn it back on.",
  "wallet.securedBy": "Secured by Privy",
  "wallet.switchTo": "Switch to {chain}",
  "wallet.use": "Use",
  "wallet.wallet": "Wallet",
  "wallet.wallets": "Wallets",
  "wallet.wrongNetwork": "Wrong network",

  "notFound.title": "That route is not part of this app.",
  "notFound.action": "Back to Snyper",
} as const;

export type TKey = keyof typeof en;

const id: Record<TKey, string> = {
  "nav.home": "Snyper",
  "nav.balance": "Saldo",
  "nav.discover": "Memecoin",
  "nav.settings": "Setelan",

  "a11y.home": "Beranda Snyper",
  "a11y.primaryNav": "Navigasi utama",
  "a11y.language": "Ganti bahasa",

  "theme.toDark": "Pakai tema gelap",
  "theme.toLight": "Pakai tema terang",

  "common.close": "Tutup",
  "common.copied": "Tersalin",
  "common.copy": "Salin",
  "common.explorer": "Explorer",
  "common.holdToConfirm": "Tahan terus…",
  "common.idle": "Diam",
  "common.connected": "Terhubung",
  "common.network": "Jaringan",
  "common.nonCustodial": "Non-kustodial",

  "page.home.title": "Snyper",
  "page.home.subtitle": "Robinhood Chain, non-kustodial",
  "page.home.empty": "Belum ada apa-apa di sini.",
  "page.home.hint":
    "Aplikasi ini dikosongkan sampai tersisa sesi dompetnya. Hubungkan dompet lewat header; isi layar ini ditulis berikutnya.",

  "page.balance.title": "Saldo",
  "page.balance.subtitle": "Isi dompet ini di Robinhood Chain",
  "page.balance.empty": "Layar ini belum dibangun.",
  "page.balance.hint":
    "Isi dompet akan dibaca dari chain begitu layar ini ada. Sesi dompet yang dibutuhkannya sudah jalan.",

  "page.discover.title": "Memecoin",
  "page.discover.subtitle": "Memecoin baru di Robinhood Chain",
  "page.discover.empty": "Layar ini belum dibangun.",
  "page.discover.hint":
    "Tempat kontrak baru ditemukan dan dibaca. Belum ada yang dipindai sampai ditulis.",

  "settings.title": "Setelan",
  "settings.subtitle": "Cara aplikasi ini tampil di perangkatmu",
  "settings.appearance": "Tampilan",
  "settings.theme": "Tema",
  "settings.themeHint": "Langsung diterapkan dan diingat di perangkat ini.",
  "settings.dark": "Gelap",
  "settings.light": "Terang",
  "settings.language": "Bahasa",
  "settings.languageHint": "Teks antarmuka, format angka, dan tanggal.",
  "settings.localData": "Data lokal",
  "settings.localDataNote":
    "Yang disimpan aplikasi ini di browser-mu cuma bahasa dan tema. Tidak ada kunci, tidak ada alamat, tidak ada apa pun dari chain — koneksi dompet adalah sesi yang dipegang Privy, dan diputus dari lembar akun, bukan dari sini.",
  "settings.reset": "Setel ulang preferensi",
  "settings.resetDone": "Preferensi disetel ulang",

  "install.action": "Pasang aplikasi",
  "install.androidHint":
    "Buka menu browser lalu pilih Install app atau Add to Home screen.",
  "install.bannerHint": "Jalankan layar penuh dari layar utamamu.",
  "install.bannerTitle": "Pasang Snyper",
  "install.benefitFullscreen": "Tata letak layar penuh dengan tab bar tepat di jangkauan jempol.",
  "install.benefitKeys": "Soal kustodi tidak berubah — kunci tetap di dompetmu.",
  "install.benefitLauncher": "Punya ikon dan jendela sendiri, tanpa tampilan browser.",
  "install.benefitOffline": "Tampilan tetap terbuka saat offline; data live tetap butuh koneksi.",
  "install.desktopHint":
    "Browser-mu belum menawarkan pemasangan. Browser berbasis Chromium memunculkan ikon install di bilah alamat setelah beberapa kunjungan.",
  "install.installed": "Sudah berjalan sebagai aplikasi terpasang.",
  "install.iosStep1": "Ketuk tombol Bagikan di bilah Safari.",
  "install.iosStep2": "Gulir ke bawah dan pilih Add to Home Screen.",
  "install.iosStep3": "Pastikan namanya, lalu ketuk Add.",
  "install.iosTitle": "Tambah ke Layar Utama",
  "install.note": "Memasang aplikasi tidak mengubah apa pun on-chain dan tidak menyimpan kunci.",
  "install.short": "Pasang",
  "install.tagline": "Non-kustodial, langsung di layar utamamu.",
  "install.title": "Pasang Snyper",
  "install.working": "Membuka pemasang…",

  "privy.landingHeader": "Hubungkan ke Snyper",
  "privy.loginMessage": "Non-kustodial. Kuncimu tidak pernah keluar dari dompetmu.",

  "toast.dismiss": "Tutup",

  "wallet.account": "Akun",
  "wallet.active": "Aktif",
  "wallet.addWallet": "Hubungkan dompet lain",
  "wallet.connect": "Hubungkan",
  "wallet.connectFailed": "Dompet itu tidak bisa dihubungkan.",
  "wallet.connectTitle": "Hubungkan dompet",
  "wallet.connected": "Dompet terhubung",
  "wallet.connecting": "Menghubungkan…",
  "wallet.disconnect": "Putuskan",
  "wallet.disconnected": "Dompet diputus",
  "wallet.embedded": "Dompet bawaan",
  "wallet.exportKey": "Ekspor kunci privat",
  "wallet.otherNetwork":
    "Dompetmu sedang menunjuk jaringan lain. Isi dompet di {chain} tetap dibaca lewat endpoint aplikasi ini — pindah jaringan hanya perlu saat menandatangani transaksi.",
  "wallet.privyDisabled":
    "Koneksi dompet dimatikan di build ini. Isi {env} dengan app id Privy untuk menyalakannya lagi.",
  "wallet.securedBy": "Diamankan oleh Privy",
  "wallet.switchTo": "Pindah ke {chain}",
  "wallet.use": "Pakai",
  "wallet.wallet": "Dompet",
  "wallet.wallets": "Dompet",
  "wallet.wrongNetwork": "Jaringan salah",

  "notFound.title": "Rute itu bukan bagian dari aplikasi ini.",
  "notFound.action": "Kembali ke Snyper",
};

const DICTIONARIES: Record<Locale, Record<TKey, string>> = { en, id };

export type TVars = Record<string, string | number>;

export function translate(locale: Locale, key: TKey, vars?: TVars): string {
  const template = DICTIONARIES[locale][key] ?? DICTIONARIES.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Best-effort match of the browser's preferred language to a supported locale. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const lower = tag.toLowerCase();
    if (lower.startsWith("id") || lower.startsWith("in-id")) return "id";
    if (lower.startsWith("en")) return "en";
  }
  return "en";
}
