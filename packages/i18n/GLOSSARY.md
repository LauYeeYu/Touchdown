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
- An apostrophe is `’` (U+2019). A plain `'` before `{`, `}`, `#` or `<` starts quoted text in the message syntax.
- Names stay as they are: Touchdown, Flightradar24, myFR24, OpenSky, adsbdb, adsb.lol, FlightAware, Flighty, Claude
  Code, Codex, IATA, ICAO, GPX, KML, CSV, JSON. Google Drive takes Google's own name in each language.
- Keep labels short: buttons, the choices of a setting and table headings sit in narrow places, on phones too.

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
| the site's owner, who invites people | Inhaber | 站长 | 站長 |
| the person who shared a link | Person, die den Link geteilt hat | 分享者 | 分享者 |
| settings | Einstellungen | 设置 | 設定 |
| Getting started | Erste Schritte | 入门指南 | 入門指南 |
| Home, Flights, Spotting, Aircraft, Statistics (navigation) | Start, Flüge, Spotting, Flugzeuge, Statistik | 首页, 航班, 拍摄, 飞机, 统计 | 首頁, 航班, 拍攝, 飛機, 統計 |
| custom view, saved view | eigene Ansicht, gespeicherte Ansicht | 自定义视图, 已保存的视图 | 自訂檢視, 已儲存的檢視 |
| period | Zeitraum | 时间段 | 期間 |
| Show all, Show fewer | Alle anzeigen, Weniger anzeigen | 显示全部, 收起 | 顯示全部, 收合 |
| Undo | Rückgängig | 撤销 | 復原 |
| This is right (accepting a finding) | Das stimmt | 确认无误 | 確認無誤 |
| route extension (distance beyond the great circle) | Streckenverlängerung | 航线绕行 | 繞航 |
| track (a direction in degrees, in a position's tooltip) | Kurs | 航向 | 航向 |
| modes: Standard, Private, Local | Standard, Privat, Lokal | 标准, 私密, 本地 | 標準, 私密, 本機 |
| agent (Claude Code or Codex checking an import) | Agent | AI助手 | AI助理 |
| command line | Befehlszeile | 命令行 | 命令列 |
