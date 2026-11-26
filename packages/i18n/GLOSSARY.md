# Translating Touchdown: notes and glossary

The writing rules in AGENTS.md are written for English. These are the notes for each translation, and the words used
for Touchdown's terms, so every part of the interface uses the same ones. Change a term here and in the messages
together.

Touchdown is a personal log of flights the user has flown and aircraft the user has seen or photographed, with
statistics. Its readers are aviation enthusiasts and a few friends. The voice is plain and direct: no marketing, no
filler, no exclamation marks.

## Every language

- One message is one whole sentence or label: translate it as a whole, in the word order the language needs.
- Keep every argument (`{name}`), every tag (`<b>…</b>`, `<link>…</link>`) and every `select` choice (`you {…}`,
  `other {…}`) as the source has them. Move them to where the language needs them. Only the text around them changes.
- Plurals use the language's own forms: German `one` and `other`, Chinese `other` only. Keep exact branches (`=0 {…}`).
- Ordinals: German `{n, selectordinal, other {#.}}`, Chinese `{n, selectordinal, other {第 #}}`.
- No semicolons (`;`, `；`): split the sentence or join it.
- Headings, labels and tooltips name the thing. Only a real question to the user is a question.
- A non-breaking space stays where the source has one (between a number and its unit or noun).
- A type or model with a hyphen (`A340-\u2060600`, `MD-\u206095`) has a word joiner after the hyphen, so it never breaks
  across two lines.
- An apostrophe is `’` (U+2019). A plain `'` before `{`, `}`, `#` or `<` starts quoted text in the message syntax.
- Names stay as they are: Touchdown, Flightradar24, myFR24, OpenSky, adsbdb, adsb.lol, FlightAware, Flighty, Claude
  Code, Codex, IATA, ICAO, GPX, KML, CSV, JSON. Google Drive takes Google's own name in each language.
- Keep labels short: buttons, the choices of a setting and table headings sit in narrow places, on phones too.

## Nicknames and other culture terms

Some names are an enthusiasts' nickname rather than a description, such as the stamps named after an aircraft
("Queen of the Skies", "Flying Pencil", "Atari Ferrari"). A nickname belongs to the people who use it, so it is never
translated word for word.

- Use the name that enthusiasts writing in the language give the thing, even when its words mean something else. The
  A340-600's "Flying Pencil" is 法棍 in Chinese, and the 757's "Atari Ferrari" is 空中美男子.
- Find it used by speakers of the language (their forums, aviation press, spotters' sites), not only in translations
  of English articles. Say how strong the evidence is: one article or one forum comment is thin. When unsure, ask the
  owner. A name the owner or a native speaker gives wins over a search.
- Without a name of its own in the language, keep the English one, as German keeps "Superjumbo". Never make up a
  literal translation that nobody says (雅达利法拉利 for "Atari Ferrari").
- Check what else the words name in the language. "Fliegender Bleistift" is the German nickname of the Dornier Do 17,
  a Second World War bomber, so German keeps "Flying Pencil" for the A340-600.
- Note each choice in the table below, so a later change does not "correct" it back.

| en-GB | de-DE | zh-CN | zh-TW | Why |
|---|---|---|---|---|
| Queen of the Skies (747) | Königin der Lüfte | 空中女王 | 空中女王 | The usual name in each language. |
| Superjumbo (A380) | Superjumbo | 空中巨无霸 | 空中巨無霸 | German aviation press and Lufthansa use the English word. 空中巨无霸 is the Chinese name, China Southern's own among others (not 超级巨无霸, which no Chinese source was found using). |
| Flying Pencil (A340-600) | Flying Pencil | 法棍 | 法棍 | Chinese spotters' name, given by the owner. No German name is established, and the literal one is the Do 17's. |
| Atari Ferrari (757) | Atari-Ferrari | 空中美男子 | 空中美男子 | German uses the English pilots' name, hyphenated as German joins two names. The Chinese name is from Chinese aviation writing, chosen by the owner. |
| Pride of Seattle (Boeings designed there before 2001) | Stolz von Seattle | 西雅图之光 | 西雅圖之光 | A fond wink at Boeing, never a joke about its accidents. "X之光" is how Chinese praises the best of a place or a make. |
| Worth the wait (777X) | Gut Ding will Weile haben | 千呼万唤始出来 | 千呼萬喚始出來 | The proverbs each language uses for something long awaited, the Chinese one whole, chosen by the owner. |
| Douglas in disguise (717) | Douglas inkognito | 改名换姓 | 改名換姓 | The MD-95 under Boeing's name: the idiom for changing one's name. |
| LH2222 to Toulouse | LH2222 to Toulouse | LH2222 to Toulouse | LH2222 to Toulouse | A favourite on Instagram in English, read aloud as a run of "two"s into Toulouse. No language has a name of its own for it, so every one keeps the English. Its rule is translated. |
| Special liveries | Sonderlackierungen | 特殊涂装 | 彩繪機 | Taiwan's press and airlines call these aircraft 彩繪機. The stamp's rule and the rest of the interface keep the glossary's 特殊塗裝. |
| Thin air | Dünne Luft | 空气稀薄 | 空氣稀薄 | Said as Chinese says it, chosen by the owner. Not 高高原, the CAAC term for an airport at 2438 m or higher, as the stamp's line is 3000 m. |
| Short hop | Katzensprung | 一步之遥 | 一步之遙 | Kept by the owner, though the idiom more often means one step from a goal. |
| Back to yesterday | Zurück ins Gestern | 回到昨天 | 回到昨天 | "Ins Gestern", as German writes it: "nach" goes with places. |

## The CLI

- Help texts are laid out in columns. Keep each column where it starts, counting a Chinese character as two columns,
  and pad a translated label so the text after it still lines up. Wrap prose under 118 characters.
- What the user types stays in English: commands, options and their values, field names, `y` in `[y/N]`, and the
  words `spot` reads (`at`, `on`, `today`, `yesterday`, the phases, `help`, `quit`). A month given to `--where` is
  read in the interface's language or as a number (`month=3`).
- German: "Usage:" is "Aufruf:". `{from}` and an inbox's `{place}` are dative phrases ("deinem Logbuch in …"), put
  after "aus", "mit" or "in".
- Chinese: no typed space between Chinese and Latin text, as on the pages. The CLI adds the gaps itself before it
  prints (`autospace` in `packages/cli/src/language.ts`), before a command (`./touchdown`) or an option (`--yes`) too.

## de-DE

- Address the user as `du`, lower case (`du`, `dein`), never `Sie`.
- Quotation marks „…“, nested ‚…‘. Ellipsis `…`. Dashes `–`.
- Units: `km`, `mi`, `NM`. Durations: `{h} Std.`, `{m} Min.`, `{h} Std. {m} Min.`. The short form stays `{h}h {m}m`.

## zh-CN

- Address the user as `你`, never `您`.
- Full-width punctuation: ，。：！？、（）. Quotation marks “…”.
- No typed space between Chinese characters and Latin letters, digits, arguments or tags: the page draws a narrow gap
  there itself (CSS `text-autospace`), which a space would make too wide, and values put into a sentence get it too.
  "你已乘坐14个航班", "从{from}到{to}", "Touchdown的服务器". A space stays only between two Latin words.
- A date or a year is one word with the Chinese around it: a word joiner (`\u2060`) on each side keeps the gap out,
  "{date}\u2060搭乘", "自\u2060{first}\u2060年起", "{year}\u2060年至今". Dates the code formats are joined inside already
  ("4月26日"). Counts keep the gap: "14个航班" shows as "14 个航班".
- Units: `公里`, `英里`, `海里`. Durations: `{h}小时`, `{m}分钟`, `{h}小时{m}分钟`. The short form `{h}时{m}分`.
- A number and its unit stay on one line: a narrow no-break space (`\u202f`) between them, which looks like the page's
  own gap, and word joiners inside the unit, "{km}\u202f公\u2060里", "{h}\u202f小\u2060时" (`format.json`).
- Write what a Chinese interface would say, not each part of the English. "Hidden · private field" next to a Show
  button is 隐藏, a status after a value is short, and a label does not end in 的 ("仅显示有记录轨迹").
- Values set side by side are separated with 、 and a label before its value with ：, which `series()` and
  `labelled()` write. Never join a list with ", " in code.
- Every sentence ends with 。 in the messages. A page's summary of one sentence is shown without it, as a headline
  (the page drops it). A summary of several sentences keeps every 。.

## zh-TW

- Taiwan usage, written for Taiwan, not converted from zh-CN: 設定, 帳戶, 登入, 資料夾, 匯入, 檔案, 網路, 軟體, 連結.
- Address the user as `你`, never `您`.
- Full-width punctuation as in zh-CN. Quotation marks 「…」, nested 『…』.
- The same spacing as zh-CN: no typed space between Chinese and Latin letters, digits, arguments or tags.
- Units: `公里`, `英里`, `海里`. Durations: `{h}小時`, `{m}分鐘`, `{h}小時{m}分鐘`. The short form `{h}時{m}分`.
  Kept on one line as in zh-CN.
- Write what a Chinese interface would say, as in zh-CN.
- Full stops as in zh-CN: a one-sentence page summary is shown without its 。.

## Glossary

| English | de-DE | zh-CN | zh-TW |
|---|---|---|---|
| log (the user's whole log) | Logbuch | 日志 | 日誌 |
| record (one flight or sighting) | Eintrag | 记录 | 紀錄 |
| flight (one flown) | Flug, Flüge | 航班（个航班） | 航班（個航班） |
| sighting | Sichtung | 拍摄记录（条拍摄记录），a short label 拍摄 | 拍攝紀錄（筆拍攝紀錄），a short label 拍攝 |
| photographed, spotted (an aircraft) | fotografiert | 拍到 | 拍到 |
| spotting (the activity, the page) | Spotting | 拍摄 | 拍攝 |
| spotting session (logging a day's sightings at one place in one go) | Spotting-Session | 拍摄场次 | 拍攝場次 |
| days out (the days spent spotting, counted) | Spotting-Tage | 拍摄日 | 拍攝日 |
| aircraft (one airframe) | Flugzeug, Flugzeuge | 飞机（架） | 飛機（架） |
| registration | Kennzeichen | 注册号 | 註冊號 |
| aircraft type | Flugzeugtyp, Typ | 机型 | 機型 |
| type code | Typcode | 机型代码 | 機型代碼 |
| family (of types) | Familie | 系列 ("空客A320系列") | 系列 |
| airline, operator | Airline | 航空公司 | 航空公司 |
| operator, where it is set against airline ("Not an airline: saved as an operator") | Betreiber | 运营方 | 營運方 |
| operated by | durchgeführt von | 实际承运 | 實際營運 |
| livery | Lackierung | 涂装 | 塗裝 |
| special livery | Sonderlackierung | 特殊涂装 | 特殊塗裝 |
| airport | Flughafen | 机场 | 機場 |
| route | Strecke | 航线 | 航線 |
| recorded track | aufgezeichneter Flugweg | 轨迹, set against the great circle 实际轨迹, never 记录的轨迹 | 軌跡, set against the great circle 實際軌跡, never 記錄的軌跡 |
| track | Flugweg | 轨迹 | 軌跡 |
| great circle | Großkreis | 大圆航线 | 大圓航線 |
| gap (in a track) | Lücke | 中断 | 中斷 |
| distance | Entfernung | 距离 | 距離 |
| time in the air | Flugzeit | 飞行时间 | 飛行時間 |
| departure, arrival | Abflug, Ankunft | 出发, 到达 | 出發, 抵達 |
| takeoff, landing | Start, Landung | 起飞, 降落 | 起飛, 降落 |
| scheduled | planmäßig | 计划, a date that slipped 原定 | 表定 |
| planned flight (added before it flies), Planned | geplanter Flug, Geplant | 预订航班, a label 已预订 | 預訂航班, a label 已預訂 |
| to confirm (a planned flight whose time has passed) | zu bestätigen | 待确认 | 待確認 |
| Coming up (the next planned flights) | Demnächst | 即将出行 | 即將出發 |
| Remind me later | Später erinnern | 稍后提醒 | 稍後提醒 |
| stamp (earned for something done in the log, drawn as a passport stamp) | Stempel | 印章（枚） | 印章（枚） |
| earn, earned (a stamp) | erhalten, erhalten | 获得 | 獲得 |
| factory airfield (where a maker builds its aircraft) | Werksflugplatz | 工厂机场 | 工廠機場 |
| test registration (worn only before delivery) | Testkennzeichen | 试飞注册号 | 試飛註冊號 |
| diverted to | umgeleitet nach | 备降 | 轉降 |
| gate, terminal | Gate, Terminal | 登机口, 航站楼 | 登機門, 航廈 |
| seat | Sitzplatz | 座位 | 座位 |
| cabin (class) | Klasse | 舱位 | 艙等 |
| booking class | Buchungsklasse | 订座舱位 | 訂位艙等 |
| fare | Tarif | 票价类型 | 票價類型 |
| ticket number | Ticketnummer | 票号 | 票號 |
| booking reference | Buchungscode | 订座编号 | 訂位代號 |
| flight number | Flugnummer | 航班号 | 航班號碼 |
| phases: approaching, landing, taking off, taxiing, parked, towing, overflight | Anflug, Landung, Start, Rollen, Geparkt, Schleppen, Überflug | 进近, 降落, 起飞, 滑行, 停放, 拖曳, 飞越 | 進場, 降落, 起飛, 滑行, 停放, 拖曳, 飛越 |
| finding, issue | Hinweis | 问题 | 問題 |
| Issues (the page) | Hinweise | 问题 | 問題 |
| review (an import, a change) | prüfen, Prüfung | 检查 | 檢查 |
| inbox | Eingang | 收件箱 | 收件匣 |
| import, export | importieren, exportieren | 导入, 导出 | 匯入, 匯出 |
| backup | Sicherung | 备份 | 備份 |
| sync | synchronisieren, Synchronisierung | 同步 | 同步 |
| storage | Speicher | 存储空间 | 儲存空間 |
| directory | Ordner | 文件夹 | 資料夾 |
| file | Datei | 文件 | 檔案 |
| spreadsheet | Tabelle | 表格 | 試算表 |
| Google Drive | Google Drive | Google云端硬盘 | Google雲端硬碟 |
| this browser | dieser Browser | 此浏览器, in a sentence 这个浏览器 | 此瀏覽器, in a sentence 這個瀏覽器 |
| device | Gerät | 设备 | 裝置 |
| share link | Freigabelink | 分享链接 | 分享連結 |
| sign in, sign out | anmelden, abmelden | 登录, 退出登录 | 登入, 登出 |
| account | Konto | 账户 | 帳戶 |
| invite, member | einladen, Mitglied | 邀请, 成员 | 邀請, 成員 |
| suspend, reinstate (a member), suspended | sperren, entsperren, gesperrt | 暂停, 恢复, 已暂停 | 暫停, 恢復, 已暫停 |
| the site's owner, who invites people | Inhaber | 站长 | 站長 |
| the person who shared a link | Person, die den Link geteilt hat | 分享者 | 分享者 |
| settings | Einstellungen | 设置 | 設定 |
| Getting started | Erste Schritte | 入门指南 | 入門指南 |
| Home, Flights, Spotting, Aircraft, Statistics (navigation) | Start, Flüge, Spotting, Flugzeuge, Statistik | 首页, 航班, 拍摄, 飞机, 统计 | 首頁, 航班, 拍攝, 飛機, 統計 |
| custom view, saved view | eigene Ansicht, gespeicherte Ansicht | 自定义视图, 已保存的视图 | 自訂檢視, 已儲存的檢視 |
| period | Zeitraum | 时间段 | 期間 |
| Show all, Show fewer | Alle anzeigen, Weniger anzeigen | 显示全部, 收起 | 顯示全部, 收合 |
| Undo | Rückgängig | 撤销 | 復原 |
| click (a mouse), tap (a finger), worded for the pointer used (`{touch, select, …}`) | Klick, Tippen | 点击, 轻触 | 點選, 點一下 |
| This is right (accepting a finding) | Das stimmt | 确认无误 | 確認無誤 |
| route extension (distance beyond the great circle) | Streckenverlängerung | 航线绕行 | 繞航 |
| track (a direction in degrees, in a position's tooltip) | Kurs | 航向 | 航向 |
| modes: Standard, Private, Local | Standard, Privat, Lokal | 标准, 私密, 本地 | 標準, 私密, 本機 |
| agent (Claude Code or Codex checking an import) | Agent | AI助手 | AI助理 |
| command line | Befehlszeile | 命令行 | 命令列 |
| the web app (in the CLI's messages) | Web-App | 网页版 | 網頁版 |
| terminal | Terminal | 终端 | 終端機 |
