# Third-Party Licenses

This file lists all third-party dependencies used by HashCerebrum and their
respective licenses. HashCerebrum itself is licensed under the AGPL-3.0-or-later
(see `LICENSE`).

It is generated from `src-tauri/Cargo.lock` and `package-lock.json` by
`npm run licenses`. Do not edit it by hand: re-run the script after any
dependency change.

---

## Table of Contents

- [Rust Dependencies](#rust-dependencies)
- [NPM Dependencies](#npm-dependencies)
- [License Summary](#license-summary)
- [License Notices](#license-notices)

---

## Rust Dependencies

The following 753 Rust crates are used by the Tauri backend (`src-tauri/`).
Every crate in `Cargo.lock` is listed, including crates built only on other
platforms or only for tests.

| Crate | Version | License |
|-------|---------|---------|
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 |
| aes | 0.8.4 | MIT OR Apache-2.0 |
| ahash | 0.8.12 | MIT OR Apache-2.0 |
| aho-corasick | 1.1.4 | Unlicense OR MIT |
| alloc-no-stdlib | 2.0.4 | BSD-3-Clause |
| alloc-stdlib | 0.2.2 | BSD-3-Clause |
| android_system_properties | 0.1.5 | MIT/Apache-2.0 |
| anyhow | 1.0.103 | MIT OR Apache-2.0 |
| approx | 0.5.1 | Apache-2.0 |
| ar_archive_writer | 0.5.1 | Apache-2.0 WITH LLVM-exception |
| arrayref | 0.3.9 | BSD-2-Clause |
| arrayvec | 0.7.6 | MIT OR Apache-2.0 |
| async-broadcast | 0.7.2 | MIT OR Apache-2.0 |
| async-channel | 2.5.0 | Apache-2.0 OR MIT |
| async-compression | 0.4.42 | MIT OR Apache-2.0 |
| async-executor | 1.14.0 | Apache-2.0 OR MIT |
| async-io | 2.6.0 | Apache-2.0 OR MIT |
| async-lock | 3.4.2 | Apache-2.0 OR MIT |
| async-process | 2.5.0 | Apache-2.0 OR MIT |
| async-recursion | 1.1.1 | MIT OR Apache-2.0 |
| async-signal | 0.2.14 | Apache-2.0 OR MIT |
| async-task | 4.7.1 | Apache-2.0 OR MIT |
| async-trait | 0.1.89 | MIT OR Apache-2.0 |
| atk | 0.18.2 | MIT |
| atk-sys | 0.18.2 | MIT |
| atomic-waker | 1.1.2 | Apache-2.0 OR MIT |
| autocfg | 1.5.1 | Apache-2.0 OR MIT |
| az | 1.3.0 | MIT/Apache-2.0 |
| base64 | 0.21.7 | MIT OR Apache-2.0 |
| base64 | 0.22.1 | MIT OR Apache-2.0 |
| biblatex | 0.11.0 | MIT OR Apache-2.0 |
| bincode | 1.3.3 | MIT |
| bit-set | 0.8.0 | Apache-2.0 OR MIT |
| bit-vec | 0.8.0 | Apache-2.0 OR MIT |
| bitflags | 1.3.2 | MIT/Apache-2.0 |
| bitflags | 2.11.1 | MIT OR Apache-2.0 |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 |
| block-padding | 0.3.3 | MIT OR Apache-2.0 |
| block2 | 0.6.2 | MIT |
| blocking | 1.6.2 | Apache-2.0 OR MIT |
| brotli | 8.0.2 | BSD-3-Clause AND MIT |
| brotli-decompressor | 5.0.0 | BSD-3-Clause/MIT |
| bs58 | 0.5.1 | MIT/Apache-2.0 |
| bumpalo | 3.20.3 | MIT OR Apache-2.0 |
| by_address | 1.2.1 | MIT OR Apache-2.0 |
| bytemuck | 1.25.0 | Zlib OR Apache-2.0 OR MIT |
| bytemuck_derive | 1.10.2 | Zlib OR Apache-2.0 OR MIT |
| byteorder | 1.5.0 | Unlicense OR MIT |
| byteorder-lite | 0.1.0 | Unlicense OR MIT |
| bytes | 1.11.1 | MIT |
| cairo-rs | 0.18.5 | MIT |
| cairo-sys-rs | 0.18.2 | MIT |
| camino | 1.2.2 | MIT OR Apache-2.0 |
| cargo-platform | 0.1.9 | MIT OR Apache-2.0 |
| cargo_metadata | 0.19.2 | MIT |
| cargo_toml | 0.22.3 | Apache-2.0 OR MIT |
| cbc | 0.1.2 | MIT OR Apache-2.0 |
| cc | 1.2.62 | MIT OR Apache-2.0 |
| cesu8 | 1.1.0 | Apache-2.0/MIT |
| cfb | 0.7.3 | MIT |
| cfg-expr | 0.15.8 | MIT OR Apache-2.0 |
| cfg-if | 1.0.4 | MIT OR Apache-2.0 |
| cfg_aliases | 0.2.1 | MIT |
| chacha20 | 0.10.0 | MIT OR Apache-2.0 |
| chinese-number | 0.7.8 | MIT |
| chinese-variant | 1.1.5 | MIT |
| chrono | 0.4.45 | MIT OR Apache-2.0 |
| ciborium | 0.2.2 | Apache-2.0 |
| ciborium-io | 0.2.2 | Apache-2.0 |
| ciborium-ll | 0.2.2 | Apache-2.0 |
| cipher | 0.4.4 | MIT OR Apache-2.0 |
| citationberg | 0.6.1 | MIT OR Apache-2.0 |
| cobs | 0.3.0 | MIT OR Apache-2.0 |
| codex | 0.2.0 | Apache-2.0 |
| color_quant | 1.1.0 | MIT |
| combine | 4.6.7 | MIT |
| comemo | 0.5.1 | MIT OR Apache-2.0 |
| comemo-macros | 0.5.1 | MIT OR Apache-2.0 |
| compression-codecs | 0.4.38 | MIT OR Apache-2.0 |
| compression-core | 0.4.32 | MIT OR Apache-2.0 |
| concurrent-queue | 2.5.0 | Apache-2.0 OR MIT |
| cookie | 0.18.1 | MIT OR Apache-2.0 |
| core-foundation | 0.10.1 | MIT OR Apache-2.0 |
| core-foundation-sys | 0.8.7 | MIT OR Apache-2.0 |
| core-graphics | 0.25.0 | MIT OR Apache-2.0 |
| core-graphics-types | 0.2.0 | MIT OR Apache-2.0 |
| core_maths | 0.1.1 | MIT |
| cpufeatures | 0.2.17 | MIT OR Apache-2.0 |
| cpufeatures | 0.3.0 | MIT OR Apache-2.0 |
| crc32fast | 1.5.0 | MIT OR Apache-2.0 |
| crossbeam-channel | 0.5.15 | MIT OR Apache-2.0 |
| crossbeam-deque | 0.8.6 | MIT OR Apache-2.0 |
| crossbeam-epoch | 0.9.20 | MIT OR Apache-2.0 |
| crossbeam-utils | 0.8.21 | MIT OR Apache-2.0 |
| crunchy | 0.2.4 | MIT |
| crypto-common | 0.1.7 | MIT OR Apache-2.0 |
| cssparser | 0.36.0 | MPL-2.0 |
| cssparser-macros | 0.6.1 | MPL-2.0 |
| csv | 1.4.0 | Unlicense/MIT |
| csv-core | 0.1.13 | Unlicense/MIT |
| ctor | 0.8.0 | Apache-2.0 OR MIT |
| ctor-proc-macro | 0.0.7 | Apache-2.0 OR MIT |
| darling | 0.23.0 | MIT |
| darling_core | 0.23.0 | MIT |
| darling_macro | 0.23.0 | MIT |
| dashmap | 6.2.1 | MIT |
| data-url | 0.3.2 | MIT OR Apache-2.0 |
| dbus | 0.9.11 | Apache-2.0/MIT |
| defmt | 1.1.0 | MIT OR Apache-2.0 |
| defmt-macros | 1.1.0 | MIT OR Apache-2.0 |
| defmt-parser | 1.0.0 | MIT OR Apache-2.0 |
| deranged | 0.5.8 | MIT OR Apache-2.0 |
| derive_more | 2.1.1 | MIT |
| derive_more-impl | 2.1.1 | MIT |
| digest | 0.10.7 | MIT OR Apache-2.0 |
| dirs | 6.0.0 | MIT OR Apache-2.0 |
| dirs-sys | 0.5.0 | MIT OR Apache-2.0 |
| dispatch2 | 0.3.1 | Zlib OR Apache-2.0 OR MIT |
| displaydoc | 0.2.5 | MIT OR Apache-2.0 |
| dlopen2 | 0.8.2 | MIT |
| dlopen2_derive | 0.4.3 | MIT |
| dom_query | 0.27.0 | MIT |
| dpi | 0.1.2 | Apache-2.0 AND MIT |
| dtoa | 1.0.11 | MIT OR Apache-2.0 |
| dtoa-short | 0.3.5 | MPL-2.0 |
| dtor | 0.3.0 | Apache-2.0 OR MIT |
| dtor-proc-macro | 0.0.6 | Apache-2.0 OR MIT |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 |
| dyn-clone | 1.0.20 | MIT OR Apache-2.0 |
| ecb | 0.1.2 | MIT |
| ecow | 0.2.6 | MIT OR Apache-2.0 |
| either | 1.16.0 | MIT OR Apache-2.0 |
| embed-resource | 3.0.9 | MIT |
| embed_plist | 1.2.2 | MIT OR Apache-2.0 |
| embedded-io | 0.4.0 | MIT OR Apache-2.0 |
| embedded-io | 0.6.1 | MIT OR Apache-2.0 |
| encoding_rs | 0.8.35 | (Apache-2.0 OR MIT) AND BSD-3-Clause |
| endi | 1.1.1 | MIT |
| enum-ordinalize | 4.3.2 | MIT |
| enum-ordinalize-derive | 4.3.2 | MIT |
| enumflags2 | 0.7.12 | MIT OR Apache-2.0 |
| enumflags2_derive | 0.7.12 | MIT OR Apache-2.0 |
| equivalent | 1.0.2 | Apache-2.0 OR MIT |
| erased-serde | 0.4.10 | MIT OR Apache-2.0 |
| errno | 0.3.14 | MIT OR Apache-2.0 |
| euclid | 0.22.14 | MIT OR Apache-2.0 |
| event-listener | 5.4.1 | Apache-2.0 OR MIT |
| event-listener-strategy | 0.5.4 | Apache-2.0 OR MIT |
| fallible-iterator | 0.3.0 | MIT/Apache-2.0 |
| fallible-streaming-iterator | 0.1.9 | MIT/Apache-2.0 |
| fancy-regex | 0.16.2 | MIT |
| fast-srgb8 | 1.0.0 | MIT OR Apache-2.0 OR CC0-1.0 |
| fastrand | 2.4.1 | Apache-2.0 OR MIT |
| fdeflate | 0.3.7 | MIT OR Apache-2.0 |
| field-offset | 0.3.6 | MIT OR Apache-2.0 |
| find-msvc-tools | 0.1.9 | MIT OR Apache-2.0 |
| flate2 | 1.1.9 | MIT OR Apache-2.0 |
| float-cmp | 0.9.0 | MIT |
| float-cmp | 0.10.0 | MIT |
| fnv | 1.0.7 | Apache-2.0 / MIT |
| foldhash | 0.1.5 | Zlib |
| foldhash | 0.2.0 | Zlib |
| font-types | 0.10.1 | MIT OR Apache-2.0 |
| fontconfig-parser | 0.5.8 | MIT |
| fontdb | 0.23.0 | MIT |
| foreign-types | 0.5.0 | MIT/Apache-2.0 |
| foreign-types-macros | 0.2.3 | MIT/Apache-2.0 |
| foreign-types-shared | 0.3.1 | MIT/Apache-2.0 |
| form_urlencoded | 1.2.2 | MIT OR Apache-2.0 |
| futures | 0.3.34 | MIT OR Apache-2.0 |
| futures-channel | 0.3.34 | MIT OR Apache-2.0 |
| futures-core | 0.3.34 | MIT OR Apache-2.0 |
| futures-executor | 0.3.34 | MIT OR Apache-2.0 |
| futures-io | 0.3.34 | MIT OR Apache-2.0 |
| futures-lite | 2.6.1 | Apache-2.0 OR MIT |
| futures-macro | 0.3.34 | MIT OR Apache-2.0 |
| futures-sink | 0.3.34 | MIT OR Apache-2.0 |
| futures-task | 0.3.34 | MIT OR Apache-2.0 |
| futures-util | 0.3.34 | MIT OR Apache-2.0 |
| gdk | 0.18.2 | MIT |
| gdk-pixbuf | 0.18.5 | MIT |
| gdk-pixbuf-sys | 0.18.0 | MIT |
| gdk-sys | 0.18.2 | MIT |
| gdkwayland-sys | 0.18.2 | MIT |
| gdkx11 | 0.18.2 | MIT |
| gdkx11-sys | 0.18.2 | MIT |
| generic-array | 0.14.7 | MIT |
| getrandom | 0.2.17 | MIT OR Apache-2.0 |
| getrandom | 0.3.4 | MIT OR Apache-2.0 |
| getrandom | 0.4.2 | MIT OR Apache-2.0 |
| gif | 0.13.3 | MIT OR Apache-2.0 |
| gif | 0.14.2 | MIT OR Apache-2.0 |
| gio | 0.18.4 | MIT |
| gio-sys | 0.18.1 | MIT |
| glib | 0.18.5 | MIT |
| glib-macros | 0.18.5 | MIT |
| glib-sys | 0.18.1 | MIT |
| glidesort | 0.1.2 | MIT OR Apache-2.0 |
| glob | 0.3.3 | MIT OR Apache-2.0 |
| gobject-sys | 0.18.0 | MIT |
| gtk | 0.18.2 | MIT |
| gtk-sys | 0.18.2 | MIT |
| gtk3-macros | 0.18.2 | MIT |
| half | 2.7.1 | MIT OR Apache-2.0 |
| hashbrown | 0.12.3 | MIT OR Apache-2.0 |
| hashbrown | 0.14.5 | MIT OR Apache-2.0 |
| hashbrown | 0.15.5 | MIT OR Apache-2.0 |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 |
| hashlink | 0.9.1 | MIT OR Apache-2.0 |
| hayagriva | 0.9.1 | MIT OR Apache-2.0 |
| hayro | 0.4.0 | Apache-2.0 |
| hayro-font | 0.3.0 | Apache-2.0 |
| hayro-interpret | 0.4.0 | Apache-2.0 |
| hayro-svg | 0.2.0 | Apache-2.0 |
| hayro-syntax | 0.4.0 | Apache-2.0 |
| hayro-write | 0.3.0 | Apache-2.0 |
| heck | 0.4.1 | MIT OR Apache-2.0 |
| heck | 0.5.0 | MIT OR Apache-2.0 |
| hermit-abi | 0.5.2 | MIT OR Apache-2.0 |
| hex | 0.4.3 | MIT OR Apache-2.0 |
| html5ever | 0.38.0 | MIT OR Apache-2.0 |
| http | 1.4.0 | MIT OR Apache-2.0 |
| http-body | 1.0.1 | MIT |
| http-body-util | 0.1.3 | MIT |
| httparse | 1.10.1 | MIT OR Apache-2.0 |
| hyper | 1.9.0 | MIT |
| hyper-rustls | 0.27.9 | Apache-2.0 OR ISC OR MIT |
| hyper-util | 0.1.20 | MIT |
| hypher | 0.1.7 | MIT OR Apache-2.0 |
| iana-time-zone | 0.1.65 | MIT OR Apache-2.0 |
| iana-time-zone-haiku | 0.1.2 | MIT OR Apache-2.0 |
| ico | 0.5.0 | MIT |
| icu_collections | 1.5.0 | Unicode-3.0 |
| icu_collections | 2.2.0 | Unicode-3.0 |
| icu_locale_core | 2.2.0 | Unicode-3.0 |
| icu_locid | 1.5.0 | Unicode-3.0 |
| icu_locid_transform | 1.5.0 | Unicode-3.0 |
| icu_locid_transform_data | 1.5.1 | Unicode-3.0 |
| icu_normalizer | 2.2.0 | Unicode-3.0 |
| icu_normalizer_data | 2.2.0 | Unicode-3.0 |
| icu_properties | 1.5.1 | Unicode-3.0 |
| icu_properties | 2.2.0 | Unicode-3.0 |
| icu_properties_data | 1.5.1 | Unicode-3.0 |
| icu_properties_data | 2.2.0 | Unicode-3.0 |
| icu_provider | 1.5.0 | Unicode-3.0 |
| icu_provider | 2.2.0 | Unicode-3.0 |
| icu_provider_adapters | 1.5.0 | Unicode-3.0 |
| icu_provider_blob | 1.5.0 | Unicode-3.0 |
| icu_provider_macros | 1.5.0 | Unicode-3.0 |
| icu_segmenter | 1.5.0 | Unicode-3.0 |
| icu_segmenter_data | 1.5.1 | Unicode-3.0 |
| id-arena | 2.3.0 | MIT/Apache-2.0 |
| ident_case | 1.0.1 | MIT/Apache-2.0 |
| idna | 1.1.0 | MIT OR Apache-2.0 |
| idna_adapter | 1.2.2 | Apache-2.0 OR MIT |
| image | 0.25.10 | MIT OR Apache-2.0 |
| image-webp | 0.2.4 | MIT OR Apache-2.0 |
| imagesize | 0.13.0 | MIT |
| imagesize | 0.14.0 | MIT |
| indexmap | 1.9.3 | Apache-2.0 OR MIT |
| indexmap | 2.14.0 | Apache-2.0 OR MIT |
| infer | 0.19.0 | MIT |
| inout | 0.1.4 | MIT OR Apache-2.0 |
| ipnet | 2.12.0 | MIT OR Apache-2.0 |
| itoa | 1.0.18 | MIT OR Apache-2.0 |
| javascriptcore-rs | 1.1.2 | MIT |
| javascriptcore-rs-sys | 1.1.1 | MIT |
| jiff | 0.2.31 | Unlicense OR MIT |
| jiff-static | 0.2.31 | Unlicense OR MIT |
| jiff-tzdb | 0.1.6 | Unlicense OR MIT |
| jiff-tzdb-platform | 0.1.3 | Unlicense OR MIT |
| jni | 0.21.1 | MIT/Apache-2.0 |
| jni-sys | 0.3.1 | MIT OR Apache-2.0 |
| jni-sys | 0.4.1 | MIT OR Apache-2.0 |
| jni-sys-macros | 0.4.1 | MIT OR Apache-2.0 |
| js-sys | 0.3.99 | MIT OR Apache-2.0 |
| json-patch | 3.0.1 | MIT/Apache-2.0 |
| json5 | 0.4.1 | ISC |
| jsonptr | 0.6.3 | MIT OR Apache-2.0 |
| kamadak-exif | 0.6.1 | BSD-2-Clause |
| keyboard-types | 0.7.0 | MIT OR Apache-2.0 |
| krilla | 0.6.0 | MIT OR Apache-2.0 |
| krilla-svg | 0.3.0 | MIT OR Apache-2.0 |
| kurbo | 0.11.3 | Apache-2.0 OR MIT |
| kurbo | 0.12.0 | Apache-2.0 OR MIT |
| lazy_static | 1.5.0 | MIT OR Apache-2.0 |
| leb128fmt | 0.1.0 | MIT OR Apache-2.0 |
| libappindicator | 0.9.0 | Apache-2.0 OR MIT |
| libappindicator-sys | 0.9.0 | Apache-2.0 OR MIT |
| libc | 0.2.186 | MIT OR Apache-2.0 |
| libdbus-sys | 0.2.7 | Apache-2.0/MIT |
| libloading | 0.7.4 | ISC |
| libm | 0.2.16 | MIT |
| libredox | 0.1.16 | MIT |
| libsqlite3-sys | 0.30.1 | MIT |
| linked-hash-map | 0.5.6 | MIT/Apache-2.0 |
| linux-raw-sys | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| lipsum | 0.9.1 | MIT |
| litemap | 0.7.5 | Unicode-3.0 |
| litemap | 0.8.2 | Unicode-3.0 |
| lock_api | 0.4.14 | MIT OR Apache-2.0 |
| log | 0.4.29 | MIT OR Apache-2.0 |
| lopdf | 0.42.0 | MIT |
| lru-slab | 0.1.2 | MIT OR Apache-2.0 OR Zlib |
| mac-notification-sys | 0.6.12 | MIT/Apache-2.0 |
| markup5ever | 0.38.0 | MIT OR Apache-2.0 |
| matchers | 0.2.0 | MIT |
| md-5 | 0.10.6 | MIT OR Apache-2.0 |
| memchr | 2.8.0 | Unlicense OR MIT |
| memmap2 | 0.9.11 | MIT OR Apache-2.0 |
| memoffset | 0.9.1 | MIT |
| mime | 0.3.17 | MIT OR Apache-2.0 |
| miniz_oxide | 0.8.9 | MIT OR Zlib OR Apache-2.0 |
| mio | 1.2.0 | MIT |
| moxcms | 0.7.11 | BSD-3-Clause OR Apache-2.0 |
| moxcms | 0.8.1 | BSD-3-Clause OR Apache-2.0 |
| muda | 0.19.2 | Apache-2.0 OR MIT |
| mutate_once | 0.1.2 | BSD-2-Clause |
| ndk | 0.9.0 | MIT OR Apache-2.0 |
| ndk-sys | 0.6.0+11769913 | MIT OR Apache-2.0 |
| new_debug_unreachable | 1.0.6 | MIT |
| nom | 8.0.0 | MIT |
| notify-rust | 4.17.0 | MIT/Apache-2.0 |
| nu-ansi-term | 0.50.3 | MIT |
| num-bigint | 0.4.6 | MIT OR Apache-2.0 |
| num-conv | 0.2.2 | MIT OR Apache-2.0 |
| num-integer | 0.1.46 | MIT OR Apache-2.0 |
| num-traits | 0.2.19 | MIT OR Apache-2.0 |
| num_enum | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| num_enum_derive | 0.7.6 | BSD-3-Clause OR MIT OR Apache-2.0 |
| objc2 | 0.6.4 | MIT |
| objc2-app-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-cloud-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-data | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-foundation | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-graphics | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-image | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-location | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-core-text | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-encode | 4.1.0 | MIT |
| objc2-exception-helper | 0.1.1 | Zlib OR Apache-2.0 OR MIT |
| objc2-foundation | 0.3.2 | MIT |
| objc2-io-surface | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-quartz-core | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-ui-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-user-notifications | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| objc2-web-kit | 0.3.2 | Zlib OR Apache-2.0 OR MIT |
| object | 0.37.3 | Apache-2.0 OR MIT |
| once_cell | 1.21.4 | MIT OR Apache-2.0 |
| option-ext | 0.2.0 | MPL-2.0 |
| ordered-stream | 0.2.0 | MIT OR Apache-2.0 |
| palette | 0.7.6 | MIT OR Apache-2.0 |
| palette_derive | 0.7.6 | MIT OR Apache-2.0 |
| pango | 0.18.3 | MIT |
| pango-sys | 0.18.0 | MIT |
| parking | 2.2.1 | Apache-2.0 OR MIT |
| parking_lot | 0.12.5 | MIT OR Apache-2.0 |
| parking_lot_core | 0.9.12 | MIT OR Apache-2.0 |
| paste | 1.0.15 | MIT OR Apache-2.0 |
| pdf-writer | 0.14.0 | MIT OR Apache-2.0 |
| percent-encoding | 2.3.2 | MIT OR Apache-2.0 |
| pest | 2.8.6 | MIT OR Apache-2.0 |
| pest_derive | 2.8.6 | MIT OR Apache-2.0 |
| pest_generator | 2.8.6 | MIT OR Apache-2.0 |
| pest_meta | 2.8.6 | MIT OR Apache-2.0 |
| phf | 0.13.1 | MIT |
| phf_codegen | 0.13.1 | MIT |
| phf_generator | 0.13.1 | MIT |
| phf_macros | 0.13.1 | MIT |
| phf_shared | 0.13.1 | MIT |
| pico-args | 0.5.0 | MIT |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT |
| piper | 0.2.5 | MIT OR Apache-2.0 |
| pkg-config | 0.3.33 | MIT OR Apache-2.0 |
| plist | 1.9.0 | MIT |
| png | 0.17.16 | MIT OR Apache-2.0 |
| png | 0.18.1 | MIT OR Apache-2.0 |
| polling | 3.11.0 | Apache-2.0 OR MIT |
| portable-atomic | 1.13.1 | Apache-2.0 OR MIT |
| portable-atomic-util | 0.2.7 | Apache-2.0 OR MIT |
| postcard | 1.1.3 | MIT OR Apache-2.0 |
| potential_utf | 0.1.5 | Unicode-3.0 |
| powerfmt | 0.2.0 | MIT OR Apache-2.0 |
| ppv-lite86 | 0.2.21 | MIT OR Apache-2.0 |
| precomputed-hash | 0.1.1 | MIT |
| prettyplease | 0.2.37 | MIT OR Apache-2.0 |
| proc-macro-crate | 1.3.1 | MIT OR Apache-2.0 |
| proc-macro-crate | 2.0.2 | MIT OR Apache-2.0 |
| proc-macro-crate | 3.5.0 | MIT OR Apache-2.0 |
| proc-macro-error | 1.0.4 | MIT OR Apache-2.0 |
| proc-macro-error-attr | 1.0.4 | MIT OR Apache-2.0 |
| proc-macro-error-attr2 | 2.0.0 | MIT OR Apache-2.0 |
| proc-macro-error2 | 2.0.1 | MIT OR Apache-2.0 |
| proc-macro-hack | 0.5.20+deprecated | MIT OR Apache-2.0 |
| proc-macro2 | 1.0.106 | MIT OR Apache-2.0 |
| psm | 0.1.31 | MIT OR Apache-2.0 |
| pxfm | 0.1.29 | BSD-3-Clause OR Apache-2.0 |
| qcms | 0.3.0 | MIT |
| quick-error | 2.0.1 | MIT/Apache-2.0 |
| quick-xml | 0.37.5 | MIT |
| quick-xml | 0.38.4 | MIT |
| quick-xml | 0.39.4 | MIT |
| quinn | 0.11.9 | MIT OR Apache-2.0 |
| quinn-proto | 0.11.15 | MIT OR Apache-2.0 |
| quinn-udp | 0.5.14 | MIT OR Apache-2.0 |
| quote | 1.0.45 | MIT OR Apache-2.0 |
| r-efi | 5.3.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later |
| r-efi | 6.0.0 | MIT OR Apache-2.0 OR LGPL-2.1-or-later |
| r2d2 | 0.8.10 | MIT/Apache-2.0 |
| r2d2_sqlite | 0.25.0 | MIT |
| rand | 0.8.6 | MIT OR Apache-2.0 |
| rand | 0.9.4 | MIT OR Apache-2.0 |
| rand | 0.10.1 | MIT OR Apache-2.0 |
| rand_chacha | 0.3.1 | MIT OR Apache-2.0 |
| rand_chacha | 0.9.0 | MIT OR Apache-2.0 |
| rand_core | 0.6.4 | MIT OR Apache-2.0 |
| rand_core | 0.9.5 | MIT OR Apache-2.0 |
| rand_core | 0.10.1 | MIT OR Apache-2.0 |
| rangemap | 1.7.1 | MIT/Apache-2.0 |
| raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib |
| rayon | 1.12.0 | MIT OR Apache-2.0 |
| rayon-core | 1.13.0 | MIT OR Apache-2.0 |
| read-fonts | 0.35.0 | MIT OR Apache-2.0 |
| redox_syscall | 0.5.18 | MIT |
| redox_users | 0.5.2 | MIT |
| ref-cast | 1.0.25 | MIT OR Apache-2.0 |
| ref-cast-impl | 1.0.25 | MIT OR Apache-2.0 |
| regex | 1.12.3 | MIT OR Apache-2.0 |
| regex-automata | 0.4.14 | MIT OR Apache-2.0 |
| regex-syntax | 0.8.10 | MIT OR Apache-2.0 |
| reqwest | 0.12.28 | MIT OR Apache-2.0 |
| reqwest | 0.13.3 | MIT OR Apache-2.0 |
| resvg | 0.45.1 | Apache-2.0 OR MIT |
| rfd | 0.16.0 | MIT |
| rgb | 0.8.53 | MIT |
| ring | 0.17.14 | Apache-2.0 AND ISC |
| roman-numerals-rs | 3.1.0 | 0BSD OR CC0-1.0 |
| roxmltree | 0.20.0 | MIT OR Apache-2.0 |
| rusqlite | 0.32.1 | MIT |
| rust_decimal | 1.42.0 | MIT |
| rustc-hash | 2.1.2 | Apache-2.0 OR MIT |
| rustc_version | 0.4.1 | MIT OR Apache-2.0 |
| rustix | 1.1.4 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| rustls | 0.23.45 | Apache-2.0 OR ISC OR MIT |
| rustls-pki-types | 1.14.1 | MIT OR Apache-2.0 |
| rustls-webpki | 0.103.15 | ISC |
| rustversion | 1.0.22 | MIT OR Apache-2.0 |
| rustybuzz | 0.20.1 | MIT |
| ryu | 1.0.23 | Apache-2.0 OR BSL-1.0 |
| same-file | 1.0.6 | Unlicense/MIT |
| scheduled-thread-pool | 0.2.7 | MIT/Apache-2.0 |
| schemars | 0.8.22 | MIT |
| schemars | 0.9.0 | MIT |
| schemars | 1.2.1 | MIT |
| schemars_derive | 0.8.22 | MIT |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 |
| selectors | 0.36.1 | MPL-2.0 |
| semver | 1.0.28 | MIT OR Apache-2.0 |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde-untagged | 0.1.9 | MIT OR Apache-2.0 |
| serde_core | 1.0.229 | MIT OR Apache-2.0 |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 |
| serde_derive_internals | 0.29.1 | MIT OR Apache-2.0 |
| serde_json | 1.0.151 | MIT OR Apache-2.0 |
| serde_repr | 0.1.20 | MIT OR Apache-2.0 |
| serde_spanned | 0.6.9 | MIT OR Apache-2.0 |
| serde_spanned | 1.1.1 | MIT OR Apache-2.0 |
| serde_urlencoded | 0.7.1 | MIT/Apache-2.0 |
| serde_with | 3.20.0 | MIT OR Apache-2.0 |
| serde_with_macros | 3.20.0 | MIT OR Apache-2.0 |
| serde_yaml | 0.9.34+deprecated | MIT OR Apache-2.0 |
| serialize-to-javascript | 0.1.2 | MIT OR Apache-2.0 |
| serialize-to-javascript-impl | 0.1.2 | MIT OR Apache-2.0 |
| servo_arc | 0.4.3 | MIT OR Apache-2.0 |
| sha2 | 0.10.9 | MIT OR Apache-2.0 |
| sharded-slab | 0.1.7 | MIT |
| shlex | 1.3.0 | MIT OR Apache-2.0 |
| signal-hook-registry | 1.4.8 | MIT OR Apache-2.0 |
| simd-adler32 | 0.3.9 | MIT |
| simplecss | 0.2.2 | Apache-2.0 OR MIT |
| siphasher | 1.0.3 | MIT/Apache-2.0 |
| skrifa | 0.37.0 | MIT OR Apache-2.0 |
| slab | 0.4.12 | MIT |
| slotmap | 1.1.1 | Zlib |
| smallvec | 1.15.1 | MIT OR Apache-2.0 |
| socket2 | 0.6.3 | MIT OR Apache-2.0 |
| softbuffer | 0.4.8 | MIT OR Apache-2.0 |
| soup3 | 0.5.0 | MIT |
| soup3-sys | 0.5.0 | MIT |
| spin | 0.9.8 | MIT |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 |
| stacker | 0.1.24 | MIT OR Apache-2.0 |
| strict-num | 0.1.1 | MIT |
| string_cache | 0.9.0 | MIT OR Apache-2.0 |
| string_cache_codegen | 0.6.1 | MIT OR Apache-2.0 |
| stringprep | 0.1.5 | MIT/Apache-2.0 |
| strsim | 0.11.1 | MIT |
| strum | 0.27.2 | MIT |
| strum_macros | 0.27.2 | MIT |
| subsetter | 0.2.3 | MIT OR Apache-2.0 |
| subtle | 2.6.1 | BSD-3-Clause |
| svgtypes | 0.15.3 | Apache-2.0 OR MIT |
| swift-rs | 1.0.7 | MIT OR Apache-2.0 |
| syn | 1.0.109 | MIT OR Apache-2.0 |
| syn | 2.0.117 | MIT OR Apache-2.0 |
| syn | 3.0.5 | MIT OR Apache-2.0 |
| sync_wrapper | 1.0.2 | Apache-2.0 |
| synstructure | 0.13.2 | MIT |
| syntect | 5.3.0 | MIT |
| system-deps | 6.2.2 | MIT OR Apache-2.0 |
| tao | 0.35.3 | Apache-2.0 |
| tao-macros | 0.1.3 | MIT OR Apache-2.0 |
| target-lexicon | 0.12.16 | Apache-2.0 WITH LLVM-exception |
| tauri | 2.11.5 | Apache-2.0 OR MIT |
| tauri-build | 2.6.3 | Apache-2.0 OR MIT |
| tauri-codegen | 2.6.3 | Apache-2.0 OR MIT |
| tauri-macros | 2.6.3 | Apache-2.0 OR MIT |
| tauri-plugin | 2.6.2 | Apache-2.0 OR MIT |
| tauri-plugin-dialog | 2.7.3 | Apache-2.0 OR MIT |
| tauri-plugin-fs | 2.5.2 | Apache-2.0 OR MIT |
| tauri-plugin-notification | 2.4.0 | Apache-2.0 OR MIT |
| tauri-plugin-store | 2.4.4 | Apache-2.0 OR MIT |
| tauri-runtime | 2.11.3 | Apache-2.0 OR MIT |
| tauri-runtime-wry | 2.11.4 | Apache-2.0 OR MIT |
| tauri-utils | 2.9.3 | Apache-2.0 OR MIT |
| tauri-winres | 0.3.6 | MIT |
| tauri-winrt-notification | 0.7.2 | MIT OR Apache-2.0 |
| tempfile | 3.27.0 | MIT OR Apache-2.0 |
| tendril | 0.5.0 | MIT OR Apache-2.0 |
| thin-vec | 0.2.18 | MIT OR Apache-2.0 |
| thiserror | 1.0.69 | MIT OR Apache-2.0 |
| thiserror | 2.0.18 | MIT OR Apache-2.0 |
| thiserror-impl | 1.0.69 | MIT OR Apache-2.0 |
| thiserror-impl | 2.0.18 | MIT OR Apache-2.0 |
| thread_local | 1.1.9 | MIT OR Apache-2.0 |
| time | 0.3.47 | MIT OR Apache-2.0 |
| time-core | 0.1.8 | MIT OR Apache-2.0 |
| time-macros | 0.2.27 | MIT OR Apache-2.0 |
| tiny-skia | 0.11.4 | BSD-3-Clause |
| tiny-skia-path | 0.11.4 | BSD-3-Clause |
| tinystr | 0.7.6 | Unicode-3.0 |
| tinystr | 0.8.3 | Unicode-3.0 |
| tinyvec | 1.11.0 | Zlib OR Apache-2.0 OR MIT |
| tinyvec_macros | 0.1.1 | MIT OR Apache-2.0 OR Zlib |
| tokio | 1.53.1 | MIT |
| tokio-macros | 2.7.0 | MIT |
| tokio-rustls | 0.26.4 | MIT OR Apache-2.0 |
| tokio-util | 0.7.18 | MIT |
| toml | 0.8.2 | MIT OR Apache-2.0 |
| toml | 0.9.12+spec-1.1.0 | MIT OR Apache-2.0 |
| toml | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_datetime | 0.6.3 | MIT OR Apache-2.0 |
| toml_datetime | 0.7.5+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_datetime | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_edit | 0.19.15 | MIT OR Apache-2.0 |
| toml_edit | 0.20.2 | MIT OR Apache-2.0 |
| toml_edit | 0.25.11+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_parser | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 |
| toml_writer | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 |
| tower | 0.5.3 | MIT |
| tower-http | 0.6.11 | MIT |
| tower-layer | 0.3.3 | MIT |
| tower-service | 0.3.3 | MIT |
| tracing | 0.1.44 | MIT |
| tracing-attributes | 0.1.31 | MIT |
| tracing-core | 0.1.36 | MIT |
| tracing-log | 0.2.0 | MIT |
| tracing-subscriber | 0.3.23 | MIT |
| tray-icon | 0.24.2 | MIT OR Apache-2.0 |
| try-lock | 0.2.5 | MIT |
| ttf-parser | 0.25.1 | MIT OR Apache-2.0 |
| two-face | 0.4.5 | MIT OR Apache-2.0 |
| typed-arena | 2.0.2 | MIT |
| typeid | 1.0.3 | MIT OR Apache-2.0 |
| typenum | 1.20.0 | MIT OR Apache-2.0 |
| typst | 0.14.2 | Apache-2.0 |
| typst-as-lib | 0.15.4 | MIT |
| typst-assets | 0.14.2 | Apache-2.0 |
| typst-eval | 0.14.2 | Apache-2.0 |
| typst-html | 0.14.2 | Apache-2.0 |
| typst-layout | 0.14.2 | Apache-2.0 |
| typst-library | 0.14.2 | Apache-2.0 |
| typst-macros | 0.14.2 | Apache-2.0 |
| typst-pdf | 0.14.2 | Apache-2.0 |
| typst-realize | 0.14.2 | Apache-2.0 |
| typst-svg | 0.14.2 | Apache-2.0 |
| typst-syntax | 0.14.2 | Apache-2.0 |
| typst-timing | 0.14.2 | Apache-2.0 |
| typst-utils | 0.14.2 | Apache-2.0 |
| ucd-trie | 0.1.7 | MIT OR Apache-2.0 |
| uds_windows | 1.2.1 | MIT |
| unic-char-property | 0.9.0 | MIT/Apache-2.0 |
| unic-char-range | 0.9.0 | MIT/Apache-2.0 |
| unic-common | 0.9.0 | MIT/Apache-2.0 |
| unic-langid | 0.9.6 | MIT OR Apache-2.0 |
| unic-langid-impl | 0.9.6 | MIT OR Apache-2.0 |
| unic-langid-macros | 0.9.6 | MIT OR Apache-2.0 |
| unic-langid-macros-impl | 0.9.6 | MIT OR Apache-2.0 |
| unic-ucd-ident | 0.9.0 | MIT/Apache-2.0 |
| unic-ucd-version | 0.9.0 | MIT/Apache-2.0 |
| unicode-bidi | 0.3.18 | MIT OR Apache-2.0 |
| unicode-bidi-mirroring | 0.4.0 | MIT/Apache-2.0 |
| unicode-ccc | 0.4.0 | MIT/Apache-2.0 |
| unicode-ident | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 |
| unicode-math-class | 0.1.0 | MIT OR Apache-2.0 |
| unicode-normalization | 0.1.25 | MIT OR Apache-2.0 |
| unicode-properties | 0.1.4 | MIT/Apache-2.0 |
| unicode-script | 0.5.8 | MIT OR Apache-2.0 |
| unicode-segmentation | 1.13.2 | MIT OR Apache-2.0 |
| unicode-vo | 0.1.0 | MIT/Apache-2.0 |
| unicode-xid | 0.2.6 | MIT OR Apache-2.0 |
| unsafe-libyaml | 0.2.11 | MIT |
| unscanny | 0.1.0 | MIT OR Apache-2.0 |
| untrusted | 0.9.0 | ISC |
| url | 2.5.8 | MIT OR Apache-2.0 |
| urlpattern | 0.3.0 | MIT |
| usvg | 0.45.1 | Apache-2.0 OR MIT |
| utf-8 | 0.7.6 | MIT OR Apache-2.0 |
| utf8_iter | 1.0.4 | Apache-2.0 OR MIT |
| uuid | 1.26.1 | Apache-2.0 OR MIT |
| valuable | 0.1.1 | MIT |
| vcpkg | 0.2.15 | MIT/Apache-2.0 |
| version-compare | 0.2.1 | MIT |
| version_check | 0.9.5 | MIT/Apache-2.0 |
| vswhom | 0.1.0 | MIT |
| vswhom-sys | 0.1.3 | MIT |
| walkdir | 2.5.0 | Unlicense/MIT |
| want | 0.3.1 | MIT |
| wasi | 0.11.1+wasi-snapshot-preview1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasip2 | 1.0.3+wasi-0.2.9 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasip3 | 0.4.0+wasi-0.3.0-rc-2026-01-06 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasm-bindgen | 0.2.122 | MIT OR Apache-2.0 |
| wasm-bindgen-futures | 0.4.72 | MIT OR Apache-2.0 |
| wasm-bindgen-macro | 0.2.122 | MIT OR Apache-2.0 |
| wasm-bindgen-macro-support | 0.2.122 | MIT OR Apache-2.0 |
| wasm-bindgen-shared | 0.2.122 | MIT OR Apache-2.0 |
| wasm-encoder | 0.244.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasm-metadata | 0.244.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasm-streams | 0.4.2 | MIT OR Apache-2.0 |
| wasm-streams | 0.5.0 | MIT OR Apache-2.0 |
| wasmi | 0.51.5 | MIT/Apache-2.0 |
| wasmi_collections | 0.51.5 | MIT/Apache-2.0 |
| wasmi_core | 0.51.5 | MIT/Apache-2.0 |
| wasmi_ir | 0.51.5 | MIT/Apache-2.0 |
| wasmparser | 0.228.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wasmparser | 0.244.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| web-sys | 0.3.99 | MIT OR Apache-2.0 |
| web-time | 1.1.0 | MIT OR Apache-2.0 |
| web_atoms | 0.2.4 | MIT OR Apache-2.0 |
| webkit2gtk | 2.0.2 | MIT |
| webkit2gtk-sys | 2.0.2 | MIT |
| webpki-roots | 1.0.7 | CDLA-Permissive-2.0 |
| webview2-com | 0.38.2 | MIT |
| webview2-com-macros | 0.8.1 | MIT |
| webview2-com-sys | 0.38.2 | MIT |
| weezl | 0.1.12 | MIT OR Apache-2.0 |
| winapi | 0.3.9 | MIT/Apache-2.0 |
| winapi-i686-pc-windows-gnu | 0.4.0 | MIT/Apache-2.0 |
| winapi-util | 0.1.11 | Unlicense OR MIT |
| winapi-x86_64-pc-windows-gnu | 0.4.0 | MIT/Apache-2.0 |
| window-vibrancy | 0.6.0 | Apache-2.0 OR MIT |
| windows | 0.61.3 | MIT OR Apache-2.0 |
| windows-collections | 0.2.0 | MIT OR Apache-2.0 |
| windows-core | 0.61.2 | MIT OR Apache-2.0 |
| windows-future | 0.2.1 | MIT OR Apache-2.0 |
| windows-implement | 0.60.2 | MIT OR Apache-2.0 |
| windows-interface | 0.59.3 | MIT OR Apache-2.0 |
| windows-link | 0.1.3 | MIT OR Apache-2.0 |
| windows-link | 0.2.1 | MIT OR Apache-2.0 |
| windows-numerics | 0.2.0 | MIT OR Apache-2.0 |
| windows-result | 0.3.4 | MIT OR Apache-2.0 |
| windows-strings | 0.4.2 | MIT OR Apache-2.0 |
| windows-sys | 0.45.0 | MIT OR Apache-2.0 |
| windows-sys | 0.52.0 | MIT OR Apache-2.0 |
| windows-sys | 0.59.0 | MIT OR Apache-2.0 |
| windows-sys | 0.60.2 | MIT OR Apache-2.0 |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 |
| windows-targets | 0.42.2 | MIT OR Apache-2.0 |
| windows-targets | 0.52.6 | MIT OR Apache-2.0 |
| windows-targets | 0.53.5 | MIT OR Apache-2.0 |
| windows-threading | 0.1.0 | MIT OR Apache-2.0 |
| windows-version | 0.1.7 | MIT OR Apache-2.0 |
| windows_aarch64_gnullvm | 0.42.2 | MIT OR Apache-2.0 |
| windows_aarch64_gnullvm | 0.52.6 | MIT OR Apache-2.0 |
| windows_aarch64_gnullvm | 0.53.1 | MIT OR Apache-2.0 |
| windows_aarch64_msvc | 0.42.2 | MIT OR Apache-2.0 |
| windows_aarch64_msvc | 0.52.6 | MIT OR Apache-2.0 |
| windows_aarch64_msvc | 0.53.1 | MIT OR Apache-2.0 |
| windows_i686_gnu | 0.42.2 | MIT OR Apache-2.0 |
| windows_i686_gnu | 0.52.6 | MIT OR Apache-2.0 |
| windows_i686_gnu | 0.53.1 | MIT OR Apache-2.0 |
| windows_i686_gnullvm | 0.52.6 | MIT OR Apache-2.0 |
| windows_i686_gnullvm | 0.53.1 | MIT OR Apache-2.0 |
| windows_i686_msvc | 0.42.2 | MIT OR Apache-2.0 |
| windows_i686_msvc | 0.52.6 | MIT OR Apache-2.0 |
| windows_i686_msvc | 0.53.1 | MIT OR Apache-2.0 |
| windows_x86_64_gnu | 0.42.2 | MIT OR Apache-2.0 |
| windows_x86_64_gnu | 0.52.6 | MIT OR Apache-2.0 |
| windows_x86_64_gnu | 0.53.1 | MIT OR Apache-2.0 |
| windows_x86_64_gnullvm | 0.42.2 | MIT OR Apache-2.0 |
| windows_x86_64_gnullvm | 0.52.6 | MIT OR Apache-2.0 |
| windows_x86_64_gnullvm | 0.53.1 | MIT OR Apache-2.0 |
| windows_x86_64_msvc | 0.42.2 | MIT OR Apache-2.0 |
| windows_x86_64_msvc | 0.52.6 | MIT OR Apache-2.0 |
| windows_x86_64_msvc | 0.53.1 | MIT OR Apache-2.0 |
| winnow | 0.5.40 | MIT |
| winnow | 0.7.15 | MIT |
| winnow | 1.0.3 | MIT |
| winreg | 0.55.0 | MIT |
| wit-bindgen | 0.51.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-bindgen | 0.57.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-bindgen-core | 0.51.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-bindgen-rust | 0.51.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-bindgen-rust-macro | 0.51.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-component | 0.244.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| wit-parser | 0.244.0 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT |
| write-fonts | 0.43.0 | MIT OR Apache-2.0 |
| writeable | 0.5.5 | Unicode-3.0 |
| writeable | 0.6.3 | Unicode-3.0 |
| wry | 0.55.1 | Apache-2.0 OR MIT |
| x11 | 2.21.0 | MIT |
| x11-dl | 2.21.0 | MIT |
| xmlparser | 0.13.6 | MIT/Apache-2.0 |
| xmlwriter | 0.1.0 | MIT |
| xmp-writer | 0.3.3 | MIT OR Apache-2.0 |
| yaml-rust | 0.4.5 | MIT/Apache-2.0 |
| yoke | 0.7.5 | Unicode-3.0 |
| yoke | 0.8.2 | Unicode-3.0 |
| yoke-derive | 0.7.5 | Unicode-3.0 |
| yoke-derive | 0.8.2 | Unicode-3.0 |
| zbus | 5.15.0 | MIT |
| zbus_macros | 5.15.0 | MIT |
| zbus_names | 4.3.2 | MIT |
| zerocopy | 0.8.48 | BSD-2-Clause OR Apache-2.0 OR MIT |
| zerocopy-derive | 0.8.48 | BSD-2-Clause OR Apache-2.0 OR MIT |
| zerofrom | 0.1.8 | Unicode-3.0 |
| zerofrom-derive | 0.1.7 | Unicode-3.0 |
| zeroize | 1.8.2 | Apache-2.0 OR MIT |
| zerotrie | 0.1.3 | Unicode-3.0 |
| zerotrie | 0.2.4 | Unicode-3.0 |
| zerovec | 0.10.4 | Unicode-3.0 |
| zerovec | 0.11.6 | Unicode-3.0 |
| zerovec-derive | 0.10.3 | Unicode-3.0 |
| zerovec-derive | 0.11.3 | Unicode-3.0 |
| zlib-rs | 0.6.3 | Zlib |
| zmij | 1.0.21 | MIT |
| zune-core | 0.4.12 | MIT OR Apache-2.0 OR Zlib |
| zune-core | 0.5.1 | MIT OR Apache-2.0 OR Zlib |
| zune-jpeg | 0.4.21 | MIT OR Apache-2.0 OR Zlib |
| zune-jpeg | 0.5.15 | MIT OR Apache-2.0 OR Zlib |
| zvariant | 5.11.0 | MIT |
| zvariant_derive | 5.11.0 | MIT |
| zvariant_utils | 3.3.1 | MIT |

---

## NPM Dependencies

The following 348 JavaScript/TypeScript packages are used by the frontend.
Every package in `package-lock.json` is listed. Kind is `runtime` for the
app's dependencies and everything they pull in, and `dev` for tools used only
to build and test it.

| Package | Version | License | Kind |
|---------|---------|---------|------|
| @asamuzakjp/css-color | 5.1.11 | MIT | dev |
| @asamuzakjp/dom-selector | 7.1.1 | MIT | dev |
| @asamuzakjp/generational-cache | 1.0.1 | MIT | dev |
| @asamuzakjp/nwsapi | 2.3.9 | MIT | dev |
| @babel/runtime | 7.29.2 | MIT | runtime |
| @bramus/specificity | 2.4.2 | MIT | dev |
| @csstools/color-helpers | 6.0.2 | MIT-0 | dev |
| @csstools/css-calc | 3.2.1 | MIT | dev |
| @csstools/css-color-parser | 4.1.1 | MIT | dev |
| @csstools/css-parser-algorithms | 4.0.0 | MIT | dev |
| @csstools/css-syntax-patches-for-csstree | 1.1.4 | MIT-0 | dev |
| @csstools/css-tokenizer | 4.0.0 | MIT | dev |
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0 | runtime |
| @emnapi/runtime | 1.11.3 | MIT | runtime |
| @exodus/bytes | 1.15.1 | MIT | dev |
| @fontsource/ibm-plex-mono | 5.3.0 | OFL-1.1 | runtime |
| @fontsource/newsreader | 5.3.0 | OFL-1.1 | runtime |
| @fontsource/source-sans-3 | 5.3.0 | OFL-1.1 | runtime |
| @fontsource/source-serif-4 | 5.3.0 | OFL-1.1 | runtime |
| @huggingface/jinja | 0.5.9 | MIT | runtime |
| @huggingface/tokenizers | 0.1.3 | Apache-2.0 | runtime |
| @huggingface/transformers | 4.2.0 | Apache-2.0 | runtime |
| @img/colour | 1.1.0 | MIT | runtime |
| @img/sharp-darwin-arm64 | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-darwin-x64 | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-freebsd-wasm32 | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-libvips-darwin-arm64 | 1.3.3 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-darwin-x64 | 1.3.3 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-arm | 1.3.3 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-arm64 | 1.3.3 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-ppc64 | 1.3.3 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-riscv64 | 1.3.3 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-s390x | 1.3.3 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linux-x64 | 1.3.3 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linuxmusl-arm64 | 1.3.3 | LGPL-3.0-or-later | runtime |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.3 | LGPL-3.0-or-later | runtime |
| @img/sharp-linux-arm | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-linux-arm64 | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-linux-ppc64 | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-linux-riscv64 | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-linux-s390x | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-linux-x64 | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-linuxmusl-arm64 | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-linuxmusl-x64 | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-wasm32 | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | runtime |
| @img/sharp-webcontainers-wasm32 | 0.35.4 | Apache-2.0 | runtime |
| @img/sharp-win32-arm64 | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later | runtime |
| @img/sharp-win32-ia32 | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later | runtime |
| @img/sharp-win32-x64 | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later | runtime |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | dev |
| @mediapipe/tasks-vision | 0.10.17 | Apache-2.0 | runtime |
| @monogrid/gainmap-js | 3.4.0 | MIT | runtime |
| @napi-rs/canvas | 0.1.100 | MIT | runtime |
| @napi-rs/canvas-android-arm64 | 0.1.100 | MIT | runtime |
| @napi-rs/canvas-darwin-arm64 | 0.1.100 | MIT | runtime |
| @napi-rs/canvas-darwin-x64 | 0.1.100 | MIT | runtime |
| @napi-rs/canvas-linux-arm-gnueabihf | 0.1.100 | MIT | runtime |
| @napi-rs/canvas-linux-arm64-gnu | 0.1.100 | MIT | runtime |
| @napi-rs/canvas-linux-arm64-musl | 0.1.100 | MIT | runtime |
| @napi-rs/canvas-linux-riscv64-gnu | 0.1.100 | MIT | runtime |
| @napi-rs/canvas-linux-x64-gnu | 0.1.100 | MIT | runtime |
| @napi-rs/canvas-linux-x64-musl | 0.1.100 | MIT | runtime |
| @napi-rs/canvas-win32-arm64-msvc | 0.1.100 | MIT | runtime |
| @napi-rs/canvas-win32-x64-msvc | 0.1.100 | MIT | runtime |
| @oxc-project/types | 0.149.0 | MIT | dev |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause | runtime |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause | runtime |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause | runtime |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause | runtime |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause | runtime |
| @protobufjs/float | 1.0.2 | BSD-3-Clause | runtime |
| @protobufjs/path | 1.1.2 | BSD-3-Clause | runtime |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause | runtime |
| @protobufjs/utf8 | 1.1.1 | BSD-3-Clause | runtime |
| @react-spring/animated | 9.7.5 | MIT | runtime |
| @react-spring/core | 9.7.5 | MIT | runtime |
| @react-spring/rafz | 9.7.5 | MIT | runtime |
| @react-spring/shared | 9.7.5 | MIT | runtime |
| @react-spring/three | 9.7.5 | MIT | runtime |
| @react-spring/types | 9.7.5 | MIT | runtime |
| @react-three/drei | 9.122.0 | MIT | runtime |
| @react-three/fiber | 8.18.0 | MIT | runtime |
| @react-three/postprocessing | 2.19.1 | MIT | runtime |
| @rolldown/binding-android-arm-eabi | 1.2.8 | MIT | dev |
| @rolldown/binding-android-arm64 | 1.2.8 | MIT | dev |
| @rolldown/binding-darwin-arm64 | 1.2.8 | MIT | dev |
| @rolldown/binding-darwin-x64 | 1.2.8 | MIT | dev |
| @rolldown/binding-freebsd-x64 | 1.2.8 | MIT | dev |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.8 | MIT | dev |
| @rolldown/binding-linux-arm64-gnu | 1.2.8 | MIT | dev |
| @rolldown/binding-linux-arm64-musl | 1.2.8 | MIT | dev |
| @rolldown/binding-linux-ppc64-gnu | 1.2.8 | MIT | dev |
| @rolldown/binding-linux-s390x-gnu | 1.2.8 | MIT | dev |
| @rolldown/binding-linux-x64-gnu | 1.2.8 | MIT | dev |
| @rolldown/binding-linux-x64-musl | 1.2.8 | MIT | dev |
| @rolldown/binding-openharmony-arm64 | 1.2.8 | MIT | dev |
| @rolldown/binding-win32-arm64-msvc | 1.2.8 | MIT | dev |
| @rolldown/binding-win32-x64-msvc | 1.2.8 | MIT | dev |
| @rolldown/pluginutils | 1.0.1 | MIT | dev |
| @standard-schema/spec | 1.1.0 | MIT | dev |
| @tauri-apps/api | 2.11.1 | Apache-2.0 OR MIT | runtime |
| @tauri-apps/cli | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/cli-darwin-arm64 | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/cli-darwin-x64 | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/cli-linux-arm-gnueabihf | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/cli-linux-arm64-gnu | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/cli-linux-arm64-musl | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/cli-linux-riscv64-gnu | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/cli-linux-x64-gnu | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/cli-linux-x64-musl | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/cli-win32-arm64-msvc | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/cli-win32-ia32-msvc | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/cli-win32-x64-msvc | 2.11.4 | Apache-2.0 OR MIT | dev |
| @tauri-apps/plugin-dialog | 2.7.3 | MIT OR Apache-2.0 | runtime |
| @tauri-apps/plugin-notification | 2.4.0 | MIT OR Apache-2.0 | runtime |
| @tauri-apps/plugin-store | 2.4.4 | MIT OR Apache-2.0 | runtime |
| @tweenjs/tween.js | 23.1.3 | MIT | runtime |
| @types/chai | 5.2.3 | MIT | dev |
| @types/deep-eql | 4.0.2 | MIT | dev |
| @types/draco3d | 1.4.10 | MIT | runtime |
| @types/estree | 1.0.9 | MIT | dev |
| @types/jsdom | 28.0.3 | MIT | dev |
| @types/node | 22.19.20 | MIT | runtime |
| @types/node | 25.9.1 | MIT | runtime |
| @types/offscreencanvas | 2019.7.3 | MIT | runtime |
| @types/pako | 2.0.4 | MIT | runtime |
| @types/prop-types | 15.7.15 | MIT | runtime |
| @types/raf | 3.4.3 | MIT | runtime |
| @types/react | 18.3.28 | MIT | runtime |
| @types/react-dom | 18.3.7 | MIT | dev |
| @types/react-reconciler | 0.26.7 | MIT | runtime |
| @types/react-reconciler | 0.28.9 | MIT | runtime |
| @types/stats.js | 0.17.4 | MIT | runtime |
| @types/three | 0.184.1 | MIT | runtime |
| @types/tough-cookie | 4.0.5 | MIT | dev |
| @types/trusted-types | 2.0.7 | MIT | runtime |
| @types/webxr | 0.5.24 | MIT | runtime |
| @use-gesture/core | 10.3.1 | MIT | runtime |
| @use-gesture/react | 10.3.1 | MIT | runtime |
| @vitejs/plugin-react | 6.1.1 | MIT | dev |
| @vitest/expect | 4.1.11 | MIT | dev |
| @vitest/mocker | 4.1.11 | MIT | dev |
| @vitest/pretty-format | 4.1.11 | MIT | dev |
| @vitest/runner | 4.1.11 | MIT | dev |
| @vitest/snapshot | 4.1.11 | MIT | dev |
| @vitest/spy | 4.1.11 | MIT | dev |
| @vitest/utils | 4.1.11 | MIT | dev |
| adm-zip | 0.6.1 | MIT | runtime |
| assertion-error | 2.0.1 | MIT | dev |
| base64-arraybuffer | 1.0.2 | MIT | runtime |
| base64-js | 1.5.1 | MIT | runtime |
| bidi-js | 1.0.3 | MIT | runtime |
| boolean | 3.2.0 | MIT | runtime |
| buffer | 6.0.3 | MIT | runtime |
| camera-controls | 2.10.1 | MIT | runtime |
| canvg | 3.0.11 | MIT | runtime |
| chai | 6.2.2 | MIT | dev |
| convert-source-map | 2.0.0 | MIT | dev |
| core-js | 3.49.0 | MIT | runtime |
| core-util-is | 1.0.3 | MIT | runtime |
| cross-env | 7.0.3 | MIT | runtime |
| cross-spawn | 7.0.6 | MIT | runtime |
| css-line-break | 2.1.0 | MIT | runtime |
| css-tree | 3.2.1 | MIT | dev |
| csstype | 3.2.3 | MIT | runtime |
| data-urls | 7.0.0 | MIT | dev |
| decimal.js | 10.6.0 | MIT | dev |
| define-data-property | 1.1.4 | MIT | runtime |
| define-properties | 1.2.1 | MIT | runtime |
| detect-gpu | 5.0.70 | MIT | runtime |
| detect-libc | 2.1.2 | Apache-2.0 | runtime |
| detect-node | 2.1.0 | MIT | runtime |
| docx | 9.1.0 | MIT | runtime |
| dompurify | 3.4.15 | (MPL-2.0 OR Apache-2.0) | runtime |
| draco3d | 1.5.7 | Apache-2.0 | runtime |
| entities | 8.0.0 | BSD-2-Clause | dev |
| es-define-property | 1.0.1 | MIT | runtime |
| es-errors | 1.3.0 | MIT | runtime |
| es-module-lexer | 2.1.0 | MIT | dev |
| es6-error | 4.1.1 | MIT | runtime |
| escape-string-regexp | 4.0.0 | MIT | runtime |
| estree-walker | 3.0.3 | MIT | dev |
| expect-type | 1.3.0 | Apache-2.0 | dev |
| fast-png | 6.4.0 | MIT | runtime |
| fdir | 6.5.0 | MIT | dev |
| fflate | 0.6.11 | MIT | runtime |
| fflate | 0.8.3 | MIT | runtime |
| flatbuffers | 25.9.23 | Apache-2.0 | runtime |
| fsevents | 2.3.3 | MIT | dev |
| global-agent | 3.0.0 | BSD-3-Clause | runtime |
| globalthis | 1.0.4 | MIT | runtime |
| glsl-noise | 0.0.0 | MIT | runtime |
| gopd | 1.2.0 | MIT | runtime |
| guid-typescript | 1.0.9 | ISC | runtime |
| has-property-descriptors | 1.0.2 | MIT | runtime |
| hash.js | 1.1.7 | MIT | runtime |
| hls.js | 1.6.16 | Apache-2.0 | runtime |
| html-encoding-sniffer | 6.0.0 | MIT | dev |
| html2canvas | 1.4.1 | MIT | runtime |
| ieee754 | 1.2.1 | BSD-3-Clause | runtime |
| immediate | 3.0.6 | MIT | runtime |
| inherits | 2.0.4 | ISC | runtime |
| iobuffer | 5.4.0 | MIT | runtime |
| is-potential-custom-element-name | 1.0.1 | MIT | dev |
| is-promise | 2.2.2 | MIT | runtime |
| isarray | 1.0.0 | MIT | runtime |
| isexe | 2.0.0 | ISC | runtime |
| its-fine | 1.2.5 | MIT | runtime |
| js-tokens | 4.0.0 | MIT | runtime |
| jsdom | 29.1.1 | MIT | dev |
| json-stringify-safe | 5.0.1 | ISC | runtime |
| jspdf | 4.2.1 | MIT | runtime |
| jszip | 3.10.1 | (MIT OR GPL-3.0-or-later) | runtime |
| lie | 3.3.0 | MIT | runtime |
| lightningcss | 1.33.0 | MPL-2.0 | dev |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 | dev |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 | dev |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 | dev |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 | dev |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 | dev |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 | dev |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 | dev |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 | dev |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 | dev |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 | dev |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | dev |
| long | 5.3.2 | Apache-2.0 | runtime |
| loose-envify | 1.4.0 | MIT | runtime |
| lru-cache | 11.5.0 | BlueOak-1.0.0 | dev |
| maath | 0.6.0 | MIT | runtime |
| maath | 0.10.8 | MIT | runtime |
| magic-string | 0.30.21 | MIT | dev |
| matcher | 3.0.0 | MIT | runtime |
| mdn-data | 2.27.1 | CC0-1.0 | dev |
| meshline | 3.3.1 | MIT | runtime |
| meshoptimizer | 1.1.1 | MIT | runtime |
| minimalistic-assert | 1.0.1 | ISC | runtime |
| n8ao | 1.10.1 | ISC | runtime |
| nanoid | 3.3.19 | MIT | dev |
| nanoid | 5.1.16 | MIT | runtime |
| object-assign | 4.1.1 | MIT | runtime |
| object-keys | 1.1.1 | MIT | runtime |
| obug | 2.1.1 | MIT | dev |
| onnxruntime-common | 1.24.0-dev.20251116-b39e144322 | MIT | runtime |
| onnxruntime-common | 1.24.3 | MIT | runtime |
| onnxruntime-node | 1.24.3 | MIT | runtime |
| onnxruntime-web | 1.26.0-dev.20260416-b7804b056c | MIT | runtime |
| pako | 1.0.11 | (MIT AND Zlib) | runtime |
| pako | 2.1.0 | (MIT AND Zlib) | runtime |
| parse5 | 8.0.1 | MIT | dev |
| path-key | 3.1.1 | MIT | runtime |
| pathe | 2.0.3 | MIT | dev |
| pdfjs-dist | 4.10.38 | Apache-2.0 | runtime |
| performance-now | 2.1.0 | MIT | runtime |
| picocolors | 1.1.1 | ISC | dev |
| picomatch | 4.0.7 | MIT | dev |
| platform | 1.3.6 | MIT | runtime |
| postcss | 8.5.23 | MIT | dev |
| postprocessing | 6.39.1 | Zlib | runtime |
| potpack | 1.0.2 | ISC | runtime |
| process-nextick-args | 2.0.1 | MIT | runtime |
| promise-worker-transferable | 1.0.4 | Apache-2.0 | runtime |
| prop-types | 15.8.1 | MIT | runtime |
| protobufjs | 7.6.5 | BSD-3-Clause | runtime |
| punycode | 2.3.1 | MIT | dev |
| raf | 3.4.1 | MIT | runtime |
| react | 18.3.1 | MIT | runtime |
| react-composer | 5.0.3 | MIT | runtime |
| react-dom | 18.3.1 | MIT | runtime |
| react-is | 16.13.1 | MIT | runtime |
| react-reconciler | 0.27.0 | MIT | runtime |
| react-use-measure | 2.1.7 | MIT | runtime |
| readable-stream | 2.3.8 | MIT | runtime |
| regenerator-runtime | 0.13.11 | MIT | runtime |
| require-from-string | 2.0.2 | MIT | runtime |
| rgbcolor | 1.0.1 | MIT OR SEE LICENSE IN FEEL-FREE.md | runtime |
| roarr | 2.15.4 | BSD-3-Clause | runtime |
| rolldown | 1.2.8 | MIT | dev |
| safe-buffer | 5.1.2 | MIT | runtime |
| sax | 1.6.0 | BlueOak-1.0.0 | runtime |
| saxes | 6.0.0 | ISC | dev |
| scheduler | 0.21.0 | MIT | runtime |
| scheduler | 0.23.2 | MIT | runtime |
| semver | 7.8.5 | ISC | runtime |
| semver-compare | 1.0.0 | MIT | runtime |
| serialize-error | 7.0.1 | MIT | runtime |
| setimmediate | 1.0.5 | MIT | runtime |
| sharp | 0.35.4 | Apache-2.0 | runtime |
| shebang-command | 2.0.0 | MIT | runtime |
| shebang-regex | 3.0.0 | MIT | runtime |
| siginfo | 2.0.0 | ISC | dev |
| source-map-js | 1.2.1 | BSD-3-Clause | dev |
| sprintf-js | 1.1.3 | BSD-3-Clause | runtime |
| stackback | 0.0.2 | MIT | dev |
| stackblur-canvas | 2.7.0 | MIT | runtime |
| stats-gl | 2.4.2 | MIT | runtime |
| stats.js | 0.17.0 | MIT | runtime |
| std-env | 4.1.0 | MIT | dev |
| string_decoder | 1.1.1 | MIT | runtime |
| suspend-react | 0.1.3 | MIT | runtime |
| svg-pathdata | 6.0.3 | MIT | runtime |
| symbol-tree | 3.2.4 | MIT | dev |
| text-segmentation | 1.0.3 | MIT | runtime |
| three | 0.170.0 | MIT | runtime |
| three | 0.184.0 | MIT | runtime |
| three-mesh-bvh | 0.7.8 | MIT | runtime |
| three-stdlib | 2.36.1 | MIT | runtime |
| tinybench | 2.9.0 | MIT | dev |
| tinyexec | 1.2.2 | MIT | dev |
| tinyglobby | 0.2.17 | MIT | dev |
| tinyrainbow | 3.1.1 | MIT | dev |
| tldts | 7.1.2 | MIT | dev |
| tldts-core | 7.1.2 | MIT | dev |
| tough-cookie | 6.0.1 | BSD-3-Clause | dev |
| tr46 | 6.0.0 | MIT | dev |
| troika-three-text | 0.52.4 | MIT | runtime |
| troika-three-utils | 0.52.4 | MIT | runtime |
| troika-worker-utils | 0.52.0 | MIT | runtime |
| tslib | 2.8.1 | 0BSD | runtime |
| tunnel-rat | 0.1.2 | MIT | runtime |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) | runtime |
| typescript | 5.9.3 | Apache-2.0 | dev |
| undici | 7.29.1 | MIT | dev |
| undici-types | 6.21.0 | MIT | runtime |
| undici-types | 7.24.6 | MIT | runtime |
| undici-types | 7.25.0 | MIT | dev |
| use-sync-external-store | 1.6.0 | MIT | runtime |
| util-deprecate | 1.0.2 | MIT | runtime |
| utility-types | 3.11.0 | MIT | runtime |
| utrie | 1.0.2 | MIT | runtime |
| vite | 8.3.0 | MIT | dev |
| vitest | 4.1.11 | MIT | dev |
| w3c-xmlserializer | 5.0.0 | MIT | dev |
| webgl-constants | 1.1.1 | MIT | runtime |
| webgl-sdf-generator | 1.1.1 | MIT | runtime |
| webidl-conversions | 8.0.1 | BSD-2-Clause | dev |
| whatwg-mimetype | 5.0.0 | MIT | dev |
| whatwg-url | 16.0.1 | MIT | dev |
| which | 2.0.2 | ISC | runtime |
| why-is-node-running | 2.3.0 | MIT | dev |
| xlsx | 0.20.3 | Apache-2.0 | runtime |
| xml | 1.0.1 | MIT | runtime |
| xml-js | 1.6.11 | MIT | runtime |
| xml-name-validator | 5.0.0 | Apache-2.0 | dev |
| xmlchars | 2.2.0 | MIT | dev |
| zustand | 3.7.2 | MIT | runtime |
| zustand | 4.5.7 | MIT | runtime |
| zustand | 5.0.15 | MIT | runtime |

---

## License Summary

How many packages declare each license expression, exactly as written in their
manifests. `A OR B` means the package may be used under either.

| License | Rust crates | NPM packages |
|---------|-------------|--------------|
| MIT | 157 | 231 |
| MIT OR Apache-2.0 | 325 | 3 |
| Apache-2.0 OR MIT | 59 | 13 |
| Apache-2.0 | 26 | 28 |
| MIT/Apache-2.0 | 43 | 0 |
| Unicode-3.0 | 38 | 0 |
| BSD-3-Clause | 5 | 16 |
| Zlib OR Apache-2.0 OR MIT | 18 | 0 |
| MPL-2.0 | 5 | 12 |
| Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | 16 | 0 |
| ISC | 4 | 12 |
| LGPL-3.0-or-later | 0 | 10 |
| Unlicense OR MIT | 9 | 0 |
| MIT OR Apache-2.0 OR Zlib | 7 | 0 |
| BSD-2-Clause | 3 | 2 |
| Zlib | 4 | 1 |
| OFL-1.1 | 0 | 4 |
| Unlicense/MIT | 4 | 0 |
| Apache-2.0 AND LGPL-3.0-or-later | 0 | 3 |
| Apache-2.0/MIT | 3 | 0 |
| BSD-3-Clause OR Apache-2.0 | 3 | 0 |
| (MIT AND Zlib) | 0 | 2 |
| Apache-2.0 OR ISC OR MIT | 2 | 0 |
| Apache-2.0 WITH LLVM-exception | 2 | 0 |
| BSD-2-Clause OR Apache-2.0 OR MIT | 2 | 0 |
| BSD-3-Clause OR MIT OR Apache-2.0 | 2 | 0 |
| BlueOak-1.0.0 | 0 | 2 |
| MIT OR Apache-2.0 OR LGPL-2.1-or-later | 2 | 0 |
| MIT-0 | 0 | 2 |
| (Apache-2.0 OR MIT) AND BSD-3-Clause | 1 | 0 |
| (MIT OR Apache-2.0) AND Unicode-3.0 | 1 | 0 |
| (MIT OR CC0-1.0) | 0 | 1 |
| (MIT OR GPL-3.0-or-later) | 0 | 1 |
| (MPL-2.0 OR Apache-2.0) | 0 | 1 |
| 0BSD | 0 | 1 |
| 0BSD OR CC0-1.0 | 1 | 0 |
| 0BSD OR MIT OR Apache-2.0 | 1 | 0 |
| Apache-2.0 / MIT | 1 | 0 |
| Apache-2.0 AND ISC | 1 | 0 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 0 | 1 |
| Apache-2.0 AND MIT | 1 | 0 |
| Apache-2.0 OR BSL-1.0 | 1 | 0 |
| BSD-3-Clause AND MIT | 1 | 0 |
| BSD-3-Clause/MIT | 1 | 0 |
| CC0-1.0 | 0 | 1 |
| CC0-1.0 OR MIT-0 OR Apache-2.0 | 1 | 0 |
| CDLA-Permissive-2.0 | 1 | 0 |
| MIT OR Apache-2.0 OR CC0-1.0 | 1 | 0 |
| MIT OR SEE LICENSE IN FEEL-FREE.md | 0 | 1 |
| MIT OR Zlib OR Apache-2.0 | 1 | 0 |

---

## License Notices

### MIT License Notice

Several dependencies are licensed under the MIT License. The MIT License requires
that the following copyright notice be included:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.

### Apache-2.0 License Notice

Several dependencies are licensed under the Apache License, Version 2.0. You may
obtain a copy of the Apache License at:

> https://www.apache.org/licenses/LICENSE-2.0

### BSD-2-Clause / BSD-3-Clause License Notice

Some dependencies use BSD-style licenses. These licenses require attribution in
documentation or source distributions.

### Other Licenses

Every other license in use is counted in the [License Summary](#license-summary).
`docs/LICENSES.md` records the license review: which licenses were checked by
hand and what each one requires.
