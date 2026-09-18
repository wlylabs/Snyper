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
  "balance.hide": "Hide from this list",
  "balance.unhide": "List it again",
  "balance.hidden": "{count} hidden",
  "balance.hiddenLess": "Put the hidden ones away",
  "memecoin.live": "Under $10M · 5m",
  "memecoin.gradeAll": "Any",
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
  "memecoin.empty": "Nothing has traded in the last five minutes.",
  "memecoin.emptyHint":
    "This reads the chain rather than a list, so an empty screen means an empty five minutes. It fills again on its own.",
  "memecoin.failed": "The chain did not answer.",
  "memecoin.failedHint":
    "Every pair here is built from swap events read straight off chain 4663, and that read did not come back.",

  "faq.healthy.q": "What does Healthy filter for?",
  "faq.healthy.a":
    "Two ratios the trading write-ups agree on, and a dollar floor. Liquidity has to be at least a tenth of the market cap — the usual guidance is ten to twenty percent, and under it a position cannot be closed anywhere near the price on screen, which is what a rug is before anyone has to be dishonest. Fully diluted has to be no more than twice the market cap: under two is called healthy and means the supply is mostly out already, while over five is the danger line and eight to ten means around nine tenths of it is still waiting to land on whoever bought early. On top of both, the market cap, the volume and the fully diluted figure each have to clear a thousand dollars.\n\nVolume is a dollar floor rather than a ratio on purpose. The published ratios are against a day of trading — thirty percent of market cap by one account, a full turn by another — and this screen sees five minutes. Dividing a daily figure by two hundred and eighty-eight would assume a token trades evenly around the clock, which is the one thing a memecoin never does.\n\nThe LIQ figure on a row turns amber on its own when the pool is under that tenth, whether or not the filter is on.",
  "faq.bands.q": "What do Pumping, Flat and Dumping mean?",
  "faq.bands.a":
    "They band the move across the same five minutes the rest of the screen covers: up fifty percent or more, down fifty or more, or inside ten either way. Fifty is the line because on this chain it is an ordinary five minutes — the list routinely carries a token up three hundred percent beside one down forty, and a band drawn at ten would hold everything. Flat means flat for five minutes, which is not the same as accumulating: that is a claim about hours, and hours are not something this endpoint will serve.",
  "faq.window.q": "Why does the memes screen only cover five minutes?",
  "faq.window.a":
    "Because that is what the chain will hand over in one question. Chain 4663 settles a block every hundred milliseconds and puts about four thousand swaps in five minutes, which is close to the most the public endpoint returns at once — ask for fifteen and it refuses. Narrowing to a handful of pools buys no more reach. So the column says 5m, because five minutes is what there is, and a screen labelled 24h would be inventing the other twenty-three.",

  "settings.faq": "Questions",

  "faq.numbers.q": "Where do these balances come from?",
  "faq.numbers.a":
    "Which tokens an address holds is a question no single chain call answers, so the chain's explorer is asked for the list — that is how every wallet does it. The amounts are not taken from it: every listed token is read back off the chain in one call, and what you see is what the chain returned. A figure the chain would not confirm is marked.",
  "faq.total.q": "Why is the total lower than what I hold?",
  "faq.total.a":
    "Only holdings something has priced are counted. Two thirds of the tokens on this chain have no price at all, and counting those as nothing would be as wrong as counting them as anything else. Tokens you have hidden are left out too.",
  "faq.small.q": "Where did my small holdings go?",
  "faq.small.a":
    "Anything worth under a dollar is folded away, the unpriced with it, so that what is worth reading is not buried under a couple of hundred airdrops. The line under the list says how many, and a tap brings them back. The coin is never folded, whatever it is worth, because gas comes out of it.",
  "faq.marked.q": "Why is a token marked?",
  "faq.marked.a":
    "One of two reasons. Either something else in this wallet answers to the same ticker — anyone can deploy a token under any letters they like, and thirty-five separate contracts on this chain call themselves USDG — or the name is an advertisement carrying a web address. Nothing real asks you to visit a site to claim, verify or unfreeze anything. The contract address on a token's own screen is the only thing that says which token you are holding.",
  "faq.hide.q": "What happens when I hide a token?",
  "faq.hide.a":
    "It stops being listed here and stops counting toward the total, and nothing else. The token is still in the wallet, still yours and still sellable — hiding is a note this app keeps for itself, not something the chain is told. The line under the list brings them all back.",
  "faq.approve.q": "Why does selling ask for two signatures?",
  "faq.approve.a":
    "A router cannot move a token it has not been allowed to move, so the first signature is the allowance and the second is the sale. The allowance is written for exactly the amount being sold rather than the unlimited one most apps ask for, so nothing is left standing behind you once the trade is done.",
  "faq.slippage.q": "Why can I not choose a slippage?",
  "faq.slippage.a":
    "Slippage is a bet on how far a pool moves between the quote and the block the trade lands in — not something you can see, and something the pool can answer. Every quote goes out beside a hundredth of itself, and the gap between the two prices is how far this trade moves the pool. One that barely moves gets the smallest bound there is; one that moves gets a margin above what it moved. Past five percent it stops being a tolerance and the trade is refused instead.",
  "faq.nosell.q": "Why can I not sell some tokens?",
  "faq.nosell.a":
    "Nothing on this chain trades them. A token can be held, named and even priced without a pool existing for it here, and this app will not invent a market that is not there.",

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
  "balance.hide": "Sembunyikan dari daftar ini",
  "balance.unhide": "Tampilkan lagi",
  "balance.hidden": "{count} disembunyikan",
  "balance.hiddenLess": "Simpan lagi yang disembunyikan",
  "memecoin.live": "Di bawah $10M · 5m",
  "memecoin.gradeAll": "Semua",
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
  "memecoin.empty": "Tidak ada yang diperdagangkan dalam lima menit terakhir.",
  "memecoin.emptyHint":
    "Layar ini membaca chain, bukan sebuah daftar, jadi layar kosong berarti lima menit yang kosong. Ia akan terisi lagi dengan sendirinya.",
  "memecoin.failed": "Chain tidak menjawab.",
  "memecoin.failedHint":
    "Setiap pair di sini dibangun dari event swap yang dibaca langsung dari chain 4663, dan bacaan itu tidak kembali.",

  "faq.healthy.q": "Saringan Sehat itu menyaring apa?",
  "faq.healthy.a":
    "Dua rasio yang disepakati tulisan-tulisan trading, plus satu lantai dolar. Likuiditas harus minimal sepersepuluh market cap — panduan umumnya sepuluh sampai dua puluh persen, dan di bawah itu sebuah posisi tidak bisa ditutup mendekati harga yang tertera di layar, dan itulah rug sebelum ada yang perlu berbohong. Nilai terdilusi penuh maksimal dua kali market cap: di bawah dua disebut sehat dan berarti suplainya sudah sebagian besar beredar, sementara di atas lima adalah garis bahaya dan delapan sampai sepuluh berarti sekitar sembilan persepuluh suplainya masih menunggu untuk mendarat di atas siapa pun yang membeli awal. Di atas keduanya, market cap, volume, dan nilai terdilusi masing-masing harus melewati seribu dolar.\n\nVolume sengaja jadi lantai dolar, bukan rasio. Rasio yang diterbitkan dihitung terhadap perdagangan sehari — tiga puluh persen market cap menurut satu sumber, satu putaran penuh menurut yang lain — sementara layar ini melihat lima menit. Membagi angka harian dengan dua ratus delapan puluh delapan akan mengandaikan token diperdagangkan merata sepanjang hari, dan itu satu-satunya hal yang tidak pernah dilakukan memecoin.\n\nAngka LIQ di sebuah baris berubah kuning dengan sendirinya kalau pool-nya di bawah sepersepuluh itu, saringannya menyala atau tidak.",
  "faq.bands.q": "Apa arti Naik, Datar, dan Jatuh?",
  "faq.bands.a":
    "Ketiganya mengelompokkan pergerakan dalam lima menit yang sama dengan sisa layar ini: naik lima puluh persen atau lebih, turun lima puluh atau lebih, atau dalam sepuluh persen ke arah mana pun. Lima puluh jadi garisnya karena di chain ini itu lima menit yang biasa saja — daftarnya rutin memuat token naik tiga ratus persen bersebelahan dengan yang turun empat puluh, dan garis di sepuluh akan memuat semuanya. Datar berarti datar selama lima menit, dan itu bukan akumulasi: akumulasi itu klaim tentang berjam-jam, dan berjam-jam bukan sesuatu yang diberikan endpoint ini.",
  "faq.window.q": "Kenapa layar memes cuma mencakup lima menit?",
  "faq.window.a":
    "Karena itu yang diberikan chain dalam satu pertanyaan. Chain 4663 menutup blok tiap seratus milidetik dan menampung sekitar empat ribu swap dalam lima menit — mendekati batas yang dikembalikan endpoint publik sekali jalan; minta lima belas menit dan ia menolak. Mempersempit ke segelintir pool pun tidak menambah jangkauan. Jadi kolomnya tertulis 5m, karena lima menit itulah yang ada, dan layar berlabel 24 jam akan mengarang dua puluh tiga jam sisanya.",

  "settings.faq": "Pertanyaan",

  "faq.numbers.q": "Angka saldo ini datang dari mana?",
  "faq.numbers.a":
    "Token apa saja yang dipegang sebuah alamat tidak bisa dijawab satu panggilan chain mana pun, jadi daftarnya ditanyakan ke explorer chain ini — begitu pula cara setiap dompet bekerja. Jumlahnya tidak diambil dari sana: setiap token yang didaftar dibaca ulang dari chain dalam satu panggilan, dan yang kamu lihat adalah jawaban chain. Angka yang tidak dikonfirmasi chain akan ditandai.",
  "faq.total.q": "Kenapa totalnya lebih kecil dari yang saya pegang?",
  "faq.total.a":
    "Hanya yang ada harganya yang dihitung. Dua pertiga token di chain ini sama sekali tidak punya harga, dan menghitungnya sebagai nol sama kelirunya dengan menghitungnya sebagai angka lain. Token yang kamu sembunyikan juga tidak ikut.",
  "faq.small.q": "Ke mana perginya token-token kecil saya?",
  "faq.small.a":
    "Apa pun yang bernilai di bawah satu dolar dilipat, termasuk yang tak berharga, supaya yang layak dibaca tidak terkubur di bawah ratusan airdrop. Baris di bawah daftar menyebut berapa banyak, dan satu ketukan mengembalikannya. Koinnya sendiri tidak pernah dilipat berapa pun nilainya, karena gas dibayar dengannya.",
  "faq.marked.q": "Kenapa ada token yang ditandai?",
  "faq.marked.a":
    "Salah satu dari dua sebab. Ada token lain di dompet ini yang memakai ticker yang sama — siapa pun bisa menerbitkan token dengan huruf apa pun, dan tiga puluh lima kontrak berbeda di chain ini mengaku USDG — atau namanya sebuah iklan yang membawa alamat web. Tidak ada hal asli yang menyuruhmu datang ke sebuah situs untuk mengklaim, memverifikasi atau membuka blokir apa pun. Alamat kontrak di layar token itu satu-satunya yang menyatakan token mana yang kamu pegang.",
  "faq.hide.q": "Apa yang terjadi kalau saya sembunyikan token?",
  "faq.hide.a":
    "Ia berhenti didaftar di sini dan berhenti dihitung ke total, dan hanya itu. Tokennya tetap ada di dompet, tetap milikmu dan tetap bisa dijual — menyembunyikan adalah catatan yang disimpan aplikasi ini sendiri, bukan sesuatu yang diberitahukan ke chain. Baris di bawah daftar mengembalikan semuanya.",
  "faq.approve.q": "Kenapa menjual minta dua tanda tangan?",
  "faq.approve.a":
    "Router tidak bisa memindahkan token yang belum diizinkan, jadi tanda tangan pertama adalah izinnya dan yang kedua penjualannya. Izin itu ditulis persis sebanyak yang dijual, bukan izin tak terbatas seperti kebanyakan aplikasi, jadi tidak ada sisa yang tertinggal di belakangmu setelah transaksinya selesai.",
  "faq.slippage.q": "Kenapa saya tidak bisa memilih slippage?",
  "faq.slippage.a":
    "Slippage itu taruhan tentang seberapa jauh pool bergeser antara quote dan blok tempat transaksinya mendarat — bukan sesuatu yang bisa kamu lihat, dan justru bisa dijawab pool-nya. Setiap quote dikirim berdampingan dengan seperseratus dirinya, dan selisih kedua harganya adalah seberapa jauh transaksi ini menggeser pool. Yang nyaris tidak bergeser mendapat batas terkecil yang ada; yang bergeser mendapat margin di atas pergeserannya. Di atas lima persen itu bukan lagi toleransi, dan transaksinya ditolak.",
  "faq.nosell.q": "Kenapa ada token yang tidak bisa saya jual?",
  "faq.nosell.a":
    "Tidak ada yang memperdagangkannya di chain ini. Sebuah token bisa dipegang, punya nama, bahkan punya harga, tanpa ada pool untuknya di sini — dan aplikasi ini tidak akan mengarang pasar yang tidak ada.",

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
