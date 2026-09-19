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

  "page.balance.title": "Balance",

  "page.memecoin.title": "Memes",

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
  "swap.fee": "Snyper fee",
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
  "balance.hide": "Hide from this list",
  "balance.unhide": "List it again",
  "balance.hidden": "{count} hidden",
  "balance.hiddenLess": "Put the hidden ones away",
  "memecoin.live": "Under $10M · {floor}+ · 5m or new today",
  "memecoin.mcapShort": "MCAP",
  "memecoin.gradeAll": "Any",
  "memecoin.dexscreener": "DEX Screener",
  "memecoin.snipe": "Snyper · buy {symbol}",
  "memecoin.noChart": "Not enough trades to draw yet.",
  "memecoin.gradeHealthy": "Healthy",
  "memecoin.bandAll": "All",
  "memecoin.bandPump": "Pumping",
  "memecoin.bandFlat": "Flat",
  "memecoin.bandDump": "Dumping",
  "memecoin.showing": "{shown} of {total}",
  "memecoin.noMatch": "Nothing here matches that.",
  "memecoin.noMatchHint":
    "The chain is busy — these filters are what emptied the list. Anything already worth more than ten million is never on this screen, and a token whose supply its contract would not report cannot clear a floor, because an unknown size clears nothing.",
  "memecoin.clear": "Clear the filters",
  "memecoin.fresh": "NEW",
  "memecoin.pair": "Pair",
  "memecoin.mcap": "Market cap",
  "memecoin.fdv": "Fully diluted",
  "memecoin.volShort": "Vol",
  "memecoin.liqShort": "Liq",
  "memecoin.volume": "Volume",
  "memecoin.liquidity": "Liquidity",
  "memecoin.trades": "Trades",
  "memecoin.age": "Age",
  "memecoin.pool": "Pool fee",
  "memecoin.token": "Token",
  "memecoin.empty": "Nothing has traded or opened recently.",
  "memecoin.emptyHint":
    "This reads the chain rather than a list: what has traded in the last five minutes, and what has opened since yesterday. An empty screen means both were empty. It fills again on its own.",
  "memecoin.failed": "The chain did not answer.",
  "memecoin.failedHint":
    "Every pair here is built from swap events read straight off chain 4663, and that read did not come back.",

  "snipe.target": "Target",
  "snipe.targets": "Targets",
  "snipe.pick": "Pick one",
  "snipe.change": "Change",
  "snipe.noTarget": "Nothing is aimed at yet.",
  "snipe.noTargetHint":
    "Pick a target and this quotes the shot against the pool it trades in — what it fills at, what that costs, and whether it can be sold again.",
  "snipe.empty": "Nothing on this chain is worth a shot right now.",
  "snipe.emptyHint":
    "A target is a pair under $10M with at least $1K resting in its pool and $1K traded through it in the last five minutes. The list fills again on its own.",
  "snipe.stake": "Stake",
  "snipe.custom": "Any amount",
  "snipe.spendable": "{amount} spendable",
  "snipe.sell": "Sell",
  "snipe.units": "Any amount",
  "snipe.worth": "Worth now",
  "snipe.pnl": "Profit and loss",
  "snipe.youGet": "You get",
  "snipe.atLeast": "At least",
  "snipe.impact": "Price impact",
  "snipe.slippage": "Slippage",
  "snipe.fee": "Snyper fee",
  "snipe.exit": "Exit check",
  "snipe.exitBack": "{percent}% back",
  "snipe.exitBackHint": "Sold straight back, this much of the stake returns.",
  "snipe.exitNoneHint": "The pool refused to quote the sale. Nothing is offered to sign.",
  "snipe.exitAsking": "Asking the pool whether this can be sold again.",
  "snipe.exitNone": "No exit",
  "snipe.route": "Route",
  "snipe.oneHop": "Straight in · {fee}% pool",
  "snipe.twoHops": "Through USDG · {fee}% pool",
  "snipe.fire": "Fire · buy {symbol}",
  "snipe.firing": "Firing…",
  "snipe.checking": "Asking the chain…",
  "snipe.done": "Filled",
  "snipe.receipt": "Receipt",
  "snipe.trapped": "This token cannot be sold",
  "snipe.trappedHint":
    "The chain was asked to quote selling this position straight back, and it refused. A token that can be bought and not sold is the oldest trick there is, so nothing is offered to sign here.",
  "snipe.costly": "This fill costs {percent}%",
  "snipe.costlyHint":
    "That is what the pool charges for a trade this size against what is resting in it, and it is already inside the figure above rather than sitting on top of it. A smaller stake costs less. Nothing here is holding the shot.",
  "snipe.cappedHint":
    "That is also as far as the tolerance goes: {cap}% is the most this will accept, so the fill cannot land further than that under the quote. A pool asking for more is usually a token taxing the trade rather than a pool that is merely small, and the exit check above is what catches the difference.",
  "snipe.unquotable": "This pool would not quote the trade",
  "snipe.unquotableHint":
    "The route into this token came back empty at this size. That is the pool saying it cannot fill it — try a smaller stake, or another target.",
  "snipe.short": "Not enough {coin} in this wallet",
  "snipe.shortHint":
    "Gas comes out of the same balance the stake does, so a wallet holding exactly the stake cannot fire it.",
  "snipe.blocked": "The chain refused this shot",
  "snipe.blockedHint":
    "It was run against the current state before anything reached your wallet, and it did not go through. The pool may have moved since the quote.",
  "snipe.failed": "The transaction did not go through.",
  "snipe.position": "Position",
  "snipe.held": "Held",
  "snipe.dump": "Sell all {symbol}",




  "settings.title": "Settings",
  "settings.subtitle": "How the app reads on this device",
  "settings.appearance": "Appearance",
  "settings.theme": "Theme",
  "settings.themeHint": "Applied instantly and remembered on this device.",
  "settings.dark": "Dark",
  "settings.light": "Light",
  "settings.language": "Language",
  "settings.languageHint": "Interface text, number and date formatting.",

  "settings.referral": "I just joined Fomo",
  "settings.referralTitle": "Trade with me there",
  "settings.referralBadge": "10% off",
  "settings.referralHint":
    "The discount is already on this link — every fee you pay on Fomo comes out 10% smaller, from the first trade.",
  "settings.referralOpen": "Open Fomo · 10% off",

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
  "wallet.attach": "Connect a wallet",
  "wallet.connect": "Connect",
  "wallet.connectFailed": "That wallet could not be connected.",
  "wallet.connectTitle": "Connect wallet",
  "wallet.connected": "Wallet connected",
  "wallet.connecting": "Connecting…",
  "wallet.disconnect": "Disconnect",
  "wallet.disconnectFailed": "That wallet is still connected.",
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
  "wallet.waiting": "Waiting for a wallet",
  "wallet.waitingHint":
    "You are signed in, but no wallet on this session has reached the app — so there is no address to read balances against. Connecting one gives it that address. Ending the session starts the whole thing again.",
  "wallet.wallet": "Wallet",
  "wallet.wallets": "Wallets",
  "wallet.wrongNetwork": "Wrong network",

  "memecoin.lock": "Liquidity lock",
  "lock.tagBurned": "Locked",
  "lock.tagMixed": "{share}% locked",
  "lock.tagOpen": "Open",
  "lock.tagUnread": "Lock unread",
  "lock.tagEmpty": "Drained",
  "lock.burned": "Burned",
  "lock.open": "Withdrawable",
  "lock.mixed": "{share}% burned",
  "lock.unread": "Unread",
  "lock.empty": "Nothing left",
  "lock.reading": "Reading positions",
  "lock.failed": "Could not be read",
  "lock.burnedHint":
    "Every position under this pool was burned, so no key exists to withdraw it. That is not the same as a safe token — supply, transfer taxes and the sell side are separate questions this does not answer.",
  "lock.mixedHint":
    "{share}% of what is in this pool was burned and cannot be pulled. The rest is held by a wallet that can withdraw it at any block.",
  "lock.openHint":
    "The liquidity here is held by wallets that can withdraw it at any block. Nothing says they will, and nothing stops them.",
  "lock.unreadHint":
    "A contract holds the position. There is no shared locker on this chain to recognise — every holder sampled was a different contract, and some can hand the liquidity back — so this says nothing rather than guessing.",
  "lock.emptyHint": "Nothing is left in this pool. Every position under it has been closed.",
  "lock.outOfRange":
    "The burned part sits outside the price this pool trades at, so it is not holding the current price up.",
  "lock.partial":
    "This pool carries more positions than this check reads, so the share is over the ones it read.",

  "error.title": "Something on this screen stopped working.",
  "error.hint": "Nothing was sent and nothing was signed. Your wallet and everything in it are untouched.",
  "error.retry": "Try again",
  "error.home": "Back to Snyper",

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

  "page.balance.title": "Saldo",

  "page.memecoin.title": "Memecoin",

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
  "swap.fee": "Biaya Snyper",
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
  "balance.hide": "Sembunyikan dari daftar ini",
  "balance.unhide": "Tampilkan lagi",
  "balance.hidden": "{count} disembunyikan",
  "balance.hiddenLess": "Simpan lagi yang disembunyikan",
  "memecoin.live": "Di bawah $10J · {floor}+ · 5m atau baru hari ini",
  "memecoin.mcapShort": "MCAP",
  "memecoin.gradeAll": "Semua",
  "memecoin.dexscreener": "DEX Screener",
  "memecoin.snipe": "Snyper · beli {symbol}",
  "memecoin.noChart": "Belum cukup transaksi untuk digambar.",
  "memecoin.gradeHealthy": "Sehat",
  "memecoin.bandAll": "Semua",
  "memecoin.bandPump": "Naik",
  "memecoin.bandFlat": "Datar",
  "memecoin.bandDump": "Jatuh",
  "memecoin.showing": "{shown} dari {total}",
  "memecoin.noMatch": "Tidak ada yang cocok dengan itu.",
  "memecoin.noMatchHint":
    "Chain-nya sedang ramai — saringan inilah yang mengosongkan daftarnya. Apa pun yang sudah bernilai di atas sepuluh juta tidak pernah ada di layar ini, dan token yang suplainya tidak dilaporkan kontraknya tidak bisa melewati lantai mana pun, karena ukuran yang tidak diketahui tidak membuktikan apa-apa.",
  "memecoin.clear": "Bersihkan saringan",
  "memecoin.fresh": "BARU",
  "memecoin.pair": "Pair",
  "memecoin.mcap": "Kapitalisasi pasar",
  "memecoin.fdv": "Terdilusi penuh",
  "memecoin.volShort": "Vol",
  "memecoin.liqShort": "Lik",
  "memecoin.volume": "Volume",
  "memecoin.liquidity": "Likuiditas",
  "memecoin.trades": "Transaksi",
  "memecoin.age": "Umur",
  "memecoin.pool": "Biaya pool",
  "memecoin.token": "Token",
  "memecoin.empty": "Belum ada yang jalan atau dibuka belakangan ini.",
  "memecoin.emptyHint":
    "Layar ini membaca chain, bukan sebuah daftar, jadi layar kosong berarti lima menit yang kosong. Ia akan terisi lagi dengan sendirinya.",
  "memecoin.failed": "Chain tidak menjawab.",
  "memecoin.failedHint":
    "Setiap pair di sini dibangun dari event swap yang dibaca langsung dari chain 4663, dan bacaan itu tidak kembali.",

  "snipe.target": "Target",
  "snipe.targets": "Target",
  "snipe.pick": "Pilih satu",
  "snipe.change": "Ganti",
  "snipe.noTarget": "Belum ada yang dibidik.",
  "snipe.noTargetHint":
    "Pilih target dan tembakannya langsung dihitung ke pool tempat token itu jalan — dapat berapa, biayanya berapa, dan apakah masih bisa dijual lagi.",
  "snipe.empty": "Belum ada yang layak ditembak di chain ini.",
  "snipe.emptyHint":
    "Target itu pair di bawah $10J dengan minimal $1R mengendap di pool-nya dan $1R yang lewat dalam lima menit terakhir. Daftarnya terisi lagi sendiri.",
  "snipe.stake": "Modal",
  "snipe.custom": "Jumlah bebas",
  "snipe.spendable": "Bisa dipakai {amount}",
  "snipe.sell": "Jual",
  "snipe.units": "Jumlah bebas",
  "snipe.worth": "Nilai sekarang",
  "snipe.pnl": "Untung rugi",
  "snipe.youGet": "Kamu dapat",
  "snipe.atLeast": "Minimal",
  "snipe.impact": "Dampak harga",
  "snipe.slippage": "Slippage",
  "snipe.fee": "Biaya Snyper",
  "snipe.exit": "Cek jalan keluar",
  "snipe.exitBack": "Balik {percent}%",
  "snipe.exitBackHint": "Kalau langsung dijual balik, segini modal yang kembali.",
  "snipe.exitNoneHint": "Pool menolak menghitung penjualannya. Tidak ada yang ditawarkan untuk ditandatangani.",
  "snipe.exitAsking": "Menanyakan ke pool apakah ini bisa dijual lagi.",
  "snipe.exitNone": "Tidak ada",
  "snipe.route": "Rute",
  "snipe.oneHop": "Langsung · pool {fee}%",
  "snipe.twoHops": "Lewat USDG · pool {fee}%",
  "snipe.fire": "Tembak · beli {symbol}",
  "snipe.firing": "Menembak…",
  "snipe.checking": "Memastikan ke chain…",
  "snipe.done": "Kena",
  "snipe.receipt": "Bukti transaksi",
  "snipe.trapped": "Token ini tidak bisa dijual",
  "snipe.trappedHint":
    "Chain diminta menghitung penjualan posisi ini balik saat itu juga, dan ia menolak. Token yang bisa dibeli tapi tidak bisa dijual adalah trik paling tua yang ada, jadi di sini tidak ada yang ditawarkan untuk ditandatangani.",
  "snipe.costly": "Isian ini memakan {percent}%",
  "snipe.costlyHint":
    "Itu yang diminta pool untuk trade sebesar ini terhadap isinya, dan angkanya sudah masuk ke hitungan di atas, bukan tambahan di atasnya. Modal lebih kecil memakan lebih sedikit. Tidak ada yang menahan tembakannya di sini.",
  "snipe.cappedHint":
    "Itu juga sejauh toleransinya berjalan: {cap}% adalah yang paling jauh diterima, jadi isiannya tidak bisa jatuh lebih dari itu di bawah perhitungan. Pool yang minta lebih biasanya token yang memajaki tradenya, bukan sekadar pool kecil, dan cek jalan keluar di atas yang membedakan keduanya.",
  "snipe.unquotable": "Pool ini tidak mau menghitung tradenya",
  "snipe.unquotableHint":
    "Rute masuk ke token ini kembali kosong di ukuran segini. Itu cara pool bilang ia tidak sanggup mengisinya — coba modal lebih kecil, atau target lain.",
  "snipe.short": "{coin} di dompet ini tidak cukup",
  "snipe.shortHint":
    "Gas keluar dari saldo yang sama dengan modalnya, jadi dompet yang isinya pas sebesar modal tidak bisa menembak.",
  "snipe.blocked": "Chain menolak tembakan ini",
  "snipe.blockedHint":
    "Ia dijalankan ke kondisi terkini sebelum apa pun sampai ke dompetmu, dan tidak lolos. Pool-nya mungkin sudah bergerak sejak perhitungan tadi.",
  "snipe.failed": "Transaksinya tidak jadi.",
  "snipe.position": "Posisi",
  "snipe.held": "Dipegang",
  "snipe.dump": "Jual semua {symbol}",




  "settings.title": "Pengaturan",
  "settings.subtitle": "Cara aplikasi ini tampil di perangkatmu",
  "settings.appearance": "Tampilan",
  "settings.theme": "Tema",
  "settings.themeHint": "Langsung diterapkan dan diingat di perangkat ini.",
  "settings.dark": "Gelap",
  "settings.light": "Terang",
  "settings.language": "Bahasa",
  "settings.languageHint": "Teks antarmuka, format angka, dan tanggal.",

  "settings.referral": "Aku baru gabung Fomo",
  "settings.referralTitle": "Trading bareng di sana",
  "settings.referralBadge": "Hemat 10%",
  "settings.referralHint":
    "Diskonnya sudah menempel di tautan ini — setiap biaya yang kamu bayar di Fomo jadi 10% lebih kecil, sejak transaksi pertama.",
  "settings.referralOpen": "Buka Fomo · hemat 10%",

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
  "wallet.attach": "Hubungkan dompet",
  "wallet.connect": "Hubungkan",
  "wallet.connectFailed": "Dompet itu tidak bisa dihubungkan.",
  "wallet.connectTitle": "Hubungkan dompet",
  "wallet.connected": "Dompet terhubung",
  "wallet.connecting": "Menghubungkan…",
  "wallet.disconnect": "Putuskan",
  "wallet.disconnectFailed": "Dompet itu masih terhubung.",
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
  "wallet.waiting": "Menunggu dompet",
  "wallet.waitingHint":
    "Anda sudah masuk, tetapi belum ada dompet pada sesi ini yang sampai ke aplikasi — jadi tidak ada alamat untuk membaca saldo. Menghubungkan satu dompet memberi alamat itu. Mengakhiri sesi memulai semuanya dari awal.",
  "wallet.wallet": "Dompet",
  "wallet.wallets": "Dompet",
  "wallet.wrongNetwork": "Jaringan salah",

  "memecoin.lock": "Kunci likuiditas",
  "lock.tagBurned": "Terkunci",
  "lock.tagMixed": "{share}% terkunci",
  "lock.tagOpen": "Terbuka",
  "lock.tagUnread": "Kunci tak terbaca",
  "lock.tagEmpty": "Terkuras",
  "lock.burned": "Dibakar",
  "lock.open": "Bisa ditarik",
  "lock.mixed": "{share}% dibakar",
  "lock.unread": "Tak terbaca",
  "lock.empty": "Sudah kosong",
  "lock.reading": "Membaca posisi",
  "lock.failed": "Gagal dibaca",
  "lock.burnedHint":
    "Semua posisi di bawah pool ini sudah dibakar, jadi tidak ada kunci untuk menariknya. Itu tidak sama dengan token yang aman — pasokan, pajak transfer, dan sisi jual adalah pertanyaan terpisah yang tidak dijawab di sini.",
  "lock.mixedHint":
    "{share}% dari isi pool ini sudah dibakar dan tidak bisa ditarik. Sisanya dipegang dompet yang bisa menariknya pada blok mana pun.",
  "lock.openHint":
    "Likuiditas di sini dipegang dompet yang bisa menariknya pada blok mana pun. Tidak ada yang menjamin mereka akan menarik, dan tidak ada yang menghalangi.",
  "lock.unreadHint":
    "Posisinya dipegang sebuah kontrak. Tidak ada locker bersama di chain ini yang bisa dikenali — setiap pemegang yang disampel adalah kontrak yang berbeda, dan sebagian bisa mengembalikan likuiditasnya — jadi layar ini diam daripada menebak.",
  "lock.emptyHint": "Tidak ada yang tersisa di pool ini. Semua posisi di bawahnya sudah ditutup.",
  "lock.outOfRange":
    "Bagian yang dibakar berada di luar harga yang diperdagangkan pool ini, jadi tidak menopang harga sekarang.",
  "lock.partial":
    "Pool ini punya lebih banyak posisi daripada yang dibaca pemeriksaan ini, jadi persentasenya dihitung atas yang terbaca.",

  "error.title": "Ada bagian layar ini yang berhenti bekerja.",
  "error.hint": "Tidak ada yang dikirim dan tidak ada yang ditandatangani. Dompet Anda dan seluruh isinya tidak tersentuh.",
  "error.retry": "Coba lagi",
  "error.home": "Kembali ke Snyper",

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
