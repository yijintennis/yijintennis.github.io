/**
 * 奕晉體能排課台 — 排課與課表引擎（純函式，不碰網路）
 * ─────────────────────────────────────────────
 * 瀏覽器：<script src="engine.js"> → window.TrainEngine
 * Node 測試：require('./engine.js')
 *
 * 三件事：
 *   1. parseTennisText  把 Adam／網球教練打的備忘錄文字讀成網球課表
 *   2. schedule         依網球時間排體能時段（不撞課、人數上限、派教練）
 *   3. suggestSession   依最近練了什麼＋檢測弱項＋個人狀態，給重／中／輕三種課表
 */
(function (root) {
  'use strict';

  const CFG = {
    open: 8 * 60, close: 20 * 60,              // 場地可用 08:00–20:00
    groups: {
      '大隊': { dur: 90, cap: 12 },
      '小朋友': { dur: 60, cap: 8 }
    },
    breaks: [['12:00', '13:00']],             // 午休不排體能（可在 08 系統設定改）
    minPartial: 30,                           // 至少要有 30 分鐘才算「可以上半堂」
    staleDays: 120,                           // 檢測超過幾天算過期
    spike: 1.3                                // 近 7 天負荷 ÷ 前 4 週週平均 ≥ 1.3 → 負荷暴增
  };

  // ───────────────────────── 時間 ─────────────────────────
  const pad = n => String(n).padStart(2, '0');
  const fmt = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  function toMin(s) {
    const m = String(s || '').match(/^(\d{1,2})(?::(\d{2}))?$/);
    return m ? (+m[1]) * 60 + (+(m[2] || 0)) : NaN;
  }
  const overlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  function weekday(date) { const d = new Date(date + 'T00:00:00'); return WEEK[d.getDay()]; }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); }
  function addDays(date, n) { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function normDate(v) {
    const m = String(v || '').trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    return m ? m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]) : '';
  }

  // ───────────────────────── 名字對照 ─────────────────────────
  // 網球備忘錄常打簡體（刘珈妮、张迦宜），01 球員總表是繁體（劉珈妮、張迦宜）→ 比對前兩邊都轉成繁體
  // 對照表由 macOS 內建 Hans-Hant 轉換產生（U+4E00–9FFF 中會變的 2550 字）
  const S2T_RAW = '万萬与與丑醜专專业業丛叢东東丝絲丢丟两兩严嚴丧喪个個丰豐临臨为為丽麗举舉么麼义義乌烏乐樂乔喬习習乡鄉书書买買乱亂争爭于於亏虧云雲亘亙亚亞产產亩畝亲親亵褻亸嚲亿億仅僅仆僕从從仑侖仓倉仪儀们們价價众眾优優会會伛傴伞傘伟偉传傳伣俔伤傷伥倀伦倫伧傖伪偽伫佇体體佣傭佥僉侠俠侣侶侥僥侦偵侧側侨僑侩儈侪儕侬儂俣俁俦儔俨儼俩倆俪儷俫倈俭儉债債倾傾偬傯偻僂偾僨偿償傥儻傧儐储儲傩儺儿兒兑兌兖兗党黨兰蘭关關兴興兹茲养養兽獸冁囅内內冈岡册冊写寫军軍农農冯馮冲衝决決况況冻凍净淨凄淒凉涼减減凑湊凛凜几幾凤鳳凫鳧凭憑凯凱击擊凿鑿刍芻刘劉则則刚剛创創删刪别別刬剗刭剄刹剎刽劊刿劌剀剴剂劑剐剮剑劍剥剝剧劇劝勸办辦务務劢勱动動励勵劲勁劳勞势勢勋勳勚勩匀勻匦匭匮匱区區医醫华華协協单單卖賣占佔卢盧卤鹵卧臥卫衛却卻厂廠厅廳历歷厉厲压壓厌厭厍厙厐龎厕廁厘釐厢廂厣厴厦廈厨廚厩廄厮廝县縣叁叄参參叆靉叇靆双雙发發变變叙敘叠疊叶葉号號叹嘆叽嘰后後吓嚇吕呂吗嗎吣唚吨噸听聽启啓吴吳呐吶呒嘸呓囈呕嘔呖嚦呗唄员員呙咼呛嗆呜嗚咏詠咙嚨咛嚀咝噝咤吒响響哑啞哒噠哓嘵哔嗶哕噦哗嘩哙噲哜嚌哝噥哟喲唛嘜唝嗊唠嘮唡啢唢嗩唤喚啧嘖啬嗇啭囀啮嚙啰囉啴嘽啸嘯喂餵喷噴喽嘍喾嚳嗫囁嗳噯嘘噓嘤嚶嘱囑噜嚕嚣囂团團园園囱囪围圍囵圇国國图圖圆圓圣聖圹壙场場坂阪坏壞块塊坚堅坛壇坜壢坝壩坞塢坟墳坠墜垄壟垅壠垆壚垒壘垦墾垩堊垫墊垭埡垯墶垱壋垲塏垴堖埘塒埙塤埚堝埯垵堑塹堕墮塆壪墙牆壮壯声聲壳殼壶壺壸壼处處备備复復够夠头頭夸誇夹夾夺奪奁奩奂奐奋奮奖獎奥奧妆妝妇婦妈媽妩嫵妪嫗妫媯姗姍姹奼娄婁娅婭娆嬈娇嬌娈孌娱娛娲媧娴嫻婳嫿婴嬰婵嬋婶嬸媪媼媭嬃嫒嬡嫔嬪嫱嬙嬷嬤孙孫学學孪孿宁寧宝寶实實宠寵审審宪憲宫宮宽寬宾賓寝寢对對寻尋导導寿壽将將尔爾尘塵尝嘗尧堯尴尷尸屍尽盡层層屃屓屉屜届屆属屬屡屢屦屨屿嶼岁歲岂豈岖嶇岗崗岘峴岙嶴岚嵐岛島岭嶺岽崬岿巋峃嶨峄嶧峡峽峣嶢峤嶠峥崢峦巒崂嶗崃崍崄嶮崭嶄嵘嶸嵚嶔嵝嶁巅巔巩鞏巯巰币幣帅帥师師帏幃帐帳帘簾帜幟带帶帧幀帮幫帱幬帻幘帼幗幂冪干乾并並广廣庄莊庆慶庐廬庑廡库庫应應庙廟庞龐废廢庼廎廪廩开開异異弃棄弑弒张張弥彌弪弳弯彎弹彈强強归歸当當录錄彟彠彦彥彷徬彻徹征徵径徑徕徠忆憶忏懺忧憂忾愾怀懷态態怂慫怃憮怄慪怅悵怆愴怜憐总總怼懟怿懌恋戀恒恆恳懇恶惡恸慟恹懨恺愷恻惻恼惱恽惲悦悅悫愨悬懸悭慳悮悞悯憫惊驚惧懼惨慘惩懲惫憊惬愜惭慚惮憚惯慣愠慍愤憤愦憒愿願慑懾慭憖懑懣懒懶懔懍戆戇戋戔戏戲戗戧战戰戬戩戯戱户戶扑撲执執扩擴扪捫扫掃扬揚扰擾抚撫抛拋抟摶抠摳抡掄抢搶护護报報担擔拟擬拢攏拣揀拥擁拦攔拧擰拨撥择擇挂掛挚摯挛攣挜掗挝撾挞撻挟挾挠撓挡擋挢撟挣掙挤擠挥揮挦撏挽輓捝挩捞撈损損捡撿换換捣搗据據掳擄掴摑掷擲掸撣掺摻掼摜揽攬揾搵揿撳搀攙搁擱搂摟搅攪携攜摄攝摅攄摆擺摇搖摈擯摊攤撄攖撑撐撵攆撷擷撸擼撺攛擞擻攒攢敌敵敛斂敩斆数數斋齋斓斕斗鬥斩斬断斷无無旧舊时時旷曠旸暘昙曇昵暱昼晝昽曨显顯晋晉晒曬晓曉晔曄晕暈晖暉暂暫暧曖术術朴樸机機杀殺杂雜权權杆桿杠槓条條来來杨楊杩榪杰傑极極构構枞樅枢樞枣棗枥櫪枧梘枨棖枪槍枫楓枭梟柜櫃柠檸柽檉栀梔栅柵标標栈棧栉櫛栊櫳栋棟栌櫨栎櫟栏欄树樹栖棲样樣栾欒桠椏桡橈桢楨档檔桤榿桥橋桦樺桧檜桨槳桩樁梦夢梼檮梾棶梿槤检檢棁梲棂櫺棱稜椁槨椟櫝椠槧椤欏椭橢楼樓榄欖榅榲榇櫬榈櫚榉櫸槚檟槛檻槟檳槠櫧横橫樯檣樱櫻橥櫫橱櫥橹櫓橼櫞檩檁欢歡欤歟欧歐歼殲殁歿殇殤残殘殒殞殓殮殚殫殡殯殴毆毁毀毂轂毕畢毙斃毡氈毵毿氇氌气氣氢氫氩氬氲氳汇匯汉漢汤湯汹洶沉沈沟溝没沒沣灃沤漚沥瀝沦淪沧滄沨渢沩溈沪滬泄洩泞濘泪淚泶澩泷瀧泸瀘泺濼泻瀉泼潑泽澤泾涇洁潔洒灑洼窪浃浹浅淺浆漿浇澆浈湞浉溮浊濁测測浍澮济濟浏瀏浐滻浑渾浒滸浓濃浔潯浕濜涂塗涌湧涛濤涝澇涞淶涟漣涠潿涡渦涢溳涣渙涤滌润潤涧澗涨漲涩澀淀澱渊淵渌淥渍漬渎瀆渐漸渑澠渔漁渖瀋渗滲温溫湾灣湿濕溁濚溃潰溅濺溆漵溇漊滗潷滚滾滞滯滟灧滠灄满滿滢瀅滤濾滥濫滦灤滨濱滩灘滪澦漓灕漤灠潆瀠潇瀟潋瀲潍濰潜潛潴瀦澛瀂澜瀾濑瀨濒瀕灏灝灭滅灯燈灵靈灾災灿燦炀煬炉爐炖燉炜煒炝熗点點炼煉炽熾烁爍烂爛烃烴烛燭烟煙烦煩烧燒烨燁烩燴烫燙烬燼热熱焕煥焖燜焘燾煴熅爱愛爷爺牍牘牦氂牵牽牺犧犊犢状狀犷獷犸獁犹猶狈狽狝獮狞獰独獨狭狹狮獅狯獪狰猙狱獄狲猻猃獫猎獵猕獼猡玀猪豬猫貓猬蝟献獻獭獺玑璣玙璵玚瑒玛瑪玮瑋环環现現玱瑲玺璽珐琺珑瓏珰璫珲琿琎璡琏璉琐瑣琼瓊瑶瑤瑷璦璎瓔瓒瓚瓮甕瓯甌电電画畫畅暢畴疇疖癤疗療疟瘧疠癘疡瘍疬癧疭瘲疮瘡疯瘋疱皰疴痾痈癰痉痙痒癢痖瘂痨癆痪瘓痫癇瘅癉瘆瘮瘗瘞瘘瘻瘪癟瘫癱瘾癮瘿癭癞癩癣癬癫癲皑皚皱皺皲皸盏盞盐鹽监監盖蓋盗盜盘盤眍瞘眦眥眬矓着著睁睜睐睞睑瞼睾睪瞆瞶瞒瞞瞩矚矫矯矶磯矾礬矿礦砀碭码碼砖磚砗硨砚硯砜碸砺礪砻礱砾礫础礎硁硜硕碩硖硤硗磽硙磑硚礄确確硷礆碍礙碛磧碜磣碱鹼礴礡礼禮祃禡祎禕祢禰祯禎祷禱祸禍禀稟禄祿禅禪离離秃禿秆稈种種积積称稱秽穢秾穠稆穭税稅稣穌稳穩穑穡穷窮窃竊窍竅窎窵窑窯窜竄窝窩窥窺窦竇窭窶竖竪竞競笃篤笋筍笔筆笕筧笺箋笼籠笾籩筑築筚篳筛篩筜簹筝箏筹籌筼篔签簽简簡箓籙箦簀箧篋箨籜箩籮箪簞箫簫篑簣篓簍篮籃篯籛篱籬簖籪籁籟籴糴类類籼秈粜糶粝糲粤粵粪糞粮糧糁糝糇餱紧緊絷縶纟糹纠糾纡紆红紅纣紂纤纖纥紇约約级級纨紈纩纊纪紀纫紉纬緯纭紜纮紘纯純纰紕纱紗纲綱纳納纴紝纵縱纶綸纷紛纸紙纹紋纺紡纻紵纼紖纽紐纾紓线線绀紺绁紲绂紱练練组組绅紳细細织織终終绉縐绊絆绋紼绌絀绍紹绎繹经經绐紿绑綁绒絨结結绔絝绕繞绖絰绗絎绘繪给給绚絢绛絳络絡绝絕绞絞统統绠綆绡綃绢絹绣繡绤綌绥綏绦縧继繼绨綈绩績绪緒绫綾绬緓续續绮綺绯緋绰綽绱緔绲緄绳繩维維绵綿绶綬绷繃绸綢绹綯绺綹绻綣综綜绽綻绾綰绿綠缀綴缁緇缂緙缃緗缄緘缅緬缆纜缇緹缈緲缉緝缊縕缋繢缌緦缍綞缎緞缏緶缐線缑緱缒縋缓緩缔締缕縷编編缗緡缘緣缙縉缚縛缛縟缜縝缝縫缞縗缟縞缠纏缡縭缢縊缣縑缤繽缥縹缦縵缧縲缨纓缩縮缪繆缫繅缬纈缭繚缮繕缯繒缰繮缱繾缲繰缳繯缴繳缵纘罂罌网網罗羅罚罰罢罷罴羆羁羈羟羥羡羨翘翹翙翽翚翬耢耮耧耬耸聳耻恥聂聶聋聾职職聍聹联聯聩聵聪聰肃肅肠腸肤膚肮骯肾腎肿腫胀脹胁脅胆膽胜勝胧朧胨腖胪臚胫脛胶膠脉脈脍膾脏髒脐臍脑腦脓膿脔臠脚腳脱脫脶腡脸臉腊臘腌醃腘膕腭齶腻膩腽膃腾騰膑臏膻羶臜臢舆輿舍捨舣艤舰艦舱艙舻艫艰艱艳艷艺藝节節芈羋芗薌芜蕪芦蘆苁蓯苇葦苈藶苋莧苌萇苍蒼苎苧苏蘇苧薴苹蘋范範茎莖茏蘢茑蔦茔塋茕煢茧繭荆荊荐薦荙薘荚莢荛蕘荜蓽荞蕎荟薈荠薺荡蕩荣榮荤葷荥滎荦犖荧熒荨蕁荩藎荪蓀荫蔭荬蕒荭葒荮葤药藥莅蒞莱萊莲蓮莳蒔莴萵莶薟获獲莸蕕莹瑩莺鶯莼蒓萚蘀萝蘿萤螢营營萦縈萧蕭萨薩葱蔥蒇蕆蒉蕢蒋蔣蒌蔞蓝藍蓟薊蓠蘺蓣蕷蓥鎣蓦驀蔂虆蔷薔蔹蘞蔺藺蔼藹蕰薀蕲蘄蕴蘊薮藪藓蘚蘖櫱虏虜虑慮虚虛虫蟲虬虯虮蟣虱蝨虽雖虾蝦虿蠆蚀蝕蚁蟻蚂螞蚕蠶蚝蠔蚬蜆蛊蠱蛎蠣蛏蟶蛮蠻蛰蟄蛱蛺蛲蟯蛳螄蛴蠐蜕蛻蜗蝸蜡蠟蝇蠅蝈蟈蝉蟬蝎蠍蝼螻蝾蠑螀螿螨蟎蟏蠨衅釁衔銜补補衬襯衮袞袄襖袅裊袆褘袜襪袭襲袯襏装裝裆襠裈褌裢褳裣襝裤褲裥襇褛褸褴襤襕襴见見观觀觃覎规規觅覓视視觇覘览覽觉覺觊覬觋覡觌覿觍覥觎覦觏覯觐覲觑覷觞觴触觸觯觶訚誾詟讋誉譽誊謄讠訁计計订訂讣訃认認讥譏讦訐讧訌讨討让讓讪訕讫訖讬託训訓议議讯訊记記讱訒讲講讳諱讴謳讵詎讶訝讷訥许許讹訛论論讻訩讼訟讽諷设設访訪诀訣证證诂詁诃訶评評诅詛识識诇詗诈詐诉訴诊診诋詆诌謅词詞诎詘诏詔诐詖译譯诒詒诓誆诔誄试試诖詿诗詩诘詰诙詼诚誠诛誅诜詵话話诞誕诟詬诠詮诡詭询詢诣詣诤諍该該详詳诧詫诨諢诩詡诪譸诫誡诬誣语語诮誚误誤诰誥诱誘诲誨诳誑说說诵誦诶誒请請诸諸诹諏诺諾读讀诼諑诽誹课課诿諉谀諛谁誰谂諗调調谄諂谅諒谆諄谇誶谈談谊誼谋謀谌諶谍諜谎謊谏諫谐諧谑謔谒謁谓謂谔諤谕諭谖諼谗讒谘諮谙諳谚諺谛諦谜謎谝諞谞諝谟謨谠讜谡謖谢謝谣謠谤謗谥謚谦謙谧謐谨謹谩謾谪謫谫謭谬謬谭譚谮譖谯譙谰讕谱譜谲譎谳讞谴譴谵譫谶讖豮豶贝貝贞貞负負贠貟贡貢财財责責贤賢败敗账賬货貨质質贩販贪貪贫貧贬貶购購贮貯贯貫贰貳贱賤贲賁贳貰贴貼贵貴贶貺贷貸贸貿费費贺賀贻貽贼賊贽贄贾賈贿賄赀貲赁賃赂賂赃贓资資赅賅赆贐赇賕赈賑赉賚赊賒赋賦赌賭赍賫赎贖赏賞赐賜赑贔赒賙赓賡赔賠赕賧赖賴赗賵赘贅赙賻赚賺赛賽赜賾赝贋赞贊赟贇赠贈赡贍赢贏赣贛赪赬赵趙赶趕趋趨趱趲趸躉跃躍跄蹌跞躒践踐跶躂跷蹺跸蹕跹躚跻躋踊踴踌躊踪蹤踬躓踯躑蹑躡蹒蹣蹰躕蹿躥躏躪躜躦躯軀车車轧軋轨軌轩軒轪軑轫軔转轉轭軛轮輪软軟轰轟轱軲轲軻轳轤轴軸轵軹轶軼轷軤轸軫轹轢轺軺轻輕轼軾载載轾輊轿轎辀輈辁輇辂輅较較辄輒辅輔辆輛辇輦辈輩辉輝辊輥辋輞辌輬辍輟辎輜辏輳辐輻辑輯辒轀输輸辔轡辕轅辖轄辗輾辘轆辙轍辚轔辞辭辩辯辫辮边邊辽遼达達迁遷过過迈邁运運还還这這进進远遠违違连連迟遲迩邇迳逕迹跡适適选選逊遜递遞逦邐逻邏遗遺遥遙邓鄧邝鄺邬鄔邮郵邹鄒邺鄴邻鄰郏郟郐鄶郑鄭郓鄆郦酈郧鄖郸鄲酂酇酝醖酦醱酱醬酽釅酾釃酿釀采採释釋鉴鑒銮鑾錾鏨钅釒钆釓钇釔针針钉釘钊釗钋釙钌釕钍釷钎釺钏釧钐釤钑鈒钒釩钓釣钔鍆钕釹钖鍚钗釵钘鈃钙鈣钚鈈钛鈦钜鉅钝鈍钞鈔钟鐘钠鈉钡鋇钢鋼钣鈑钤鈐钥鑰钦欽钧鈞钨鎢钩鈎钪鈧钫鈁钬鈥钭鈄钮鈕钯鈀钰鈺钱錢钲鉦钳鉗钴鈷钵鉢钶鈳钷鉕钸鈽钹鈸钺鉞钻鑽钼鉬钽鉭钾鉀钿鈿铀鈾铁鐵铂鉑铃鈴铄鑠铅鉛铆鉚铇鉋铈鈰铉鉉铊鉈铋鉍铌鈮铍鈹铎鐸铏鉶铐銬铑銠铒鉺铓鋩铔錏铕銪铖鋮铗鋏铘鋣铙鐃铚銍铛鐺铜銅铝鋁铞銱铟銦铠鎧铡鍘铢銖铣銑铤鋌铥銩铦銛铧鏵铨銓铩鎩铪鉿铫銚铬鉻铭銘铮錚铯銫铰鉸铱銥铲鏟铳銃铴鐋铵銨银銀铷銣铸鑄铹鐒铺鋪铻鋙铼錸铽鋱链鏈铿鏗销銷锁鎖锂鋰锃鋥锄鋤锅鍋锆鋯锇鋨锈鏽锉銼锊鋝锋鋒锌鋅锍鋶锎鐦锏鐧锐銳锑銻锒鋃锓鋟锔鋦锕錒锖錆锗鍺锘鍩错錯锚錨锛錛锜錡锝鍀锞錁锟錕锠錩锡錫锢錮锣鑼锤錘锥錐锦錦锧鑕锨鍁锩錈锪鍃锫錇锬錟锭錠键鍵锯鋸锰錳锱錙锲鍥锳鍈锴鍇锵鏘锶鍶锷鍔锸鍤锹鍬锺鍾锻鍛锼鎪锽鍠锾鍰锿鎄镀鍍镁鎂镂鏤镃鎡镄鐨镅鎇镆鏌镇鎮镈鎛镉鎘镊鑷镋鎲镌鐫镍鎳镎鎿镏鎦镐鎬镑鎊镒鎰镓鎵镔鑌镕鎔镖鏢镗鏜镘鏝镙鏍镚鏰镛鏞镜鏡镝鏑镞鏃镟鏇镠鏐镡鐔镢鐝镣鐐镤鏷镥鑥镦鐓镧鑭镨鐠镩鑹镪鏹镫鐙镬鑊镭鐳镮鐶镯鐲镰鐮镱鐿镲鑔镳鑣镴鑞镵鑱镶鑲长長门門闩閂闪閃闫閆闬閈闭閉问問闯闖闰閏闱闈闲閒闳閎间間闵閔闶閌闷悶闸閘闹鬧闺閨闻聞闼闥闽閩闾閭闿闓阀閥阁閣阂閡阃閫阄鬮阅閱阆閬阇闍阈閾阉閹阊閶阋鬩阌閿阍閽阎閻阏閼阐闡阑闌阒闃阓闠阔闊阕闋阖闔阗闐阘闒阙闕阚闞阛闤队隊阳陽阴陰阵陣阶階际際陆陸陇隴陈陳陉陘陕陝陧隉陨隕险險随隨隐隱隶隸隽雋难難雏雛雠讎雳靂雾霧霁霽霡霢霭靄靓靚静靜靥靨鞑韃鞒鞽鞯韉韦韋韧韌韨韍韩韓韪韙韫韞韬韜韵韻页頁顶頂顷頃顸頇项項顺順须須顼頊顽頑顾顧顿頓颀頎颁頒颂頌颃頏预預颅顱领領颇頗颈頸颉頡颊頰颋頲颌頜颍潁颎熲颏頦颐頤频頻颒頮颓頹颔頷颕頴颖穎颗顆题題颙顒颚顎颛顓颜顏额額颞顳颟顢颠顛颡顙颢顥颤顫颥顬颦顰颧顴风風飏颺飐颭飑颮飒颯飓颶飔颸飕颼飖颻飗飀飘飄飙飆飚飈飞飛飨饗餍饜饣飠饤飣饥飢饦飥饧餳饨飩饩餼饪飪饫飫饬飭饭飯饮飲饯餞饰飾饱飽饲飼饳飿饴飴饵餌饶饒饷餉饸餄饹餎饺餃饻餏饼餅饽餑饾餖饿餓馀餘馁餒馂餕馃餜馄餛馅餡馆館馇餷馈饋馉餶馊餿馋饞馌饁馍饃馎餺馏餾馐饈馑饉馒饅馓饊馔饌馕饢马馬驭馭驮馱驯馴驰馳驱驅驲馹驳駁驴驢驵駔驶駛驷駟驸駙驹駒驺騶驻駐驼駝驽駑驾駕驿驛骀駘骁驍骂罵骃駰骄驕骅驊骆駱骇駭骈駢骉驫骊驪骋騁验驗骍騂骎駸骏駿骐騏骑騎骒騍骓騅骔騌骕驌骖驂骗騙骘騭骙騤骚騷骛騖骜驁骝騮骞騫骟騸骠驃骡騾骢驄骣驏骤驟骥驥骦驦骧驤髅髏髋髖髌髕鬓鬢鬶鬹魇魘魉魎鱼魚鱽魛鱾魢鱿魷鲀魨鲁魯鲂魴鲃䰾鲄魺鲅鮁鲆鮃鲇鮎鲈鱸鲉鮋鲊鮓鲋鮒鲌鮊鲍鮑鲎鱟鲏鮍鲐鮐鲑鮭鲒鮚鲓鮳鲔鮪鲕鮞鲖鮦鲗鰂鲘鮜鲙鱠鲚鱭鲛鮫鲜鮮鲝鮺鲞鮝鲟鱘鲠鯁鲡鱺鲢鰱鲣鰹鲤鯉鲥鰣鲦鰷鲧鯀鲨鯊鲩鯇鲪鮶鲫鯽鲬鯒鲭鯖鲮鯪鲯鯕鲰鯫鲱鯡鲲鯤鲳鯧鲴鯝鲵鯢鲶鯰鲷鯛鲸鯨鲹鰺鲺鯴鲻鯔鲼鱝鲽鰈鲾鰏鲿鱨鳀鯷鳁鰮鳂鰃鳃鰓鳄鰐鳅鰍鳆鰒鳇鰉鳈鰁鳉鱂鳊鯿鳋鰠鳌鰲鳍鰭鳎鰨鳏鰥鳐鰩鳑鰟鳒鰜鳓鰳鳔鰾鳕鱈鳖鱉鳗鰻鳘鰵鳙鱅鳚䲁鳛鰼鳜鱖鳝鱔鳞鱗鳟鱒鳠鱯鳡鱤鳢鱧鳣鱣鳤䲘鸟鳥鸠鳩鸡雞鸢鳶鸣鳴鸤鳲鸥鷗鸦鴉鸧鶬鸨鴇鸩鴆鸪鴣鸫鶇鸬鸕鸭鴨鸮鴞鸯鴦鸰鴒鸱鴟鸲鴝鸳鴛鸴鷽鸵鴕鸶鷥鸷鷙鸸鴯鸹鴰鸺鵂鸻鴴鸼鵃鸽鴿鸾鸞鸿鴻鹀鵐鹁鵓鹂鸝鹃鵑鹄鵠鹅鵝鹆鵒鹇鷳鹈鵜鹉鵡鹊鵲鹋鶓鹌鵪鹍鵾鹎鵯鹏鵬鹐鵮鹑鶉鹒鶊鹓鵷鹔鷫鹕鶘鹖鶡鹗鶚鹘鶻鹙鶖鹚鷀鹛鶥鹜鶩鹝鷊鹞鷂鹟鶲鹠鶹鹡鶺鹢鷁鹣鶼鹤鶴鹥鷖鹦鸚鹧鷓鹨鷚鹩鷯鹪鷦鹫鷲鹬鷸鹭鷺鹮䴉鹯鸇鹰鷹鹱鸌鹲鸏鹳鸛鹴鸘鹾鹺麦麥麸麩麹麴黄黃黉黌黡黶黩黷黪黲黾黽鼋黿鼍鼉鼗鞀鼹鼴齐齊齑齏齿齒龀齔龁齕龂齗龃齟龄齡龅齙龆齠龇齜龈齦龉齬龊齪龋齲龌齷龙龍龚龔龛龕龟龜鿎䃮鿏䥑鿔鎶鿭鉨';
  const S2T = {};
  for (let i = 0; i < S2T_RAW.length; i += 2) S2T[S2T_RAW[i]] = S2T_RAW[i + 1];
  function nameKey(s) { return String(s || '').trim().replace(/[\u3400-\u9fff]/g, c => S2T[c] || c).toLowerCase(); }

  /** roster: [{name, alias:'祐仁,孙祐仁', ...}] → 查表（繁體＋小寫）
   *  另外：只打名字不打姓（祐仁）而且全隊只有一個人叫這名字 → 也對得到 */
  function nameIndex(roster) {
    const idx = {}, given = {};
    (roster || []).forEach(p => {
      [p.name].concat(String(p.alias || '').split(/[,，、;；]+/)).forEach(a => {
        a = String(a || '').trim();
        if (a) idx[nameKey(a)] = p.name;
      });
      const k = nameKey(p.name);
      if (/^[\u3400-\u9fff]{3}$/.test(k)) (given[k.slice(1)] = given[k.slice(1)] || new Set()).add(p.name);
    });
    Object.keys(given).forEach(g => { if (given[g].size === 1 && !idx[g]) idx[g] = [...given[g]][0]; });
    return idx;
  }

  // ───────────────────────── 1. 讀網球備忘錄 ─────────────────────────
  function convHour(h) { return h >= 1 && h <= 7 ? h + 12 : h; }   // 1-3 → 13-15；7-8 → 19-20

  /**
   * text：Adam 的備忘錄（第一行可有日期）
   * opts.roster：體能名單；opts.coachCodes：網球教練在備忘錄上的稱呼（賴、鄭、javed…）
   * 回 { entries:[{start,end,coaches[],players[],raw}], bad:[原文] }
   */
  function parseTennisText(text, opts) {
    opts = opts || {};
    const idx = nameIndex(opts.roster);
    const codes = (opts.coachCodes || []).map(String).filter(Boolean).sort((a, b) => b.length - a.length);
    const codeSet = new Set(codes.map(c => nameKey(c)));
    const dict = Object.keys(idx).filter(k => k.length >= 2 && /^[\u3400-\u9fff]+$/.test(k)).sort((a, b) => b.length - a.length);
    const entries = [], bad = [];

    function splitToken(tok) {
      const low = nameKey(tok);
      if (codeSet.has(low)) return [{ coach: tok }];
      if (idx[low]) return [{ name: tok }];
      // 尾巴黏著教練（齐天乐石、孫祐仁賴、小白鄭）
      for (const c of codes) {
        if (low.length > c.length && low.endsWith(nameKey(c))) {
          const rest = tok.slice(0, tok.length - c.length);
          return splitToken(rest).concat([{ coach: c }]);
        }
      }
      // 英文名不切（leonard 不是 Leon）
      if (!/^[\u3400-\u9fff]+$/.test(tok)) return [{ name: tok }];
      // 「李一凡女」＝另一個也叫李一凡的女生：整個當一個名字，不切成 李一凡＋女
      if (/[女男]$/.test(tok) && idx[nameKey(tok.slice(0, -1))]) return [{ name: tok }];
      // 兩個中文名字黏在一起（刘珈妮莫可妍）：用名單裡的名字切
      const out = []; let buf = '', i = 0;
      while (i < tok.length) {
        const hit = dict.find(w => nameKey(tok.substr(i, w.length)) === w);
        if (hit) { if (buf) { out.push({ name: buf }); buf = ''; } out.push({ name: tok.substr(i, hit.length) }); i += hit.length; }
        else { buf += tok[i]; i++; }
      }
      if (buf) out.push({ name: buf });
      return out;
    }

    String(text || '').split(/\r?\n/).forEach(line => {
      const raw = line.trim();
      if (!raw) return;
      const m = raw.match(/^(\d{1,2})(?:[:：](\d{2}))?\s*[-–~～]\s*(\d{1,2})(?:[:：](\d{2}))?\s*[:：]?\s*(.*)$/);
      if (!m) { if (!/^\d{1,2}\/\d{1,2}/.test(raw)) bad.push(raw); return; }
      let s = convHour(+m[1]) * 60 + (+(m[2] || 0));
      let e = convHour(+m[3]) * 60 + (+(m[4] || 0));
      if (e <= s) e += 12 * 60;
      const players = [], coaches = [];
      m[5].split(/[\s,，、]+/).filter(Boolean).forEach(tok => {
        splitToken(tok).forEach(x => {
          if (x.coach) coaches.push(x.coach);
          else if (x.name) players.push(idx[nameKey(x.name)] || x.name);
        });
      });
      if (!players.length) { bad.push(raw); return; }
      entries.push({ start: fmt(s), end: fmt(e), coaches, players, raw });
    });
    return { entries, bad };
  }

  // ───────────────────────── 2. 排時段 ─────────────────────────
  /**
   * input = {
   *   date, roster:[{name, group:'大隊'|'小朋友', level, earliest, latest, status, team}],
   *   tennis:[{start,end,players[]}], leave:[name], coaches:[{name,type:'體能',group}],
   *   locked:[{start, group, players[], coaches[]}]  // 教練手動加的課，保留不動
   * }
   * 回 { slots:[...], unplaced:[{name, reason}], notInRoster:[name] }
   */
  function schedule(input, cfg) {
    cfg = Object.assign({}, CFG, cfg || {});
    const roster = input.roster || [];
    const byName = {}; roster.forEach(p => byName[p.name] = p);
    const leave = new Set(input.leave || []);
    const busy = {}; const notInRoster = new Set();
    (input.tennis || []).forEach(t => (t.players || []).forEach(n => {
      if (!byName[n]) { notInRoster.add(n); return; }
      (busy[n] = busy[n] || []).push([toMin(t.start), toMin(t.end)]);
    }));

    const locked = (input.locked || []).map(l => Object.assign({ manual: true }, l));
    const lockedNames = new Set(); locked.forEach(l => (l.players || []).forEach(n => lockedNames.add(n)));

    // 誰今天要排：在訓＋今天有網球＋沒請假＋沒被手動排走
    const todo = roster.filter(p => p.status !== '暫停' && busy[p.name] && !leave.has(p.name) && !lockedNames.has(p.name));

    function info(p) {
      const g = cfg.groups[p.group] || cfg.groups['小朋友'];
      const lo = Math.max(cfg.open, isNaN(toMin(p.earliest)) ? 0 : toMin(p.earliest));
      const hi = Math.min(cfg.close, isNaN(toMin(p.latest)) ? 24 * 60 : toMin(p.latest));
      const tb = (busy[p.name] || []).slice().sort((x, y) => x[0] - y[0]);
      const brk = (cfg.breaks || []).map(x => [toMin(x[0]), toMin(x[1])]);
      const b = tb.concat(brk).sort((x, y) => x[0] - y[0]);       // 網球＋午休都算「不能排」
      const free = t => t >= lo && t + g.dur <= hi && !b.some(x => overlap(t, t + g.dur, x[0], x[1]));
      const cand = {};
      tb.forEach(x => {
        const tA = x[1], tB = x[0] - g.dur;
        if (free(tA)) cand[tA] = '網球 ' + fmt(x[0]) + '–' + fmt(x[1]) + ' 之後接著練';
        if (free(tB)) cand[tB] = '網球 ' + fmt(x[0]) + ' 之前';
      });
      // 沒有完整空檔 → 找最長的相鄰空檔（半堂）
      let partial = null;
      if (!Object.keys(cand).length) {
        b.forEach((x, i) => {
          if (!tb.includes(x)) return;   // 只找網球前後的空檔
          const nextS = i + 1 < b.length ? b[i + 1][0] : hi;
          const prevE = i > 0 ? b[i - 1][1] : lo;
          const after = Math.min(nextS, hi) - x[1];
          const before = x[0] - Math.max(prevE, lo);
          if (after >= cfg.minPartial && (!partial || after > partial.min)) partial = { start: x[1], min: after, why: '網球 ' + fmt(x[1]) + ' 下課到下一堂只有 ' + after + ' 分鐘' };
          if (before >= cfg.minPartial && (!partial || before > partial.min)) partial = { start: x[0] - before, min: before, why: '網球 ' + fmt(x[0]) + ' 前只有 ' + before + ' 分鐘空檔' };
        });
      }
      return { p, g, cand, partial, busy: b };
    }

    const slots = locked.slice();
    const unplaced = [];
    Object.keys(cfg.groups).forEach(group => {
      const g = cfg.groups[group];
      let left = todo.filter(p => (cfg.groups[p.group] ? p.group : '小朋友') === group).map(info);
      // 同一時間最多開幾堂＝這組有幾位體能教練（沒設定教練就不限）
      const nCoach = (input.coaches || []).filter(c => c.type === '體能' && c.group === group).length || 99;
      const open = t => slots.filter(s => s.group === group && overlap(t, t + g.dur, toMin(s.start), toMin(s.end))).length < nCoach;
      while (true) {
        const count = {};
        left.forEach(x => Object.keys(x.cand).forEach(t => count[t] = (count[t] || 0) + 1));
        const times = Object.keys(count).map(Number).filter(open);
        if (!times.length) break;
        times.sort((a, b) => (Math.min(count[b], g.cap) - Math.min(count[a], g.cap)) || (a - b));
        const t = times[0];
        let who = left.filter(x => x.cand[t] !== undefined);
        who.sort((a, b) => Object.keys(a.cand).length - Object.keys(b.cand).length);   // 選擇少的人先上
        who = who.slice(0, g.cap);
        slots.push({ start: fmt(t), end: fmt(t + g.dur), group, players: who.map(x => x.p.name),
          why: Object.fromEntries(who.map(x => [x.p.name, x.cand[t]])), partial: {} });
        const taken = new Set(who.map(x => x.p.name));
        left = left.filter(x => !taken.has(x.p.name));
      }
      // 同一時間開了兩堂以上 → 人數平均分
      const bucket = {};
      slots.filter(s => s.group === group && !s.manual).forEach(s => (bucket[s.start] = bucket[s.start] || []).push(s));
      Object.values(bucket).filter(a => a.length > 1).forEach(a => {
        const all = [].concat(...a.map(s => s.players));
        a.forEach(s => s.players = []);
        all.forEach((n, i) => a[i % a.length].players.push(n));
      });
      // 剩下的：能上半堂就併進同時間的課或開一堂；不行就列為排不進
      left.forEach(x => {
        if (x.partial) {
          const st = x.partial.start;
          let s = slots.find(s => s.group === group && toMin(s.start) <= st && st < toMin(s.end) && s.players.length < g.cap);
          if (!s) { s = { start: fmt(st), end: fmt(st + g.dur), group, players: [], why: {}, partial: {} }; slots.push(s); }
          s.players.push(x.p.name);
          s.why[x.p.name] = x.partial.why;
          s.partial[x.p.name] = Math.min(x.partial.min, toMin(s.end) - st);
        } else {
          unplaced.push({ name: x.p.name, reason: '網球前後都沒有 ' + cfg.minPartial + ' 分鐘以上的空檔' });
        }
      });
    });

    slots.sort((a, b) => toMin(a.start) - toMin(b.start) || a.group.localeCompare(b.group));
    assignCoaches(slots, input.coaches || [], byName, cfg);
    slots.forEach((s, i) => {
      s.id = s.id || ('S' + (i + 1));
      const flags = [];
      if (Object.keys(s.partial || {}).length) flags.push('有人只能上半堂');
      if (s.coachShort) flags.push('教練不夠');
      if (s.players.length > (cfg.groups[s.group] || { cap: 99 }).cap) flags.push('超過人數上限');
      s.flags = flags;
      s.status = flags.length ? (flags.includes('超過人數上限') ? 'bad' : 'warn') : 'ok';
    });
    return { slots, unplaced, notInRoster: Array.from(notInRoster) };
  }

  function levelOf(p) { return p && p.level ? p.level : ''; }

  function assignCoaches(slots, coaches, byName, cfg) {
    const used = {};   // name → [[s,e]]
    const minutes = {};
    slots.forEach(s => {
      const S = toMin(s.start), E = toMin(s.end);
      const g = cfg.groups[s.group] || { cap: 8 };
      const lv = new Set(s.players.map(n => levelOf(byName[n])).filter(Boolean));
      s.needTwo = lv.has('高') && lv.has('低');
      s.needTwoWhy = s.needTwo ? '程度高低都有' : '';
      if (s.manual && s.coaches && s.coaches.length) { s.coaches.forEach(c => (used[c] = used[c] || []).push([S, E])); s._fixed = true; return; }
      s.coaches = [];
    });
    function pick(s) {
      const S = toMin(s.start), E = toMin(s.end);
      const c = coaches.filter(c => c.type === '體能' && c.group === s.group && !s.coaches.includes(c.name))
        .filter(c => !(used[c.name] || []).some(x => overlap(S, E, x[0], x[1])))
        .sort((a, b) => (minutes[a.name] || 0) - (minutes[b.name] || 0))[0];
      if (!c) return false;
      s.coaches.push(c.name); (used[c.name] = used[c.name] || []).push([S, E]); minutes[c.name] = (minutes[c.name] || 0) + (E - S);
      return true;
    }
    // 先每堂一位，再補第二位給程度落差大的
    slots.forEach(s => { if (!s._fixed) s.coachShort = !pick(s); });
    slots.forEach(s => { if (!s._fixed && s.needTwo && !s.coachShort) s.coachShort = !pick(s); delete s._fixed; });
  }

  /** 檢查教練手動拖拉後的版本（不重排，只重算燈號） */
  function recheck(slots, input, cfg) {
    cfg = Object.assign({}, CFG, cfg || {});
    const byName = {}; (input.roster || []).forEach(p => byName[p.name] = p);
    const busy = {};
    (input.tennis || []).forEach(t => (t.players || []).forEach(n => (busy[n] = busy[n] || []).push([toMin(t.start), toMin(t.end), t.start + '–' + t.end])));
    slots.forEach(s => {
      const S = toMin(s.start), E = toMin(s.end);
      s.partial = {}; s.clash = {};
      s.players.forEach(n => {
        const hit = (busy[n] || []).filter(x => overlap(S, E, x[0], x[1]));
        if (!hit.length) return;
        const firstClash = Math.min.apply(null, hit.map(x => x[0]));
        if (firstClash > S) s.partial[n] = firstClash - S;
        else s.clash[n] = '撞到網球 ' + hit[0][2];
      });
      const g = cfg.groups[s.group] || { cap: 99 };
      const flags = [];
      if (Object.keys(s.clash).length) flags.push('撞到網球');
      if (s.players.length > g.cap) flags.push('超過人數上限');
      if (Object.keys(s.partial).length) flags.push('有人只能上半堂');
      if (!s.coaches || !s.coaches.length) flags.push('還沒派教練');
      const lv = new Set(s.players.map(n => levelOf(byName[n])).filter(Boolean));
      if (lv.has('高') && lv.has('低') && (s.coaches || []).length < 2) flags.push('程度落差大，建議兩位教練');
      s.flags = flags;
      s.status = flags.some(f => f === '撞到網球' || f === '超過人數上限') ? 'bad' : (flags.length ? 'warn' : 'ok');
    });
    return slots;
  }

  /**
   * 明天誰可以練：每個人網球前後的空檔
   * 回 { people:[{name, group, tennis:[...], windows:[{start,end,min,where}], best, status}], notIn:[name] }
   *   status：ok＝有完整一堂的空檔、warn＝只有半堂、bad＝沒空檔、leave＝請假
   */
  function availability(input, cfg) {
    cfg = Object.assign({}, CFG, cfg || {});
    const roster = input.roster || [];
    const byName = {}; roster.forEach(p => byName[p.name] = p);
    const leave = new Set(input.leave || []);
    const busy = {}, notIn = new Set();
    (input.tennis || []).forEach(t => (t.players || []).forEach(n => {
      if (!byName[n]) { notIn.add(n); return; }
      (busy[n] = busy[n] || []).push([toMin(t.start), toMin(t.end)]);
    }));
    const brk = (cfg.breaks || []).map(x => [toMin(x[0]), toMin(x[1])]);
    const people = Object.keys(busy).map(n => {
      const p = byName[n];
      const g = cfg.groups[p.group] || cfg.groups['小朋友'];
      const lo = Math.max(cfg.open, isNaN(toMin(p.earliest)) ? 0 : toMin(p.earliest));
      const hi = Math.min(cfg.close, isNaN(toMin(p.latest)) ? 24 * 60 : toMin(p.latest));
      const tb = busy[n].slice().sort((a, b) => a[0] - b[0]);
      const all = tb.concat(brk).sort((a, b) => a[0] - b[0]);
      const wins = [];
      tb.forEach(x => {
        // 之前：往前找到上一個不能排的時間
        const prev = all.filter(y => y[1] <= x[0]).reduce((m, y) => Math.max(m, y[1]), lo);
        const bs = Math.max(prev, lo), be = x[0];
        if (be - bs >= cfg.minPartial) wins.push({ start: fmt(Math.max(bs, be - g.dur)), end: fmt(be), min: Math.min(be - bs, g.dur), where: '網球前' });
        const next = all.filter(y => y[0] >= x[1]).reduce((m, y) => Math.min(m, y[0]), hi);
        const as = x[1], ae = Math.min(next, hi);
        if (ae - as >= cfg.minPartial) wins.push({ start: fmt(as), end: fmt(Math.min(ae, as + g.dur)), min: Math.min(ae - as, g.dur), where: '網球後' });
      });
      const seen = {}; const windows = wins.filter(w => !seen[w.start] && (seen[w.start] = 1)).sort((a, b) => b.min - a.min || toMin(a.start) - toMin(b.start));
      const best = windows[0] || null;
      const status = leave.has(n) ? 'leave' : !best ? 'bad' : best.min >= g.dur ? 'ok' : 'warn';
      return { name: n, group: p.group, team: p.team, unclassified: !!p.unclassified, dur: g.dur,
        tennis: tb.map(x => fmt(x[0]) + '–' + fmt(x[1])), windows: windows.sort((a, b) => toMin(a.start) - toMin(b.start)), best, status };
    });
    const order = { ok: 0, warn: 1, bad: 2, leave: 3 };
    people.sort((a, b) => order[a.status] - order[b.status] || a.group.localeCompare(b.group) || (a.best && b.best ? toMin(a.best.start) - toMin(b.best.start) : 0));
    return { people, notIn: Array.from(notIn) };
  }

  /** 轉成 Adam 平常貼群組的格式 */
  function toChatText(date, slots, leave) {
    const md = date.slice(5).replace(/^0/, '').replace('-0', '-').replace('-', '/');
    const lines = [md + '周' + weekday(date) + ' 體能'];
    slots.forEach(s => {
      const pt = Object.keys(s.partial || {});
      lines.push(s.start + ' ' + s.players.map(n => pt.includes(n) ? n + '(' + s.partial[n] + '分)' : n).join(' ') + (s.coaches && s.coaches.length ? ' ［' + s.coaches.join('+') + '］' : ''));
    });
    if (leave && leave.length) lines.push('請假：' + leave.join(' '));
    return lines.join('\n');
  }

  // ───────────────────────── 3. 這堂練什麼 ─────────────────────────
  const CAT_RULES = [
    ['有氧', /有氧|恢復跑|aerobic/i],
    ['速度', /sprint|衝刺|5-10-5|變向|agility/i],
    ['爆發', /jump|bound|跳|plyo/i],
    ['力量', /squat|deadlift|bench|press|pull|row|thrust|rdl|lunge|蹲|拉|推|划船/i]
  ];
  function category(ex) { for (const [c, re] of CAT_RULES) if (re.test(ex)) return c; return '其他'; }

  const WEAK_ADD = {
    '速度與變向': { name: '5-10-5 變向跑', sets: 4, reps: 1, unit: '趟' },
    '下肢爆發': { name: 'Ecc Broad Jump 離心立定跳遠', sets: 3, reps: 5 },
    '單腿減速': { name: '單腳落地停', sets: 3, reps: 5, unit: '次／邊' },
    '轉體爆發': { name: '藥球轉體拋', sets: 3, reps: 6, unit: '次／邊' },
    '投擲': { name: '藥球過頂拋', sets: 3, reps: 6 },
    '心肺適能': { name: '30-15 間歇跑', sets: 2, reps: 1, unit: '組' }
  };
  const TEMPLATES = {
    '力量': [
      { name: 'Squat 深蹲', sets: 4, reps: 8 }, { name: 'Bulgarian Squat 保加利亞蹲', sets: 3, reps: 8, unit: '次／邊' },
      { name: 'Pull Ups 引體向上', sets: 3, reps: 6 }, { name: 'Hip thrust 臀推', sets: 3, reps: 10 },
      { name: 'SL RDL 單腳RDL', sets: 3, reps: 8, unit: '次／邊' }],
    '速度爆發': [
      { name: 'Sprint 衝刺 10m', sets: 5, reps: 1, unit: '趟' }, { name: 'Skater Jump 滑冰跳', sets: 3, reps: 5, unit: '次／邊' },
      { name: 'SL Box Jump 單腳跳箱', sets: 3, reps: 5, unit: '次／邊' }, { name: 'Band-resisted SJ 彈力帶深蹲跳', sets: 3, reps: 6 },
      { name: 'Side lunge 側弓步', sets: 3, reps: 8, unit: '次／邊' }],
    '小朋友綜合': [
      { name: '敏捷梯＋反應起跑', sets: 4, reps: 1, unit: '趟' }, { name: 'Skater Jump 滑冰跳', sets: 3, reps: 5, unit: '次／邊' },
      { name: '單腳站平衡', sets: 2, reps: 30, unit: '秒／邊' }, { name: 'Side lunge 側弓步', sets: 2, reps: 8, unit: '次／邊' },
      { name: '熊爬＋螃蟹走', sets: 3, reps: 10, unit: '公尺' }]
  };

  /** 每人每天的 session 負荷（sRPE＝平均 RPE × 時長） */
  function sessionLoads(logs, durOf) {
    const by = {};
    (logs || []).forEach(r => {
      const d = normDate(r.date); if (!d || !r.player) return;
      const k = r.player + '|' + d;
      const o = by[k] = by[k] || { player: r.player, date: d, rpe: [], cats: {}, team: r.team };
      const v = parseFloat(r.rpe); if (isFinite(v)) o.rpe.push(v);
      const c = category(r.exercise || ''); o.cats[c] = (o.cats[c] || 0) + 1;
    });
    return Object.values(by).map(o => {
      const rpe = o.rpe.length ? o.rpe.reduce((a, b) => a + b, 0) / o.rpe.length : NaN;
      const dur = durOf ? durOf(o.player) : 90;
      const main = Object.keys(o.cats).filter(c => c !== '其他').sort((a, b) => o.cats[b] - o.cats[a])[0] || '其他';
      return { player: o.player, date: o.date, rpe, load: isFinite(rpe) ? Math.round(rpe * dur) : 0, main, team: o.team };
    });
  }

  function loadStatus(sessions, player, date) {
    const mine = sessions.filter(s => s.player === player && s.date < date);
    const acute = mine.filter(s => daysBetween(s.date, date) <= 7).reduce((a, s) => a + s.load, 0);
    const chronicArr = mine.filter(s => daysBetween(s.date, date) > 7 && daysBetween(s.date, date) <= 35);
    const chronic = chronicArr.reduce((a, s) => a + s.load, 0) / 4;
    const ratio = chronic > 0 && chronicArr.length >= 3 ? acute / chronic : null;
    const last = mine.sort((a, b) => b.date.localeCompare(a.date))[0] || null;
    return { acute, chronic: Math.round(chronic), ratio, last, sessions7: mine.filter(s => daysBetween(s.date, date) <= 7).length };
  }

  /**
   * ctx = { date, slot, roster, logs, radar:{name:{date,weak,strong,total}}, monitor:{name:{sleep,sore}} }
   */
  function suggestSession(ctx, cfg) {
    cfg = Object.assign({}, CFG, cfg || {});
    const s = ctx.slot, date = ctx.date;
    const byName = {}; (ctx.roster || []).forEach(p => byName[p.name] = p);
    const durOf = n => ((cfg.groups[(byName[n] || {}).group] || { dur: 90 }).dur);
    const sessions = sessionLoads(ctx.logs, durOf);
    const kids = s.group === '小朋友';

    // 這組最近練了什麼
    const recent = sessions.filter(x => s.players.includes(x.player) && x.date < date && daysBetween(x.date, date) <= 14);
    const byDate = {};
    recent.forEach(x => { (byDate[x.date] = byDate[x.date] || {})[x.main] = ((byDate[x.date] || {})[x.main] || 0) + 1; });
    const recentDays = Object.keys(byDate).sort().reverse().slice(0, 3).map(d => {
      const main = Object.keys(byDate[d]).sort((a, b) => byDate[d][b] - byDate[d][a])[0];
      return { date: d, main };
    });
    const lastMain = recentDays.length ? recentDays[0].main : null;
    let type, typeWhy;
    if (kids) { type = '小朋友綜合'; typeWhy = '小朋友組以動作品質和協調為主，每堂都練一點速度、跳躍、平衡。'; }
    else if (!lastMain) { type = '速度爆發'; typeWhy = '這組最近 14 天沒有訓練紀錄，先從速度爆發開始。'; }
    else if (lastMain === '力量') { type = '速度爆發'; typeWhy = '上一堂（' + recentDays[0].date.slice(5).replace('-', '/') + '）是力量為主，今天換速度＋爆發。'; }
    else { type = '力量'; typeWhy = '上一堂（' + recentDays[0].date.slice(5).replace('-', '/') + '）是' + lastMain + '為主，今天換力量。'; }

    // 弱項統計
    const weakCount = {};
    s.players.forEach(n => { const r = (ctx.radar || {})[n]; if (r && r.weak) weakCount[r.weak] = (weakCount[r.weak] || 0) + 1; });
    const focus = Object.keys(weakCount).sort((a, b) => weakCount[b] - weakCount[a])[0] || null;
    const withData = s.players.filter(n => (ctx.radar || {})[n]).length;

    function build(level) {
      const base = TEMPLATES[type].map(x => Object.assign({}, x));
      const k = level === '重' ? 1 : level === '中' ? 0 : -1;
      let items = base.map(x => Object.assign(x, { sets: Math.max(1, x.sets + k) }));
      if (focus && WEAK_ADD[focus] && !kids) items.splice(1, 0, Object.assign({ focus: true }, WEAK_ADD[focus], { sets: Math.max(1, WEAK_ADD[focus].sets + k) }));
      if (level === '輕') { items = items.slice(0, items.length - 2).map(x => Object.assign(x, { light: true })); items.push({ name: '有氧恢復跑', sets: 1, reps: 15, unit: '分鐘' }); }
      return [{ name: '動態熱身', sets: 1, reps: 10, unit: '分鐘', warm: true }].concat(items, [{ name: '收操伸展', sets: 1, reps: 10, unit: '分鐘', warm: true }]);
    }
    const dur = (cfg.groups[s.group] || { dur: 60 }).dur;
    const options = ['重', '中', '輕'].map(lv => ({ level: lv, title: (type === '速度爆發' ? '速度＋爆發' : type) + (lv === '輕' ? '・恢復' : ''), minutes: lv === '輕' ? Math.round(dur * 0.8) : dur, items: build(lv) }));

    // 個別調整
    const people = s.players.map(n => {
      const p = byName[n] || {}, r = (ctx.radar || {})[n], m = (ctx.monitor || {})[n];
      const ls = loadStatus(sessions, n, date);
      const notes = [], flags = [];
      let suggest = null;
      if (p.growth) { flags.push(['grow', '▲生長期']); notes.push('跳躍量減半、不做最大衝刺'); }
      if (ls.ratio && ls.ratio >= cfg.spike) { flags.push(['bad', '負荷暴增']); notes.push('近 7 天負荷是平常的 ' + Math.round(ls.ratio * 100) + '% → 這堂改輕'); suggest = '輕'; }
      if (m && (+m.sore >= 4 || (+m.sleep > 0 && +m.sleep < 6))) { flags.push(['warn', +m.sore >= 4 ? '痠痛 ' + m.sore : '睡 ' + m.sleep + 'h']); notes.push('今早狀態差 → 降量'); suggest = suggest || '輕'; }
      if (s.partial && s.partial[n]) { flags.push(['warn', '只能 ' + s.partial[n] + ' 分']); notes.push('只上前 ' + s.partial[n] + ' 分鐘，跳過最後一段，先跟家長說'); }
      if (!r) { flags.push(['idle', '沒有檢測']); notes.push('還沒有檢測資料，先照團體課、觀察動作'); }
      else {
        const age = daysBetween(r.date, date);
        if (age > cfg.staleDays) { flags.push(['idle', '檢測 ' + age + ' 天前']); notes.push('檢測超過 ' + cfg.staleDays + ' 天，建議安排複測'); }
        if (r.weak && r.weak === focus && !kids) notes.push('弱項「' + r.weak + '」就是這堂重點');
        else if (r.weak && WEAK_ADD[r.weak] && !kids) notes.push('弱項「' + r.weak + '」→ 最後加 1 組 ' + WEAK_ADD[r.weak].name);
      }
      if (!notes.length) notes.push('照團體課');
      return { name: n, level: p.level || '', weak: r ? r.weak : '', testDate: r ? r.date : '', sleep: m ? m.sleep : '', sore: m ? m.sore : '',
        acute: ls.acute, chronic: ls.chronic, ratio: ls.ratio, last: ls.last, flags, notes, suggest };
    });

    const recommend = people.filter(x => x.suggest === '輕').length >= Math.ceil(s.players.length / 2) ? '輕' : '中';
    let why = typeWhy;
    if (focus && !kids) why += ' 有 ' + weakCount[focus] + ' 人的檢測弱項是「' + focus + '」，所以把它放在第二個動作。';
    if (withData < s.players.length) why += ' （' + (s.players.length - withData) + ' 人還沒有檢測資料）';
    return { type, why, focus, recentDays, options, recommend, people };
  }

  /** 回填 → 體能訓練紀錄的列（欄位跟正式表一樣） */
  function backfillRows(date, slot, option, att) {
    const rows = [];
    const label = slot.team || (slot.group + ' ' + slot.start);
    slot.players.forEach(n => {
      const a = att[n] || {};
      if (a.status && a.status !== '出席') {
        rows.push([date, '週' + weekday(date), label, n, '（' + a.status + '）', '', '', '', '', '', '', option.level + '・' + option.title, '', a.note || '', '排課台回填']);
        return;
      }
      option.items.filter(x => !x.warm).forEach(x => {
        rows.push([date, '週' + weekday(date), label, n, x.name, '—', '', String(x.sets), String(x.reps) + (x.unit && x.unit !== '次' ? x.unit : ''), '', '', option.level + '・' + option.title,
          String(a.rpe || ''), [a.done && a.done !== '全部完成' ? a.done : '', a.note || ''].filter(Boolean).join('；'), '排課台回填']);
      });
    });
    return rows;
  }

  const API = { CFG, availability, fmt, toMin, weekday, addDays, daysBetween, normDate, nameIndex, nameKey, parseTennisText, schedule, recheck, toChatText,
    category, sessionLoads, loadStatus, suggestSession, backfillRows, WEAK_ADD };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.TrainEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
