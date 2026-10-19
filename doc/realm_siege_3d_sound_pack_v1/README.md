# Realm Siege 3D — Original Sound Pack v1

**Paket:** 62 audio assets orisinal untuk MOBA browser `Realm Siege 3D`  
**Format:** Ogg Vorbis (`.ogg`), 44.1 kHz  
**Target:** Three.js + TypeScript + Vite  
**Karakter:** layered dark-fantasy / stylized MOBA sound design  
**Sumber:** disintesis secara prosedural khusus untuk pack ini; tidak memakai audio Dota 2 atau mengambil sampel dari game komersial lain.

> Catatan mutu: pack ini sengaja menggunakan beberapa lapisan transient, tonal body, filtered noise, pitch sweep, dan tail/reverb sintetis agar tidak terdengar seperti beep UI sederhana. Ini adalah sound pack orisinal yang siap diintegrasikan, bukan klaim bahwa suaranya setara dengan sound production AAA yang dibuat sound designer menggunakan rekaman Foley, library profesional, mixing, dan mastering khusus.

## 1. Isi paket

```text
realm_siege_3d_sound_pack_v1/
├── audio/
│   ├── ui/
│   ├── combat/
│   ├── heroes/
│   │   ├── arcane-knight/
│   │   ├── shadow-huntress/
│   │   ├── ember-mage/
│   │   ├── nature-guardian/
│   │   └── storm-warrior/
│   ├── structures/
│   └── ambience/
├── sound_manifest.json
├── preview.html
├── PROMPT_INTEGRASI_PUTER_AI.md
├── LICENSES.md
└── README.md
```

Jumlah: **62 file audio**. Efek SFX mayoritas mono agar dapat diposisikan sebagai positional audio di Three.js. Loop ambience berupa stereo dan harus diputar sebagai background/non-positional audio.

## 2. Cara memasang file ke Vite

Ekstrak ZIP, kemudian salin seluruh folder `audio/` dari paket ini ke:

```text
<root-project>/public/audio/realm-siege/
```

Contoh hasil:

```text
public/audio/realm-siege/ui/ui-click.ogg
public/audio/realm-siege/combat/melee-swing-light.ogg
public/audio/realm-siege/heroes/ember-mage/fire-bolt.ogg
public/audio/realm-siege/structures/core-destroy.ogg
public/audio/realm-siege/ambience/wind-loop.ogg
```

Jangan mengubah nama file atau struktur subfolder kecuali path di `sound_manifest.json` dan kode pemanggil juga diperbarui.

Path runtime untuk Vite sebaiknya mengikuti `import.meta.env.BASE_URL` agar tetap berfungsi saat deploy ke Cloudflare Pages dengan base path tertentu. Hindari hotlink audio eksternal.

## 3. Integrasi audio — prinsip penting

1. **Gunakan audio engine yang sudah ada** di project. Jangan membuat `AudioManager` kedua apabila Phase audio sebelumnya sudah membuat satu.
2. Sambungkan suara ke event gameplay aktual, bukan ke render loop dan bukan ke animasi yang diperbarui setiap frame.
3. Pisahkan event `cast/launch` dari `impact/hit` bila keduanya memang berbeda.
4. Jangan menumpuk sound effect khusus yang sudah berisi ledakan dengan generic impact yang sama kerasnya.
5. Trigger `core-critical` satu kali saat core melewati threshold kritis; jangan putar berulang setiap frame.
6. `burning-zone-loop.ogg` hanya boleh di-loop jika game benar-benar memiliki zona api yang persisten. Jika skill saat ini hanya memberi damage sekali, gunakan `burning-zone-ignition.ogg` sebagai one-shot dan jangan membuat loop palsu.
7. Loop ambience harus memiliki fade-in/fade-out, dan dihentikan atau diredam ketika state game berubah.
8. Atur gain per sound/bus, jangan menaikkan seluruh SFX ke 100%. Pakai priority/concurrency limit untuk creep dan combat yang berulang.
9. Pertahankan input touch/mobile, keyboard, mouse, cooldown, mana, target, range, dan aturan combat yang sudah ada.
10. Browser biasanya memerlukan interaksi pengguna sebelum audio aktif. Resume AudioContext melalui tombol Play/Start yang sudah ada.

## 4. File manifest

`sound_manifest.json` menyimpan tiap asset:

- `id`: ID stabil yang disarankan untuk audio event.
- `file`: path relatif terhadap folder `audio/`.
- `durationSeconds`: durasi file.
- `loop`: apakah asset dirancang untuk loop.
- `spatial`: `true` untuk suara dunia mono; `false` untuk audio stereo/non-positional.
- `recommendedVolume`: gain awal relatif dalam rentang `0–1`.
- `description`: karakter suara.
- `trigger`: rekomendasi event gameplay.

Jadikan manifest sebagai referensi mapping, tidak harus sebagai runtime format persis. Adaptasi ke struktur audio engine yang sudah ada.

## 5. Mapping UI dan match

| File | Trigger |
|---|---|
| `ui/ui-hover.ogg` | Hover desktop saja; debounce dan jangan spam |
| `ui/ui-click.ogg` | Klik/tap tombol UI |
| `ui/ui-confirm.ogg` | Konfirmasi yang berhasil |
| `ui/ui-error.ogg` | Mana kurang, cooldown aktif, atau aksi tidak valid; jangan berlebihan |
| `ui/hero-select.ogg` | Hero dipilih |
| `ui/match-start.ogg` | Match dimulai |
| `ui/pause.ogg` / `ui/resume.ogg` | Pause / resume |
| `ui/shop-open.ogg` | Shop dibuka |
| `ui/item-purchase.ogg` | Pembelian item berhasil |
| `ui/level-up.ogg` | Level hero naik |
| `ui/gold-reward.ogg` | Reward gold penting; throttle jika banyak reward |
| `ui/victory-stinger.ogg` | Victory state, sekali |
| `ui/defeat-stinger.ogg` | Defeat state, sekali |

## 6. Mapping combat

| File | Trigger |
|---|---|
| `combat/move-command.ogg` | Klik/tap perintah bergerak; debounce |
| `combat/footstep-grass-1..3.ogg` | Footstep player ketika benar-benar bergerak; pilih variasi acak |
| `combat/melee-swing-light.ogg` | Wind-up serangan melee ringan |
| `combat/melee-swing-heavy.ogg` | Wind-up serangan melee berat |
| `combat/melee-impact-light.ogg` | Hit melee ringan yang terkonfirmasi |
| `combat/melee-impact-heavy.ogg` | Hit melee berat yang terkonfirmasi |
| `combat/ranged-launch.ogg` | Projectile fisik diluncurkan |
| `combat/arrow-impact.ogg` | Projectile panah fisik benar-benar mengenai target |
| `combat/magic-launch.ogg` | Projectile magic diluncurkan |
| `combat/magic-impact.ogg` | Projectile magic mengenai target |
| `combat/hero-hit.ogg` | Player hero menerima damage; throttle |
| `combat/shield-impact.ogg` | Shield benar-benar menyerap hit |
| `combat/hero-death.ogg` | Hero mati |
| `combat/hero-respawn.ogg` | Hero respawn |

**Catatan:** gunakan satu impact utama untuk satu hit. Hindari memutar `hero-hit`, `melee-impact`, `magic-impact`, dan `shield-impact` sekaligus untuk hit yang sama. Pilih kombinasi paling sesuai berdasarkan event aktual.

## 7. Mapping skill setiap hero

Pakai nama hero dan ability dari source code project sebagai acuan. Indeks Q/W/E/R di bawah hanya referensi berdasarkan hero definitions yang digunakan dalam `Realm Siege 3D`.

| Hero | Skill | Asset |
|---|---|---|
| Arcane Knight | Q — Arcane Strike | `heroes/arcane-knight/arcane-strike.ogg` |
| Arcane Knight | W — Shield Wall | `heroes/arcane-knight/arcane-shield.ogg` |
| Arcane Knight | E — Ground Slam | `heroes/arcane-knight/ground-slam.ogg` |
| Arcane Knight | R — Meteor Prison | `heroes/arcane-knight/meteor-prison.ogg` |
| Shadow Huntress | Q — Shadow Dash | `heroes/shadow-huntress/shadow-dash.ogg` |
| Shadow Huntress | W — Poison Arrow | `heroes/shadow-huntress/poison-arrow.ogg` |
| Shadow Huntress | E — Smoke Veil | `heroes/shadow-huntress/smoke-veil.ogg` |
| Shadow Huntress | R — Death Mark | `heroes/shadow-huntress/death-mark.ogg` |
| Ember Mage | Q — Fire Bolt | `heroes/ember-mage/fire-bolt.ogg` |
| Ember Mage | W — Flame Wave | `heroes/ember-mage/flame-wave.ogg` |
| Ember Mage | E — Burning Zone | `heroes/ember-mage/burning-zone-ignition.ogg` |
| Ember Mage | E — persistent loop, bila didukung gameplay | `heroes/ember-mage/burning-zone-loop.ogg` |
| Ember Mage | R — Inferno Storm | `heroes/ember-mage/inferno-storm.ogg` |
| Nature Guardian | Q — Healing Seed | `heroes/nature-guardian/healing-seed.ogg` |
| Nature Guardian | W — Root Trap | `heroes/nature-guardian/root-trap.ogg` |
| Nature Guardian | E — Nature Barrier | `heroes/nature-guardian/nature-barrier.ogg` |
| Nature Guardian | R — Forest Rebirth | `heroes/nature-guardian/forest-rebirth.ogg` |
| Storm Warrior | Q — Lightning Punch | `heroes/storm-warrior/lightning-punch.ogg` |
| Storm Warrior | W — Static Field | `heroes/storm-warrior/static-field.ogg` |
| Storm Warrior | E — Thunder Charge | `heroes/storm-warrior/thunder-charge.ogg` |
| Storm Warrior | R — Storm Rage | `heroes/storm-warrior/storm-rage.ogg` |

Trigger asset skill tepat satu kali pada cast atau impact sesuai desain clip dan logika skill. Skill yang clip-nya sudah mencakup transient impact kuat tidak perlu ditumpuk lagi dengan ledakan generik yang identik.

## 8. Structures dan ambience

| File | Trigger |
|---|---|
| `structures/tower-shot.ogg` | Tower meluncurkan proyektil |
| `structures/tower-impact.ogg` | Proyektil tower mengenai target |
| `structures/tower-destroy.ogg` | Tower hancur, sekali |
| `structures/core-hit.ogg` | Core terkena damage |
| `structures/core-critical.ogg` | Core pertama kali melewati threshold critical |
| `structures/core-destroy.ogg` | Core hancur, sekali; prioritas tinggi |
| `structures/boss-attack.ogg` | Serangan boss; jika boss ada dalam game |
| `structures/boss-death.ogg` | Boss mati; jika boss ada dalam game |
| `ambience/wind-loop.ogg` | Background ambience pelan saat match |
| `ambience/forest-loop.ogg` | Ambient layer opsional dekat jungle |
| `ambience/river-loop.ogg` | Ambient layer opsional dekat sungai |

Jangan mengimplementasikan event boss atau surface types yang belum ada. Jika game belum memiliki fitur tersebut, abaikan asset itu sampai fiturnya tersedia.

## 9. Setelan awal yang disarankan

Nilai dalam manifest adalah gain awal relatif, bukan persentase final/master loudness. Campurkan dengan volume bus pemain.

- UI click/hover: sangat rendah.
- Footsteps/move command: rendah.
- Basic attack: menengah dan pendek.
- Ability biasa: menengah, dengan ruang untuk hit feedback.
- Ultimate / tower destruction: lebih menonjol, tetapi jangan sampai clipping.
- Core destruction: event besar, sekali, lalu fade.
- Ambient loops: sangat rendah dibanding combat.

Simpan preferences yang sudah dimiliki game; jangan menimpa setting pemain ketika menambah asset baru.

## 10. Preview

Buka `preview.html` di browser untuk memainkan setiap file satu per satu. Jika browser membatasi pemutaran `file://`, jalankan server lokal di folder paket:

```bash
python -m http.server 8080
```

Lalu buka `http://localhost:8080/preview.html`.

## 11. Kriteria integrasi selesai

- Tidak ada sound yang diputar per frame.
- Q/W/E/R memiliki cue yang sesuai dengan hero masing-masing.
- Cast dan impact tidak salah timing.
- Suara hit tidak berlapis berlebihan.
- Core critical, tower destroy, victory, dan defeat tidak berulang.
- Volume, mute, mobile touch, keyboard, mouse, pause/resume, dan restart tetap bekerja.
- `npm run typecheck`, `npm test`, dan `npm run build` dijalankan sesuai script yang tersedia.
- Hasil verifikasi browser dilaporkan secara jujur; build sukses saja bukan bukti bahwa suara benar-benar terdengar.
