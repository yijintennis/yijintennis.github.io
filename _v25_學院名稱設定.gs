/***********************************************************************
 * v25：學院名稱改成可設定（白標）
 *
 * 為什麼要有這支：
 *   報告是「學院出給家長的文件」，上面只該有學院自己的名字。
 *   原本 Code.gs 有三處把 '奕晉網球學院' 寫死在 loadRecord 的回傳裡 ——
 *   表單上那格 Academy 名稱看起來能改，但存檔後重開歷史報告又會變回去，
 *   等於是「假的可編輯欄位」。
 *
 * 設計：
 *   一套系統服務一間學院，所以學院名是「系統設定」不是「每筆紀錄的欄位」。
 *   用 ScriptProperties 存，不必動 02 檢測紀錄的欄位結構（零風險）。
 *   好處：改名後所有歷史報告一起更新，不會有一半舊名一半新名。
 *   若未來真要一套系統跨多間學院，再改成存進 02 的獨立欄位。
 ***********************************************************************/

const ACADEMY_PROP_KEY = 'ACADEMY_NAME';
const ACADEMY_DEFAULT_ = '奕晉網球學院';

/** 目前的學院名稱（沒設定過就回預設） */
function academyName_() {
  try {
    return PropertiesService.getScriptProperties().getProperty(ACADEMY_PROP_KEY) || ACADEMY_DEFAULT_;
  } catch (e) {
    return ACADEMY_DEFAULT_;   // 權限或配額問題時不要讓整份報告掛掉
  }
}

/** 設定學院名稱；空字串忽略（避免表單沒填就把名字洗掉） */
function setAcademyName_(v) {
  const name = String(v == null ? '' : v).trim();
  if (!name || name === academyName_()) return;
  PropertiesService.getScriptProperties().setProperty(ACADEMY_PROP_KEY, name);
}

/* ── 以下兩支給人手動執行，方便不動程式碼就改名 ───────────────── */

/** 執行這支會跳出目前名稱 */
function showAcademyName() {
  const msg = '目前學院名稱：' + academyName_();
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return academyName_();
}

/** 改名：把下面這行的字改掉再執行 */
function setAcademyNameManually() {
  const NEW_NAME = '奕晉網球學院';        // ← 改這裡
  setAcademyName_(NEW_NAME);
  const msg = '已改為：' + academyName_() + '\n（所有報告即刻生效，不必重新部署）';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}
