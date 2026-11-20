/**
 * Curated look-alike donor rows: donor → target letter, per target language (decision 40).
 * `optional` rows form the additional pack `optional`, off by default; "not
 * confusable" verdicts are not here. Hand-maintained.
 */
export const DONOR_ROWS: readonly (readonly [
  donor: number,
  target: string,
  language: string,
  pack: 'default' | 'optional',
])[] = [
  // Decision 40g: п and n are ordinary twins, in the English, Russian and Ukrainian packs only.
  [0x43f, 'n', 'English', 'default'], // п
  [0x6e, 'п', 'Russian', 'default'], // n
  [0x6e, 'п', 'Ukrainian', 'default'], // n
  [0xa6a1, 'И', 'Russian', 'default'], // ꚡ Bamum Letter Ka
  [0xa6df, 'V', 'English', 'default'], // ꛟ Bamum Letter Ko
  [0x1403, 'Δ', 'Greek', 'default'], // ᐃ Canadian Syllabics I
  [0x142f, 'V', 'English', 'default'], // ᐯ Canadian Syllabics Pe
  [0x14a5, 'Γ', 'Greek', 'default'], // ᒥ Canadian Syllabics Mi
  [0x14a5, 'Г', 'Russian', 'default'], // ᒥ Canadian Syllabics Mi
  [0x14aa, 'L', 'English', 'default'], // ᒪ Canadian Syllabics Ma
  [0x157c, 'H', 'English', 'default'], // ᕼ Canadian Syllabics Nunavut H
  [0x1587, 'R', 'English', 'default'], // ᖇ Canadian Syllabics Tlhi
  [0x15c5, 'A', 'English', 'default'], // ᗅ Canadian Syllabics Carrier Gho
  [0x15de, 'D', 'English', 'default'], // ᗞ Canadian Syllabics Carrier The
  [0x15f7, 'B', 'English', 'default'], // ᗷ Canadian Syllabics Carrier Khe
  [0x162f, 'Ω', 'Greek', 'default'], // ᘯ Canadian Syllabics Carrier Lho
  [0x102a0, 'A', 'English', 'default'], // 𐊠 Carian Letter A
  [0x102a1, 'B', 'English', 'default'], // 𐊡 Carian Letter P2
  [0x102a2, 'C', 'English', 'default'], // 𐊢 Carian Letter D
  [0x102a3, 'Δ', 'Greek', 'default'], // 𐊣 Carian Letter L
  [0x102ab, 'O', 'English', 'default'], // 𐊫 Carian Letter O
  [0x102b1, 'T', 'English', 'default'], // 𐊱 Carian Letter C-18
  [0x102b2, 'Y', 'English', 'default'], // 𐊲 Carian Letter U
  [0x102b4, 'X', 'English', 'default'], // 𐊴 Carian Letter X
  [0x102b6, 'Ω', 'Greek', 'default'], // 𐊶 Carian Letter Tt2
  [0x102cf, 'H', 'English', 'default'], // 𐋏 Carian Letter E2
  [0x10415, 'C', 'English', 'default'], // 𐐕 Deseret Capital Letter Chee
  [0x1041b, 'L', 'English', 'default'], // 𐐛 Deseret Capital Letter Eth
  [0x10420, 'S', 'English', 'default'], // 𐐠 Deseret Capital Letter Zhee
  [0x10518, 'к', 'Russian', 'default'], // 𐔘 Elbasan Letter Qe
  [0x1051d, 'v', 'English', 'default'], // 𐔝 Elbasan Letter Te
  [0x10526, 'L', 'English', 'default'], // 𐔦 Elbasan Letter Ghamma
  [0x10527, 'x', 'English', 'default'], // 𐔧 Elbasan Letter Khe
  [0x3007, 'O', 'English', 'default'], // 〇 Ideographic Number Zero
  [0x0ce6, 'O', 'English', 'default'], // ೦ Kannada Digit Zero
  [0xa4d0, 'B', 'English', 'default'], // ꓐ Lisu Letter Ba
  [0xa4d1, 'P', 'English', 'default'], // ꓑ Lisu Letter Pa
  [0xa4d3, 'D', 'English', 'default'], // ꓓ Lisu Letter Da
  [0xa4d4, 'T', 'English', 'default'], // ꓔ Lisu Letter Ta
  [0xa4d6, 'G', 'English', 'default'], // ꓖ Lisu Letter Ga
  [0xa4d7, 'K', 'English', 'default'], // ꓗ Lisu Letter Ka
  [0xa4d9, 'J', 'English', 'default'], // ꓙ Lisu Letter Ja
  [0xa4da, 'C', 'English', 'default'], // ꓚ Lisu Letter Ca
  [0xa4dc, 'Z', 'English', 'default'], // ꓜ Lisu Letter Dza
  [0xa4dd, 'F', 'English', 'default'], // ꓝ Lisu Letter Tsa
  [0xa4df, 'M', 'English', 'default'], // ꓟ Lisu Letter Ma
  [0xa4e0, 'N', 'English', 'default'], // ꓠ Lisu Letter Na
  [0xa4e1, 'L', 'English', 'default'], // ꓡ Lisu Letter La
  [0xa4e2, 'S', 'English', 'default'], // ꓢ Lisu Letter Sa
  [0xa4e3, 'R', 'English', 'default'], // ꓣ Lisu Letter Zha
  [0xa4e6, 'V', 'English', 'default'], // ꓦ Lisu Letter Ha
  [0xa4e7, 'H', 'English', 'default'], // ꓧ Lisu Letter Xa
  [0xa4ea, 'W', 'English', 'default'], // ꓪ Lisu Letter Wa
  [0xa4eb, 'X', 'English', 'default'], // ꓫ Lisu Letter Sha
  [0xa4ec, 'Y', 'English', 'default'], // ꓬ Lisu Letter Ya
  [0xa4ee, 'A', 'English', 'default'], // ꓮ Lisu Letter A
  [0xa4f0, 'E', 'English', 'default'], // ꓰ Lisu Letter E
  [0xa4f3, 'O', 'English', 'default'], // ꓳ Lisu Letter O
  [0xa4f4, 'U', 'English', 'default'], // ꓴ Lisu Letter U
  [0x10282, 'B', 'English', 'default'], // 𐊂 Lycian Letter B
  [0x10285, 'Δ', 'Greek', 'default'], // 𐊅 Lycian Letter D
  [0x10286, 'E', 'English', 'default'], // 𐊆 Lycian Letter I
  [0x10287, 'F', 'English', 'default'], // 𐊇 Lycian Letter W
  [0x10290, 'X', 'English', 'default'], // 𐊐 Lycian Letter Mm
  [0x10292, 'O', 'English', 'default'], // 𐊒 Lycian Letter U
  [0x10295, 'P', 'English', 'default'], // 𐊕 Lycian Letter R
  [0x10297, 'T', 'English', 'default'], // 𐊗 Lycian Letter T
  [0x16f07, 'Γ', 'Greek', 'default'], // 𖼇 Miao Letter Fa
  [0x16f07, 'Г', 'Russian', 'default'], // 𖼇 Miao Letter Fa
  [0x16f08, 'V', 'English', 'default'], // 𖼈 Miao Letter Va
  [0x16f0a, 'T', 'English', 'default'], // 𖼊 Miao Letter Ta
  [0x16f16, 'L', 'English', 'default'], // 𖼖 Miao Letter La
  [0x16f1a, 'Δ', 'Greek', 'default'], // 𖼚 Miao Letter Tlha
  [0x16f35, 'R', 'English', 'default'], // 𖼵 Miao Letter Zha
  [0x16f3a, 'S', 'English', 'default'], // 𖼺 Miao Letter Sa
  [0x16f40, 'A', 'English', 'default'], // 𖽀 Miao Letter Zzya
  [0x16f42, 'U', 'English', 'default'], // 𖽂 Miao Letter Wa
  [0x16f43, 'Y', 'English', 'default'], // 𖽃 Miao Letter Ah
  [0x10301, 'B', 'English', 'default'], // 𐌁 Old Italic Letter Be
  [0x10317, 'X', 'English', 'default'], // 𐌗 Old Italic Letter Eks
  [0x10322, 'X', 'English', 'default'], // 𐌢 Old Italic Numeral Ten
  [0x0b20, 'O', 'English', 'default'], // ଠ Oriya Letter Ttha
  [0x104c2, 'O', 'English', 'default'], // 𐓂 Osage Capital Letter O
  [0x104ce, 'U', 'English', 'default'], // 𐓎 Osage Capital Letter U
  [0x104d1, 'Ψ', 'Greek', 'default'], // 𐓑 Osage Capital Letter Gha
  [0x16b7, 'X', 'English', 'default'], // ᚷ Runic Letter Gebo Gyfu G
  [0x2d38, 'V', 'English', 'default'], // ⴸ Tifinagh Letter Yadh
  [0x2d39, 'E', 'English', 'default'], // ⴹ Tifinagh Letter Yadd
  [0x2d54, 'O', 'English', 'default'], // ⵔ Tifinagh Letter Yar
  [0x2d5d, 'X', 'English', 'default'], // ⵝ Tifinagh Letter Yath
  [0x2d60, 'Δ', 'Greek', 'default'], // ⵠ Tifinagh Letter Yav
  [0x118a0, 'V', 'English', 'default'], // 𑢠 Warang Citi Capital Letter Ngaa
  [0x118a3, 'L', 'English', 'default'], // 𑢣 Warang Citi Capital Letter Yu
  [0x118a9, 'Z', 'English', 'default'], // 𑢩 Warang Citi Capital Letter O
  [0x118ae, 'E', 'English', 'default'], // 𑢮 Warang Citi Capital Letter Yuj
  [0x118b5, 'O', 'English', 'default'], // 𑢵 Warang Citi Capital Letter At
  [0x118b8, 'U', 'English', 'default'], // 𑢸 Warang Citi Capital Letter Pu
  [0x118bc, 'T', 'English', 'default'], // 𑢼 Warang Citi Capital Letter Har
  [0x118e9, 'c', 'English', 'default'], // 𑣩 Warang Citi Digit Nine
  [0x15ea, 'D', 'English', 'default'], // ᗪ Canadian Syllabics Carrier Pe
  [0x118a6, 'E', 'English', 'default'], // 𑢦 Warang Citi Capital Letter Ii
  [0x15b4, 'F', 'English', 'default'], // ᖴ Canadian Syllabics Blackfoot We
  [0x102a5, 'F', 'English', 'default'], // 𐊥 Carian Letter R
  [0x10525, 'F', 'English', 'default'], // 𐔥 Elbasan Letter Ghe
  [0x118a2, 'F', 'English', 'default'], // 𑢢 Warang Citi Capital Letter Wi
  [0x118c2, 'f', 'English', 'default'], // 𑣂 Warang Citi Small Letter Wi
  [0x148d, 'J', 'English', 'default'], // ᒍ Canadian Syllabics Co
  [0x16d5, 'K', 'English', 'default'], // ᛕ Runic Letter Open-P
  [0x118b2, 'L', 'English', 'default'], // 𑢲 Warang Citi Capital Letter Tte
  [0x15f0, 'M', 'English', 'default'], // ᗰ Canadian Syllabics Carrier Go
  [0x102b0, 'M', 'English', 'default'], // 𐊰 Carian Letter S
  [0x10311, 'M', 'English', 'default'], // 𐌑 Old Italic Letter She
  [0x16d6, 'M', 'English', 'default'], // ᛖ Runic Letter Ehwaz Eh E
  [0x10404, 'O', 'English', 'default'], // 𐐄 Deseret Capital Letter Long O
  [0x07c0, 'O', 'English', 'default'], // ߀ Nko Digit Zero
  [0x10516, 'o', 'English', 'default'], // 𐔖 Elbasan Letter O
  [0x12d0, 'O', 'English', 'default'], // ዐ Ethiopic Syllable Pharyngeal A
  [0x118e0, 'o', 'English', 'default'], // 𑣠 Warang Citi Digit Zero
  [0x146d, 'P', 'English', 'default'], // ᑭ Canadian Syllabics Ki
  [0x2d55, 'Q', 'English', 'default'], // ⵕ Tifinagh Letter Yarr
  [0x104b4, 'R', 'English', 'default'], // 𐒴 Osage Capital Letter Bra
  [0x144c, 'U', 'English', 'default'], // ᑌ Canadian Syllabics Te
  [0x1200, 'U', 'English', 'default'], // ሀ Ethiopic Syllable Ha
  [0x118e6, 'W', 'English', 'default'], // 𑣦 Warang Citi Digit Six
  [0x118a4, 'Y', 'English', 'default'], // 𑢤 Warang Citi Capital Letter Ya
  [0x10513, 'n', 'English', 'optional'], // 𐔓 Elbasan Letter Ne; optional
  [0x10296, 's', 'English', 'optional'], // 𐊖 Lycian Letter S; optional
  [0x118ec, 'X', 'English', 'optional'], // 𑣬 Warang Citi Number Thirty; optional
  [0x118e5, 'z', 'English', 'optional'], // 𑣥 Warang Citi Digit Five; optional
  [0x104cd, 'Ћ', 'Serbian', 'default'], // 𐓍 Osage Capital Letter Dha; Ћ only
  [0x10425, 'И', 'Russian', 'default'], // 𐐥 Deseret Capital Letter Eng
  [0xa6db, 'П', 'Russian', 'default'], // ꛛ Bamum Letter Na; Russian П, not Greek Π
  [0x16f0, 'Φ', 'Greek', 'default'], // ᛰ Runic Belgthor Symbol
  [0x16f0, 'Ф', 'Russian', 'default'], // ᛰ Runic Belgthor Symbol
  [0x102b3, 'Φ', 'Greek', 'default'], // 𐊳 Carian Letter Nn
  [0x102b3, 'Ф', 'Russian', 'default'], // 𐊳 Carian Letter Nn
  [0x1240, 'Φ', 'Greek', 'default'], // ቀ Ethiopic Syllable Qa
  [0x1240, 'Ф', 'Russian', 'default'], // ቀ Ethiopic Syllable Qa
  [0x16d8, 'Ψ', 'Greek', 'default'], // ᛘ Runic Letter Long-Branch-Madr M
  [0x0667, 'V', 'English', 'default'], // ٧ Arabic-Indic Digit Seven; digit
  [0x06f7, 'V', 'English', 'default'], // ۷ Extended Arabic-Indic Digit Seven; digit
  [0x05d5, 'i', 'English', 'default'], // ו Hebrew Letter Vav
  [0x05df, 'l', 'English', 'default'], // ן Hebrew Letter Final Nun
  [0x0627, 'l', 'English', 'default'], // ا Arabic Letter Alef
  [0x1004, 'c', 'English', 'default'], // င Myanmar Letter Nga
  [0xa4d2, 'd', 'English', 'default'], // ꓒ Lisu Letter Pha
  [0x118c3, 'i', 'English', 'default'], // 𑣃 Warang Citi Small Letter Yu
  [0x0647, 'o', 'English', 'default'], // ه Arabic Letter Heh
  [0x06c1, 'o', 'English', 'default'], // ہ Arabic Letter Heh Goal
  [0x06d5, 'o', 'English', 'default'], // ە Arabic Letter Ae
  [0x0c82, 'o', 'English', 'default'], // ಂ Kannada Sign Anusvara
  [0x0d02, 'o', 'English', 'default'], // ം Malayalam Sign Anusvara
  [0x0d20, 'o', 'English', 'default'], // ഠ Malayalam Letter Ttha
  [0x0d82, 'o', 'English', 'default'], // ං Sinhala Sign Anusvaraya
  [0x0c02, 'o', 'English', 'default'], // ం Telugu Sign Anusvara
  [0x118c8, 'o', 'English', 'default'], // 𑣈 Warang Citi Small Letter E
  [0x0d1f, 's', 'English', 'default'], // ട Malayalam Letter Tta
  [0x118c1, 's', 'English', 'default'], // 𑣁 Warang Citi Small Letter A
  [0x118d8, 'u', 'English', 'default'], // 𑣘 Warang Citi Small Letter Pu
  [0x11706, 'v', 'English', 'default'], // 𑜆 Ahom Letter Pa
  [0x05d8, 'v', 'English', 'default'], // ט Hebrew Letter Tet
  [0x1170a, 'w', 'English', 'default'], // 𑜊 Ahom Letter Ja
  [0x1170e, 'w', 'English', 'default'], // 𑜎 Ahom Letter La
  [0x1170f, 'w', 'English', 'default'], // 𑜏 Ahom Letter Sa
  [0x10e7, 'y', 'English', 'default'], // ყ Georgian Letter Qar
  [0x118c4, 'z', 'English', 'default'], // 𑣄 Warang Citi Small Letter Ya
  [0x0aaa, 'ч', 'Russian', 'default'], // પ Gujarati Letter Pa
  [0x104db, 'λ', 'Greek', 'default'], // 𐓛 Osage Small Letter Ah
  [0x104f9, 'ψ', 'Greek', 'default'], // 𐓹 Osage Small Letter Gha
  [0x118dc, 'γ', 'Greek', 'optional'], // 𑣜 Warang Citi Small Letter Har
  [0x0665, 'o', 'English', 'default'], // ٥ Arabic-Indic Digit Five; digit
  [0x0966, 'o', 'English', 'default'], // ० Devanagari Digit Zero; digit
  [0x0ae6, 'o', 'English', 'default'], // ૦ Gujarati Digit Zero; digit
  [0x0c66, 'o', 'English', 'default'], // ౦ Telugu Digit Zero; digit
  [0x0aeb, 'ч', 'Russian', 'default'], // ૫ Gujarati Digit Five; digit
  [0x06f1, 'l', 'English', 'default'], // ۱ Extended Arabic-Indic Digit One; decision 0a: digit
  [0x0d66, 'o', 'English', 'default'], // ൦ Malayalam Digit Zero; digit
  [0x2cdc, 'δ', 'Greek', 'default'], // Ⳝ Coptic Capital Letter Old Nubian Shima
  [0x03ec, 'б', 'Russian', 'default'], // Ϭ Coptic Capital Letter Shima
  [0x15af, 'b', 'English', 'default'], // ᖯ Canadian Syllabics Aivilik B
  [0x1472, 'b', 'English', 'default'], // ᑲ Canadian Syllabics Ka
  [0x1043d, 'c', 'English', 'default'], // 𐐽 Deseret Small Letter Chee
  [0x146f, 'd', 'English', 'default'], // ᑯ Canadian Syllabics Ko
  [0x07ca, 'l', 'English', 'default'], // ߊ Nko Letter A
  [0xa4f2, 'I', 'English', 'default'], // ꓲ Lisu Letter I; 37: caseless, its capital
  [0x1e8c7, 'l', 'English', 'default'], // 𞣇 Mende Kikakui Digit One
  [0x16f28, 'l', 'English', 'default'], // 𖼨 Miao Letter Gha
  [0x10309, 'l', 'English', 'default'], // 𐌉 Old Italic Letter I
  [0x10320, 'l', 'English', 'default'], // 𐌠 Old Italic Numeral One
  [0x16c1, 'l', 'English', 'default'], // ᛁ Runic Letter Isaz Is Iss I
  [0x2d4f, 'l', 'English', 'default'], // ⵏ Tifinagh Letter Yan
  [0x1028a, 'l', 'English', 'default'], // 𐊊 Lycian Letter J
  [0x10ff, 'o', 'English', 'default'], // ჿ Georgian Letter Labial Sign
  [0x05e1, 'o', 'English', 'default'], // ס Hebrew Letter Samekh
  [0x1042c, 'o', 'English', 'default'], // 𐐬 Deseret Small Letter Long O
  [0x104ea, 'o', 'English', 'default'], // 𐓪 Osage Small Letter O
  [0x101d, 'o', 'English', 'default'], // ဝ Myanmar Letter Wa
  [0x118d7, 'o', 'English', 'default'], // 𑣗 Warang Citi Small Letter Bu
  [0x10448, 's', 'English', 'default'], // 𐑈 Deseret Small Letter Zhee
  [0x104f6, 'u', 'English', 'default'], // 𐓶 Osage Small Letter U
  [0x118c0, 'v', 'English', 'default'], // 𑣀 Warang Citi Small Letter Ngaa
  [0x0661, 'l', 'English', 'default'], // ١ Arabic-Indic Digit One; digit
  [0x0ed0, 'o', 'English', 'default'], // ໐ Lao Digit Zero; digit
  [0x1040, 'o', 'English', 'default'], // ၀ Myanmar Digit Zero; digit
  [0x0be6, 'o', 'English', 'default'], // ௦ Tamil Digit Zero; digit
  [0x17e0, 'o', 'English', 'default'], // ០ Khmer Digit Zero; digit
  [0x0e50, 'o', 'English', 'default'], // ๐ Thai Digit Zero; digit
  [0x09e6, 'o', 'English', 'default'], // ০ Bengali Digit Zero; digit
  [0x0a66, 'o', 'English', 'default'], // ੦ Gurmukhi Digit Zero; digit
  [0x0b66, 'o', 'English', 'default'], // ୦ Oriya Digit Zero; digit
  [0x114d0, 'o', 'English', 'default'], // 𑓐 Tirhuta Digit Zero; digit
  // Decision 40f: the long s and the lunate sigma are ordinary donors.
  [0x017f, 's', 'English', 'default'], // ſ Latin Small Letter Long S
  [0x03f2, 'c', 'English', 'default'], // ϲ Greek Lunate Sigma Symbol
  [0x03f9, 'C', 'English', 'default'], // Ϲ Greek Capital Lunate Sigma Symbol
  [0x03f2, 'с', 'Russian', 'default'],
  [0x03f9, 'С', 'Russian', 'default'],
  [0x03f2, 'с', 'Ukrainian', 'default'],
  [0x03f9, 'С', 'Ukrainian', 'default'],
  [0x03f2, 'σ', 'Greek', 'default'],
  [0x03f9, 'Σ', 'Greek', 'default'],
];

/** Characters that look like an ASCII digit (decision 41; with `Ꮞ`, `৪`): always converted, a spoof (41c). */
export const DIGIT_LOOKALIKES: readonly (readonly [char: number, digit: string])[] = [
  [0xa6ef, '2'], // ꛯ Bamum Letter Koghom
  [0x03e8, '2'], // Ϩ Coptic Capital Letter Hori
  [0x2c9c, '3'], // Ⲝ Coptic Capital Letter Ksi
  [0x2cc4, '3'], // Ⳅ Coptic Capital Letter Old Coptic Shei
  [0x0969, '3'], // ३ Devanagari Digit Three
  [0x0ae9, '3'], // ૩ Gujarati Digit Three
  [0x16f3b, '3'], // 𖼻 Miao Letter Za
  [0x118ca, '3'], // 𑣊 Warang Citi Small Letter Ang
  [0x118af, '4'], // 𑢯 Warang Citi Capital Letter Uc
  [0x118bb, '5'], // 𑢻 Warang Citi Capital Letter Horr
  [0x13ee, '6'], // Ꮾ Cherokee Letter Wv
  [0x03ec, '6'], // Ϭ Coptic Capital Letter Shima
  [0x118d5, '6'], // 𑣕 Warang Citi Small Letter At
  [0x104d2, '7'], // 𐓒 Osage Capital Letter Za
  [0x118c6, '7'], // 𑣆 Warang Citi Small Letter Ii
  [0x0b68, '9'], // ୨ Oriya Digit Two
  [0x09ed, '9'], // ৭ Bengali Digit Seven
  [0x2ccb, '9'], // ⳋ Coptic Small Letter Dialect-P Hori
  [0x0a67, '9'], // ੧ Gurmukhi Digit One
  [0x118ac, '9'], // 𑢬 Warang Citi Capital Letter Ko
  [0x118cc, '9'], // 𑣌 Warang Citi Small Letter Ko
  [0x13ce, '4'], // Ꮞ Cherokee Letter Se
  [0x09ea, '8'], // ৪ Bengali Digit Four
  [0x14bf, '2'], // ᒿ Canadian Syllabics Sayisi M
  [0x2ccc, '3'], // Ⳍ Coptic Capital Letter Old Coptic Hori
  [0x2cd3, '6'], // ⳓ Coptic Small Letter Old Coptic Hei
  [0x2cd2, '6'], // Ⳓ Coptic Capital Letter Old Coptic Hei
  [0x1e8cb, '8'], // 𞣋 Mende Kikakui Digit Five
  [0x1031a, '8'], // 𐌚 Old Italic Letter Ef
  [0x0a6a, '8'], // ੪ Gurmukhi Digit Four
  [0x2cca, '9'], // Ⳋ Coptic Capital Letter Dialect-P Hori
];

/**
 * Decision 41l: the digit reading of a digit donor, its second mapping beside
 * the letter reading of its target packs, shared by all packs and taken inside a
 * number (digits are never a word's target; an additional donor → digit
 * mapping, not an alphabet). The zeros, `١ ۱` → `1`, `٥` → `0`; every other digit donor (`٧ ۷`) keeps its letter reading only.
 */
export const DIGIT_READINGS: readonly (readonly [char: number, digit: string])[] = [
  [0x09e6, '0'], // ০ Bengali
  [0x0966, '0'], // ० Devanagari
  [0x0ae6, '0'], // ૦ Gujarati
  [0x0c66, '0'], // ౦ Telugu
  [0x0ed0, '0'], // ໐ Lao
  [0x1040, '0'], // ၀ Myanmar
  [0x0be6, '0'], // ௦ Tamil
  [0x17e0, '0'], // ០ Khmer
  [0x0e50, '0'], // ๐ Thai
  [0x0a66, '0'], // ੦ Gurmukhi
  [0x0b66, '0'], // ୦ Oriya
  [0x114d0, '0'], // 𑓐 Tirhuta
  [0x0ce6, '0'], // ೦ Kannada
  [0x0d66, '0'], // ൦ Malayalam
  [0x07c0, '0'], // ߀ NKo
  [0x118e0, '0'], // 𑣠 Warang Citi
  [0x3007, '0'], // 〇 ideographic zero
  [0x0661, '1'], // ١ Arabic-Indic one
  [0x06f1, '1'], // ۱ Extended Arabic-Indic one
  [0x0665, '0'], // ٥ Arabic-Indic five, written as a zero
];

/**
 * Decision 37: caseless strokes drawn at cap height, read as English `I`
 * or `l` by their neighbours' case ({@link LetterPhase}'s case reading). Vav (too low for `I`,
 * read `i`), final nun (keeps `l`) and the slanted digit ones `١` `۱` (read `l`) are not.
 */
export const CASE_STROKES: readonly number[] = [
  0xa4f2, // ꓲ Lisu Letter I
  0x01c0, // ǀ Latin Letter Dental Click (no `i` reading: too high)
  0x07ca, // ߊ Nko Letter A
  0x16c1, // ᛁ Runic Letter Isaz Is Iss I
  0x2d4f, // ⵏ Tifinagh Letter Yan
  0x1028a, // 𐊊 Lycian Letter J
  0x10309, // 𐌉 Old Italic Letter I
  0x10320, // 𐌠 Old Italic Numeral One
  0x16f28, // 𖼨 Miao Letter Gha
  0x1e8c7, // 𞣇 Mende Kikakui Digit One
  0x0627, // ا Arabic Letter Alef
];

/**
 * Twin-table pairs a curated row replaces in a default pack (decision 40f:
 * `ſ` reads `s` in English, not `f`).
 */
export const REPLACED_TABLE_PAIRS: readonly (readonly [
  donor: string,
  target: string,
  language: string,
])[] = [['ſ', 'f', 'English']];
