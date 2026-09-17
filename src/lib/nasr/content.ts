import type { NasrContent, NasrContentItemKey } from "./schemas";

type Guide = {
  title: string
  window: string
  summary: string
  closingNote?: string
}

export const NASR_GUIDES: Record<NasrContentItemKey, Guide> = {
  morning_adhkar: {
    title: 'Morning adhkar',
    window: 'After Fajr until sunrise; continue before midday if missed.',
    summary: 'Work down the list once. The three short suras are the only morning items repeated three times.',
  },
  evening_adhkar: {
    title: 'Evening adhkar',
    window: 'After Asr until sunset; continue into the night if missed.',
    summary: 'The morning set, plus the evening protection invocation at the end.',
  },
  night_ayat: {
    title: 'Night recitation',
    window: 'At bedtime.',
    summary: 'Three distinct practices, tracked separately so a partial night is still recorded accurately.',
  },
  ruqyah: {
    title: 'Self-ruqyah',
    window: 'Once daily, roughly ten minutes.',
    summary: 'Cup your hands, recite into your palms, blow lightly, then wipe your head, face, chest and what you can reach. Repeat the wipe three times.',
    closingNote: 'Optional passages for sihr-specific ruqyah: Al-A’raf 7:117–122, Yunus 10:79–82 and Ta-Ha 20:65–69. This is scholarly practice based on their meaning, not a transmitted prescription. If a marked reaction repeats, record it in Observations with the date and time; no reaction is also useful information.',
  },
  istighfar: {
    title: 'Istighfar',
    window: 'Across the day.',
    summary: 'Use the counter rather than estimating. The daily target defaults to 100.',
  },
}

const kursi = {
  title: 'Ayat al-Kursi — Al-Baqarah 2:255',
  arabic: 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَّهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَن ذَا الَّذِي يَشْفَعُ عِندَهُ إِلَّا بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِّنْ عِلْمِهِ إِلَّا بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ',
  transliteration: "Allahu la ilaha illa Huwal-Hayyul-Qayyum. La ta'khudhuhu sinatun wa la nawm. Lahu ma fis-samawati wa ma fil-ard. Man dhal-ladhi yashfa'u 'indahu illa bi idhnih. Ya'lamu ma bayna aydihim wa ma khalfahum, wa la yuhituna bi shay'in min 'ilmihi illa bima sha'. Wasi'a kursiyyuhus-samawati wal-ard, wa la ya'uduhu hifzuhuma, wa Huwal-'Aliyyul-'Azim.",
  meaning: 'Allah — there is no god but He, the Ever-Living, the Sustainer of all. Neither drowsiness nor sleep overtakes Him. To Him belongs whatever is in the heavens and the earth. Who can intercede with Him except by His permission? He knows what lies before them and behind them, and they grasp nothing of His knowledge except what He wills. His Throne extends over the heavens and the earth, and preserving them does not weary Him. He is the Most High, the Magnificent.',
}

const suras = [
  {
    slug: 'ikhlas', title: 'Al-Ikhlas (112)',
    arabic: 'قُلْ هُوَ اللَّهُ أَحَدٌ ۝ اللَّهُ الصَّمَدُ ۝ لَمْ يَلِدْ وَلَمْ يُولَدْ ۝ وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ',
    transliteration: 'Qul Huwallahu Ahad. Allahus-Samad. Lam yalid wa lam yulad. Wa lam yakun lahu kufuwan ahad.',
    meaning: 'Say: He is Allah, One. Allah, the Eternal Refuge. He does not beget, nor was He begotten. And there is none comparable to Him.',
  },
  {
    slug: 'falaq', title: 'Al-Falaq (113)',
    arabic: 'قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ ۝ مِن شَرِّ مَا خَلَقَ ۝ وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ ۝ وَمِن شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ ۝ وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ',
    transliteration: "Qul a'udhu bi Rabbil-falaq. Min sharri ma khalaq. Wa min sharri ghasiqin idha waqab. Wa min sharrin-naffathati fil-'uqad. Wa min sharri hasidin idha hasad.",
    meaning: 'Say: I seek refuge in the Lord of daybreak, from the evil of what He created, from darkness when it settles, from those who blow on knots, and from an envier when he envies.',
  },
  {
    slug: 'nas', title: 'An-Nas (114)',
    arabic: 'قُلْ أَعُوذُ بِرَبِّ النَّاسِ ۝ مَلِكِ النَّاسِ ۝ إِلَٰهِ النَّاسِ ۝ مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ ۝ الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ ۝ مِنَ الْجِنَّةِ وَالنَّاسِ',
    transliteration: "Qul a'udhu bi Rabbin-nas. Malikin-nas. Ilahin-nas. Min sharril-waswasil-khannas. Alladhi yuwaswisu fi sudurin-nas. Minal-jinnati wan-nas.",
    meaning: 'Say: I seek refuge in the Lord of mankind, the Sovereign of mankind, the God of mankind, from the retreating whisperer who whispers into hearts — from among jinn and people.',
  },
]

const baqarahEnding = {
  title: 'The last two verses of Al-Baqarah — 2:285–286',
  arabic: 'آمَنَ الرَّسُولُ بِمَا أُنزِلَ إِلَيْهِ مِن رَّبِّهِ وَالْمُؤْمِنُونَ ۚ كُلٌّ آمَنَ بِاللَّهِ وَمَلَائِكَتِهِ وَكُتُبِهِ وَرُسُلِهِ لَا نُفَرِّقُ بَيْنَ أَحَدٍ مِّن رُّسُلِهِ ۚ وَقَالُوا سَمِعْنَا وَأَطَعْنَا ۖ غُفْرَانَكَ رَبَّنَا وَإِلَيْكَ الْمَصِيرُ\n\nلَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا ۚ لَهَا مَا كَسَبَتْ وَعَلَيْهَا مَا اكْتَسَبَتْ ۗ رَبَّنَا لَا تُؤَاخِذْنَا إِن نَّسِينَا أَوْ أَخْطَأْنَا ۚ رَبَّنَا وَلَا تَحْمِلْ عَلَيْنَا إِصْرًا كَمَا حَمَلْتَهُ عَلَى الَّذِينَ مِن قَبْلِنَا ۚ رَبَّنَا وَلَا تُحَمِّلْنَا مَا لَا طَاقَةَ لَنَا بِهِ ۖ وَاعْفُ عَنَّا وَاغْفِرْ لَنَا وَارْحَمْنَا ۚ أَنتَ مَوْلَانَا فَانصُرْنَا عَلَى الْقَوْمِ الْكَافِرِينَ',
  transliteration: "Amanar-Rasulu bima unzila ilayhi mir-Rabbihi wal-mu'minun. Kullun amana billahi wa mala'ikatihi wa kutubihi wa rusulih. La nufarriqu bayna ahadim-mir-rusulih. Wa qalu sami'na wa ata'na, ghufranaka Rabbana wa ilaykal-masir.\n\nLa yukallifullahu nafsan illa wus'aha. Laha ma kasabat wa 'alayha maktasabat. Rabbana la tu'akhidhna in nasina aw akhta'na. Rabbana wa la tahmil 'alayna isran kama hamaltahu 'alal-ladhina min qablina. Rabbana wa la tuhammilna ma la taqata lana bih. Wa'fu 'anna, waghfir lana, warhamna. Anta Mawlana fansurna 'alal-qawmil-kafirin.",
  meaning: 'The Messenger and the believers believe in what was revealed from their Lord. They hear and obey and ask His forgiveness. Allah does not burden a soul beyond its capacity; the verses close with prayers for pardon, forgiveness, mercy and help.',
}

const morningCore: Omit<NasrContent, 'id' | 'item_key'>[] = [
  { ...kursi, repetitions: 'Once', reference: "Ubayy ibn Ka'b — an-Nasa'i, 'Amal al-Yawm wa'l-Laylah 960; Sahih at-Targhib 655.", grade: 'sahih', sort_order: 10, note: 'The transmitted morning count is once, not three times.' },
  ...suras.map(({ slug: _slug, ...sura }, index) => ({ ...sura, repetitions: 'Three times', reference: 'Abdullah ibn Khubayb — Abu Dawud 5082; at-Tirmidhi 3575.', grade: 'sahih' as const, sort_order: 20 + index, note: 'Recite each of the three suras three times.' })),
  {
    title: 'Sayyid al-Istighfar', repetitions: 'Once', sort_order: 30, grade: 'sahih', reference: 'Shaddad ibn Aws — Sahih al-Bukhari 6306.',
    arabic: 'اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَى عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ لَكَ بِذَنْبِي فَاغْفِرْ لِي فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ',
    transliteration: "Allahumma anta Rabbi la ilaha illa anta, khalaqtani wa ana 'abduka, wa ana 'ala 'ahdika wa wa'dika mastata'tu, a'udhu bika min sharri ma sana'tu, abu'u laka bi ni'matika 'alayya, wa abu'u laka bi dhanbi faghfir li fa innahu la yaghfirudh-dhunuba illa anta.",
    meaning: 'O Allah, You are my Lord; there is no god but You. You created me and I am Your servant. I hold to Your covenant as far as I am able. I seek refuge from the evil I have done, acknowledge Your favour and my sin, and ask Your forgiveness.', note: null,
  },
  {
    title: 'Protection from harm', repetitions: 'Three times', sort_order: 40, grade: 'sahih', reference: 'Uthman ibn Affan — Abu Dawud 5088; at-Tirmidhi 3388; Ibn Majah 3869.',
    arabic: 'بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ',
    transliteration: "Bismillahil-ladhi la yadurru ma'asmihi shay'un fil-ardi wa la fis-sama'i wa Huwas-Sami'ul-'Alim.", meaning: 'In the name of Allah, with whose name nothing on earth or in heaven can cause harm — and He is the All-Hearing, the All-Knowing.', note: null,
  },
  {
    title: 'Contentment with the decree', repetitions: 'Three times', sort_order: 50, grade: 'hasan', reference: 'Abu Salam — Abu Dawud 5072; at-Tirmidhi 3389; Ahmad.',
    arabic: 'رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ نَبِيًّا', transliteration: "Raditu billahi Rabban, wa bil-Islami dinan, wa bi Muhammadin sallallahu 'alayhi wa sallama nabiyyan.", meaning: 'I am content with Allah as Lord, with Islam as religion, and with Muhammad ﷺ as Prophet.', note: null,
  },
  {
    title: 'Sufficiency', repetitions: 'Seven times', sort_order: 60, grade: 'mawquf', reference: "Abu'd-Darda' — Abu Dawud 5081 (mawquf); al-Albani graded the chain hasan.",
    arabic: 'حَسْبِيَ اللَّهُ لَا إِلَهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ', transliteration: "Hasbiyallahu la ilaha illa Huwa, 'alayhi tawakkaltu wa Huwa Rabbul-'Arshil-'Azim.", meaning: 'Allah is sufficient for me. There is no god but He. In Him I place my trust, and He is Lord of the Mighty Throne.', note: 'The wording is Qur’an 9:129. The caveat concerns the specific sevenfold promise, whose Abu Dawud chain stops at the Companion.',
  },
  {
    title: 'Pardon and wellbeing', repetitions: 'Once', sort_order: 70, grade: 'sahih', reference: "Ibn Umar — Abu Dawud 5074; Ibn Majah 3871; an-Nasa'i.",
    arabic: 'اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ، اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي دِينِي وَدُنْيَايَ وَأَهْلِي وَمَالِي، اللَّهُمَّ اسْتُرْ عَوْرَاتِي وَآمِنْ رَوْعَاتِي', transliteration: "Allahumma inni as'alukal-'afwa wal-'afiyata fid-dunya wal-akhirah. Allahumma inni as'alukal-'afwa wal-'afiyata fi dini wa dunyaya wa ahli wa mali. Allahummastur 'awrati wa amin raw'ati.", meaning: 'O Allah, I ask You for pardon and wellbeing in this world and the next, in my religion, worldly affairs, family and wealth. Conceal my faults and calm my fears.', note: null,
  },
  {
    title: 'Put all of my affairs in order', repetitions: 'Once', sort_order: 80, grade: 'hasan', reference: "Anas ibn Malik — an-Nasa'i, as-Sunan al-Kubra 6/147; as-Silsilah as-Sahihah 227.",
    arabic: 'يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ، أَصْلِحْ لِي شَأْنِي كُلَّهُ، وَلَا تَكِلْنِي إِلَى نَفْسِي طَرْفَةَ عَيْنٍ', transliteration: "Ya Hayyu ya Qayyumu bi rahmatika astaghith, aslih li sha'ni kullahu, wa la takilni ila nafsi tarfata 'ayn.", meaning: 'O Ever-Living, O Sustainer, by Your mercy I seek help. Put all of my affairs in order, and do not leave me to myself for even the blink of an eye.', note: null,
  },
  {
    title: 'Tasbih', repetitions: '100 times', sort_order: 90, grade: 'sahih', reference: 'Abu Hurayra — Sahih Muslim 2692.', arabic: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ', transliteration: 'Subhanallahi wa bihamdih.', meaning: 'Glory be to Allah, and praise Him.', note: null,
  },
]

const forGuide = (itemKey: 'morning_adhkar' | 'evening_adhkar') => morningCore.map((item, index) => ({ ...item, id: `${itemKey}-${index + 1}`, item_key: itemKey }))

const nightSuras = suras.map(({ slug, ...sura }, index) => ({ ...sura, id: `night-sura-${slug}`, item_key: 'night_ayat' as const, repetitions: 'Three times', reference: 'Aisha — Sahih al-Bukhari 5017.', grade: 'sahih' as const, sort_order: 30 + index, note: index === 0 ? 'Cup the hands, recite all three suras, blow lightly, then wipe over the head, face and front of the body. Repeat the complete practice three times.' : null }))

export const NASR_CONTENT: readonly NasrContent[] = [
  ...forGuide('morning_adhkar'),
  ...forGuide('evening_adhkar'),
  {
    id: 'evening-protection', item_key: 'evening_adhkar', title: 'Refuge in Allah’s perfect words', repetitions: 'Three times', sort_order: 100, grade: 'sahih', reference: 'Abu Hurayra — at-Tirmidhi 3604; general form in Sahih Muslim 2708–2709.',
    arabic: 'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ', transliteration: "A'udhu bi kalimatillahit-tammati min sharri ma khalaq.", meaning: 'I seek refuge in the perfect words of Allah from the evil of what He has created.', note: 'Specific to the evening set.',
  },
  { id: 'night-kursi', item_key: 'night_ayat', ...kursi, repetitions: 'Once', reference: 'Abu Hurayra — Sahih al-Bukhari 2311.', grade: 'sahih', sort_order: 10, note: 'Recite in bed. The narration promises a protector until morning.' },
  { id: 'night-baqarah', item_key: 'night_ayat', ...baqarahEnding, repetitions: 'Once', reference: 'Abu Mas’ud al-Ansari — Sahih al-Bukhari 5009; Sahih Muslim 807.', grade: 'sahih', sort_order: 20, note: 'Whoever recites these two verses at night, they will suffice him.' },
  ...nightSuras,
  {
    id: 'ruqyah-fatiha', item_key: 'ruqyah', title: 'Al-Fatiha (1:1–7)', repetitions: 'Once, unhurried', reference: "Abu Sa'id al-Khudri — Sahih al-Bukhari 5736.", grade: 'sahih', sort_order: 10, note: 'The Prophet ﷺ confirmed Al-Fatiha as ruqyah.',
    arabic: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ۝ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ ۝ الرَّحْمَٰنِ الرَّحِيمِ ۝ مَالِكِ يَوْمِ الدِّينِ ۝ إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ ۝ اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ ۝ صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ',
    transliteration: "Bismillahir-Rahmanir-Rahim. Alhamdu lillahi Rabbil-'alamin. Ar-Rahmanir-Rahim. Maliki yawmid-din. Iyyaka na'budu wa iyyaka nasta'in. Ihdinas-siratal-mustaqim. Siratal-ladhina an'amta 'alayhim, ghayril-maghdubi 'alayhim wa lad-dallin.",
    meaning: 'In the name of Allah, the Most Compassionate, the Most Merciful. All praise belongs to Allah, Lord of all worlds, the Most Compassionate, the Most Merciful, Master of the Day of Judgment. You alone we worship and You alone we ask for help. Guide us to the straight path: the path of those You have favoured, not those who earned anger or went astray.',
  },
  { id: 'ruqyah-kursi', item_key: 'ruqyah', ...kursi, repetitions: 'Once', reference: 'Abu Hurayra — Sahih al-Bukhari 2311.', grade: 'sahih', sort_order: 20, note: null },
  { id: 'ruqyah-baqarah', item_key: 'ruqyah', ...baqarahEnding, repetitions: 'Once', reference: 'Abu Mas’ud al-Ansari — Sahih al-Bukhari 5009; Sahih Muslim 807.', grade: 'sahih', sort_order: 30, note: null },
  ...suras.map(({ slug, ...sura }, index) => ({ ...sura, id: `ruqyah-${slug}`, item_key: 'ruqyah' as const, repetitions: 'Three times', reference: 'Aisha — Sahih al-Bukhari 5017.', grade: 'sahih' as const, sort_order: 40 + index, note: null })),
  {
    id: 'ruqyah-healing', item_key: 'ruqyah', title: 'Prayer for healing', repetitions: 'Once', sort_order: 50, grade: 'sahih', reference: 'Sahih al-Bukhari 5675; Sahih Muslim 2191.',
    arabic: 'اللَّهُمَّ رَبَّ النَّاسِ، أَذْهِبِ الْبَأْسَ، اشْفِ أَنْتَ الشَّافِي، لَا شِفَاءَ إِلَّا شِفَاؤُكَ، شِفَاءً لَا يُغَادِرُ سَقَمًا', transliteration: "Allahumma Rabban-nas, adhhibil-ba's, ishfi Antash-Shafi, la shifa'a illa shifa'uk, shifa'an la yughadiru saqama.", meaning: 'O Allah, Lord of mankind, remove the affliction. Heal — You are the Healer. There is no healing but Your healing, a healing that leaves behind no illness.', note: null,
  },
  {
    id: 'ruqyah-refuge', item_key: 'ruqyah', title: 'Refuge from every devil and evil eye', repetitions: 'Once', sort_order: 60, grade: 'sahih', reference: 'Ibn Abbas — Sahih al-Bukhari 3371.',
    arabic: 'أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّةِ مِنْ كُلِّ شَيْطَانٍ وَهَامَّةٍ، وَمِنْ كُلِّ عَيْنٍ لَامَّةٍ', transliteration: "A'udhu bi kalimatillahit-tammati min kulli shaytanin wa hammah, wa min kulli 'aynin lammah.", meaning: 'I seek refuge in the perfect words of Allah from every devil and harmful creature, and from every evil eye.', note: 'The Prophet ﷺ used these words to seek refuge for Hasan and Husayn.',
  },
  {
    id: 'istighfar-short', item_key: 'istighfar', title: 'Istighfar', repetitions: 'Target: 100 a day', sort_order: 10, grade: 'sahih', reference: 'Sahih Muslim 2702; Sahih al-Bukhari 6307; Abu Dawud 1516.', arabic: 'أَسْتَغْفِرُ اللَّهَ', transliteration: 'Astaghfirullah.', meaning: "I seek Allah's forgiveness.", note: 'Split the count across the day and use the counter rather than estimating.',
  },
  {
    id: 'istighfar-full', item_key: 'istighfar', title: 'Fuller form', repetitions: 'As preferred within the daily count', sort_order: 20, grade: 'sahih', reference: 'The daily volume is established in Sahih Muslim 2702 and Sahih al-Bukhari 6307.', arabic: 'أَسْتَغْفِرُ اللَّهَ الْعَظِيمَ الَّذِي لَا إِلَهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ وَأَتُوبُ إِلَيْهِ', transliteration: "Astaghfirullahal-'Azim alladhi la ilaha illa Huwal-Hayyul-Qayyumu wa atubu ilayh.", meaning: 'I seek the forgiveness of Allah the Magnificent, besides whom there is no god, the Ever-Living, the Sustainer, and I turn to Him in repentance.', note: 'Surah Nuh 71:10–12 is the rationale for tracking volume; it is not part of the recitation.',
  },
]
