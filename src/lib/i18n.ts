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
  "nav.memecoin": "Memes",
  "nav.settings": "Settings",

  "a11y.home": "Snyper home",
  "a11y.primaryNav": "Primary",

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

  "page.memecoin.title": "Memes",
  "page.memecoin.subtitle": "New memecoins on Robinhood Chain",
  "page.memecoin.empty": "This screen is not built yet.",
  "page.memecoin.hint":
    "Where new contracts get found and read. Nothing is scanned until it is written.",

  "balance.total": "Portfolio value",
  "balance.holdings": "Holdings",
  "balance.more": "{count} under $1",
  "balance.less": "Hide what is under $1",
  "balance.connect": "No wallet connected.",
  "balance.connectHint":
    "Connect one — from the header or from here — and this screen reads what it holds on Robinhood Chain.",
  "balance.empty": "This wallet holds nothing on Robinhood Chain.",
  "balance.emptyHint":
    "Neither the coin nor a token. Anything sent to this address turns up here.",
  "balance.failed": "The holdings list could not be read.",
  "balance.failedHint":
    "Which tokens an address holds is a question only the chain's explorer can answer, and it did not. The balances themselves come off the chain, so what is missing here is the list, not the money.",
  "balance.retry": "Try again",
  "balance.unconfirmed": "The chain did not confirm this figure — it is the explorer's.",
  "balance.token": "Token",
  "balance.contract": "Contract",
  "balance.name": "Name",
  "balance.nameAsWritten": "As written by the contract",
  "balance.amount": "Amount",
  "balance.worth": "Value",
  "balance.flagTicker": "Another token here uses this ticker",
  "balance.flagTickerDetail":
    "More than one contract in this wallet answers to {symbol}. A ticker is not a name — anyone can deploy a token under any letters they like, and wearing a real one is how a worthless contract gets mistaken for it. The address below is the only thing that says which token this is.",
  "balance.flagLure": "This name is an advertisement",
  "balance.flagLureDetail":
    "The name carries a web address or an instruction. Tokens like this are sent to wallets unasked, and the site they point at exists to empty the wallet that visits it. Nothing real needs you to go anywhere to claim, verify or unfreeze anything.",

  "swap.title": "Sell",
  "swap.for": "For",
  "swap.amount": "Amount",
  "swap.max": "Max",
  "swap.receive": "You receive",
  "swap.minimum": "At least",
  "swap.slippage": "Slippage",
  "swap.pool": "Pool",
  "swap.venue": "Uniswap v3 · {fee}% fee",
  "swap.approve": "Allow {symbol}",
  "swap.approving": "Waiting for the allowance…",
  "swap.send": "Sell {symbol}",
  "swap.sending": "Selling…",
  "swap.checking": "Checking with the chain…",
  "swap.done": "Sold",
  "swap.tooMuch": "More than this wallet holds.",
  "swap.noMarket": "Nothing on this chain trades this token.",
  "swap.noMarketHint":
    "No pool was found for it against either exit, at any fee tier. A token can be held and priced without being sellable here.",
  "swap.blocked": "The chain refused this trade",
  "swap.blockedHint":
    "It was run against the current state before you were asked to sign, and it did not go through. Usually the pool moved — try a wider slippage, or a smaller amount.",
  "swap.failed": "The transaction did not go through.",
  "swap.risky": "This token is marked above. Read that before selling into it.",

  "swap.impact": "Price impact",
  "swap.thin": "This pool cannot take a trade this size",
  "swap.thinHint":
    "The price it would fill at is far enough from the going rate that no tolerance worth offering would cover it. A smaller amount will find a better one.",
  "swap.slippageAuto":
    "The bound is read off how far this pool moves under this trade, so there is nothing here to choose.",
  "balance.hide": "Hide from this list",
  "balance.unhide": "List it again",
  "balance.hideHint":
    "The token stays in the wallet and stays sellable. Hiding it only stops this screen listing it, and keeps it out of the total.",
  "balance.hidden": "{count} hidden",
  "balance.hiddenLess": "Put the hidden ones away",
  "settings.title": "Settings",
  "settings.subtitle": "How the app reads on this device",
  "settings.appearance": "Appearance",
  "settings.theme": "Theme",
  "settings.themeHint": "Applied instantly and remembered on this device.",
  "settings.dark": "Dark",
  "settings.light": "Light",
  "settings.language": "Language",
  "settings.languageHint": "Interface text, number and date formatting.",

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
  "nav.memecoin": "Memecoin",
  "nav.settings": "Pengaturan",

  "a11y.home": "Beranda Snyper",
  "a11y.primaryNav": "Navigasi utama",

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

  "page.memecoin.title": "Memecoin",
  "page.memecoin.subtitle": "Memecoin baru di Robinhood Chain",
  "page.memecoin.empty": "Layar ini belum dibangun.",
  "page.memecoin.hint":
    "Tempat kontrak baru ditemukan dan dibaca. Belum ada yang dipindai sampai ditulis.",

  "balance.total": "Nilai portofolio",
  "balance.holdings": "Isi dompet",
  "balance.more": "{count} di bawah $1",
  "balance.less": "Sembunyikan yang di bawah $1",
  "balance.connect": "Belum ada dompet terhubung.",
  "balance.connectHint":
    "Hubungkan satu — lewat header atau dari sini — dan layar ini membaca isinya di Robinhood Chain.",
  "balance.empty": "Dompet ini tidak memegang apa pun di Robinhood Chain.",
  "balance.emptyHint":
    "Tidak koinnya, tidak tokennya. Apa pun yang dikirim ke alamat ini akan muncul di sini.",
  "balance.failed": "Daftar isi dompet tidak bisa dibaca.",
  "balance.failedHint":
    "Token apa saja yang dipegang sebuah alamat hanya bisa dijawab explorer chain ini, dan ia tidak menjawab. Saldonya sendiri dibaca dari chain — jadi yang hilang di sini daftarnya, bukan uangnya.",
  "balance.retry": "Coba lagi",
  "balance.unconfirmed": "Angka ini belum dikonfirmasi chain — ini angka explorer.",
  "balance.token": "Token",
  "balance.contract": "Kontrak",
  "balance.name": "Nama",
  "balance.nameAsWritten": "Sesuai yang ditulis kontraknya",
  "balance.amount": "Jumlah",
  "balance.worth": "Nilai",
  "balance.flagTicker": "Token lain di sini memakai ticker yang sama",
  "balance.flagTickerDetail":
    "Lebih dari satu kontrak di dompet ini mengaku {symbol}. Ticker bukan nama — siapa pun bisa menerbitkan token dengan huruf apa pun, dan memakai ticker yang asli adalah cara kontrak tak berharga disangka yang asli. Alamat di bawah satu-satunya yang menyatakan token ini yang mana.",
  "balance.flagLure": "Nama ini sebuah iklan",
  "balance.flagLureDetail":
    "Namanya membawa alamat web atau perintah. Token seperti ini dikirim ke dompet tanpa diminta, dan situs yang ditunjuknya ada untuk menguras dompet yang datang. Tidak ada hal asli yang menyuruhmu pergi ke mana pun untuk mengklaim, memverifikasi atau membuka blokir apa pun.",

  "swap.title": "Jual",
  "swap.for": "Jadi",
  "swap.amount": "Jumlah",
  "swap.max": "Maks",
  "swap.receive": "Kamu dapat",
  "swap.minimum": "Minimal",
  "swap.slippage": "Slippage",
  "swap.pool": "Pool",
  "swap.venue": "Uniswap v3 · biaya {fee}%",
  "swap.approve": "Izinkan {symbol}",
  "swap.approving": "Menunggu izinnya…",
  "swap.send": "Jual {symbol}",
  "swap.sending": "Menjual…",
  "swap.checking": "Memastikan ke chain…",
  "swap.done": "Terjual",
  "swap.tooMuch": "Lebih banyak dari isi dompet ini.",
  "swap.noMarket": "Tidak ada yang memperdagangkan token ini di chain ini.",
  "swap.noMarketHint":
    "Tidak ada pool untuk token ini terhadap kedua jalur keluar, di tier biaya mana pun. Sebuah token bisa dipegang dan punya harga tanpa bisa dijual di sini.",
  "swap.blocked": "Chain menolak transaksi ini",
  "swap.blockedHint":
    "Transaksinya dijalankan terhadap keadaan sekarang sebelum kamu diminta tanda tangan, dan tidak tembus. Biasanya pool-nya bergeser — coba slippage lebih lebar, atau jumlah lebih kecil.",
  "swap.failed": "Transaksinya tidak tembus.",
  "swap.risky": "Token ini ditandai di atas. Baca dulu sebelum menjual ke dalamnya.",

  "swap.impact": "Dampak harga",
  "swap.thin": "Pool ini tidak sanggup menampung transaksi sebesar ini",
  "swap.thinHint":
    "Harga jadinya terlalu jauh dari harga berjalan, sampai tidak ada toleransi yang pantas ditawarkan untuk menutupinya. Jumlah yang lebih kecil akan dapat harga lebih baik.",
  "swap.slippageAuto":
    "Batasnya dibaca dari seberapa jauh pool ini bergeser oleh transaksi ini, jadi tidak ada yang perlu kamu pilih di sini.",
  "balance.hide": "Sembunyikan dari daftar ini",
  "balance.unhide": "Tampilkan lagi",
  "balance.hideHint":
    "Tokennya tetap ada di dompet dan tetap bisa dijual. Menyembunyikan hanya membuat layar ini berhenti mendaftarnya, dan mengeluarkannya dari total.",
  "balance.hidden": "{count} disembunyikan",
  "balance.hiddenLess": "Simpan lagi yang disembunyikan",
  "settings.title": "Pengaturan",
  "settings.subtitle": "Cara aplikasi ini tampil di perangkatmu",
  "settings.appearance": "Tampilan",
  "settings.theme": "Tema",
  "settings.themeHint": "Langsung diterapkan dan diingat di perangkat ini.",
  "settings.dark": "Gelap",
  "settings.light": "Terang",
  "settings.language": "Bahasa",
  "settings.languageHint": "Teks antarmuka, format angka, dan tanggal.",

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
